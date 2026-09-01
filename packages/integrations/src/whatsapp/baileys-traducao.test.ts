/**
 * A traducao do Baileys, e o arquivo que substitui o store.
 *
 * ============================================================
 * O QUE ESTES TESTES PROTEGEM
 * ============================================================
 * O provedor de verdade precisa de socket aberto e celular pareado, e
 * nada disso cabe numa suite. O que cabe — e o que erra na pratica —
 * sao as decisoes: qual campo vira telefone, o que fazer com `@lid`, de
 * onde tirar o texto, o que acontece quando a mesma mensagem chega duas
 * vezes.
 *
 * Um erro em qualquer uma delas nao aparece como falha: aparece como
 * lead que nao casa, resposta que chega vazia, ou historico com a mesma
 * mensagem repetida.
 */
import { describe, expect, it } from 'vitest';
import {
  ArquivoDeMensagens,
  ehGrupo,
  telefoneDoJid,
  textoDaMensagem,
  tipoDaMensagem,
  temMidia,
  traduzir,
} from './baileys-traducao.js';

const AGORA = Math.floor(Date.now() / 1000);

const msg = (over: Record<string, unknown> = {}): never =>
  ({
    key: { id: `id-${Math.random()}`, remoteJid: '5511999998888@s.whatsapp.net' },
    messageTimestamp: AGORA,
    message: { conversation: 'oi' },
    ...over,
  }) as never;

// =============================================================================

describe('telefoneDoJid', () => {
  it('tira o numero do endereco do Baileys', () => {
    expect(telefoneDoJid('5511999998888@s.whatsapp.net')).toBe('5511999998888');
  });

  it('ignora o sufixo de dispositivo', () => {
    // `:12` identifica QUAL aparelho mandou, e nao faz parte do numero.
    expect(telefoneDoJid('5511999998888:12@s.whatsapp.net')).toBe('5511999998888');
  });

  it('NUNCA devolve um LID como telefone', () => {
    // Um LID devolvido como telefone nao casa com lead nenhum e ainda
    // contamina o cadastro com um numero que nao existe. Foi o defeito
    // que quebrou em producao no outro provedor.
    expect(telefoneDoJid('204070199@lid')).toBeNull();
  });

  it('ignora grupo', () => {
    expect(telefoneDoJid('120363@g.us')).toBeNull();
  });

  it('recusa o que nao tem cara de telefone', () => {
    expect(telefoneDoJid('123@s.whatsapp.net')).toBeNull();
    expect(telefoneDoJid('1234567890123456789@s.whatsapp.net')).toBeNull();
    expect(telefoneDoJid(null)).toBeNull();
    expect(telefoneDoJid(undefined)).toBeNull();
  });
});

describe('ehGrupo', () => {
  it('reconhece grupo', () => {
    expect(ehGrupo('120363@g.us')).toBe(true);
    expect(ehGrupo('5511999998888@s.whatsapp.net')).toBe(false);
  });
});

// =============================================================================

describe('textoDaMensagem', () => {
  it('le a mensagem simples', () => {
    expect(textoDaMensagem({ message: { conversation: 'quero sim' } })).toBe('quero sim');
  });

  it('le a mensagem com formatacao ou resposta', () => {
    // Toda resposta a outra mensagem cai neste formato. Procurar so em
    // `conversation` faria elas chegarem vazias — e resposta vazia nao
    // classifica, nao avanca etapa, nao vira nada.
    expect(
      textoDaMensagem({ message: { extendedTextMessage: { text: 'quanto custa?' } } })
    ).toBe('quanto custa?');
  });

  it('le a legenda de uma foto', () => {
    expect(
      textoDaMensagem({ message: { imageMessage: { caption: 'esse aqui' } } })
    ).toBe('esse aqui');
  });

  it('devolve vazio quando nao ha texto em lugar nenhum', () => {
    expect(textoDaMensagem({ message: { audioMessage: {} } })).toBe('');
    expect(textoDaMensagem({})).toBe('');
    expect(textoDaMensagem(null)).toBe('');
  });
});

describe('tipoDaMensagem e temMidia', () => {
  it('classifica os tipos', () => {
    expect(tipoDaMensagem({ message: { conversation: 'oi' } })).toBe('chat');
    expect(tipoDaMensagem({ message: { imageMessage: {} } })).toBe('image');
    expect(tipoDaMensagem({ message: { audioMessage: {} } })).toBe('audio');
  });

  it('reconhece midia', () => {
    expect(temMidia({ message: { conversation: 'oi' } })).toBe(false);
    expect(temMidia({ message: { imageMessage: {} } })).toBe(true);
  });
});

// =============================================================================

describe('traduzir', () => {
  it('converte uma mensagem recebida', () => {
    const r = traduzir(
      msg({ pushName: 'Vinicius', message: { conversation: 'claro!' } })
    );

    expect(r).toMatchObject({
      from: '5511999998888@s.whatsapp.net',
      body: 'claro!',
      telefone: '5511999998888',
      fromMe: false,
      notifyName: 'Vinicius',
      type: 'chat',
    });
  });

  it('marca as suas mensagens', () => {
    const r = traduzir(
      msg({
        key: {
          id: 'x',
          remoteJid: '5511999998888@s.whatsapp.net',
          fromMe: true,
        },
      })
    );
    expect(r?.fromMe).toBe(true);
  });

  it('numa conversa LID, pega o numero do participant', () => {
    const r = traduzir(
      msg({
        key: {
          id: 'x',
          remoteJid: '204070199@lid',
          participant: '5511999998888@s.whatsapp.net',
        },
      })
    );

    // O LID nao vira telefone; o participant sim. Sem isto, toda
    // conversa LID cairia em "contato desconhecido".
    expect(r?.telefone).toBe('5511999998888');
    expect(r?.fonteTelefone).toBe('participant');
  });

  it('descarta grupo', () => {
    expect(traduzir(msg({ key: { id: 'x', remoteJid: '120363@g.us' } }))).toBeNull();
  });

  it('descarta o que nao tem texto nem midia', () => {
    // Eventos de protocolo, revogacao e reacao chegam junto com as
    // mensagens. Deixa-los passar produziria linhas vazias no historico.
    expect(traduzir(msg({ message: { protocolMessage: {} } }))).toBeNull();
  });

  it('descarta o que nao tem id ou conversa', () => {
    expect(traduzir(msg({ key: { remoteJid: '5511999998888@s.whatsapp.net' } }))).toBeNull();
    expect(traduzir(msg({ key: { id: 'x' } }))).toBeNull();
  });

  it('aceita timestamp em Long, que e como o protobuf entrega', () => {
    const r = traduzir(msg({ messageTimestamp: { toNumber: () => 1700000000 } }));
    expect(r?.timestamp).toBe(1700000000);
  });
});

// =============================================================================

const entrada = (
  id: string,
  from: string,
  quando: number,
  over: Partial<{ body: string; fromMe: boolean }> = {}
) => ({
  id,
  from,
  to: '',
  body: over.body ?? 'oi',
  timestamp: quando,
  fromMe: over.fromMe ?? false,
  type: 'chat',
  hasMedia: false,
});

describe('ArquivoDeMensagens', () => {
  const A = '5511111111111@s.whatsapp.net';
  const B = '5522222222222@s.whatsapp.net';

  it('guarda e devolve em ordem cronologica', () => {
    const a = new ArquivoDeMensagens();
    // Fora de ordem de proposito: o pacote de historico vem em ordem
    // inversa, e o pipeline aplica efeitos na ordem em que recebe.
    a.guardar(entrada('2', A, AGORA));
    a.guardar(entrada('1', A, AGORA - 100));

    expect(a.desde(new Date(0)).map((m) => m.id)).toEqual(['1', '2']);
  });

  it('a mesma mensagem duas vezes nao entra duas vezes', () => {
    const a = new ArquivoDeMensagens();
    a.guardar(entrada('1', A, AGORA));
    a.guardar(entrada('1', A, AGORA));

    expect(a.total).toBe(1);
  });

  it('respeita a janela pedida', () => {
    const a = new ArquivoDeMensagens();
    a.guardar(entrada('velha', A, AGORA - 100_000));
    a.guardar(entrada('nova', A, AGORA));

    const r = a.desde(new Date((AGORA - 50) * 1000));
    expect(r.map((m) => m.id)).toEqual(['nova']);
  });

  it('o teto e POR CONVERSA, e nao global', () => {
    const a = new ArquivoDeMensagens(3);

    // Uma conversa movimentada NAO pode expulsar as outras: com um teto
    // global, o lead que respondeu uma vez — que e justamente quem
    // interessa — seria o primeiro a sumir.
    for (let i = 0; i < 10; i += 1) a.guardar(entrada(`a${i}`, A, AGORA + i));
    a.guardar(entrada('b1', B, AGORA));

    expect(a.desde(new Date(0), [B])).toHaveLength(1);
    expect(a.desde(new Date(0), [A])).toHaveLength(3);
  });

  it('ao estourar o teto, saem as MAIS ANTIGAS', () => {
    const a = new ArquivoDeMensagens(2);
    a.guardar(entrada('1', A, AGORA - 200));
    a.guardar(entrada('2', A, AGORA - 100));
    a.guardar(entrada('3', A, AGORA));

    // Uma varredura olha para tras dias, nao meses.
    expect(a.desde(new Date(0)).map((m) => m.id)).toEqual(['2', '3']);
  });

  it('filtra por conversa quando quem chama sabe com quem falou', () => {
    const a = new ArquivoDeMensagens();
    a.guardar(entrada('1', A, AGORA));
    a.guardar(entrada('2', B, AGORA));

    expect(a.desde(new Date(0), [A]).map((m) => m.id)).toEqual(['1']);
  });

  it('guardarVarias conta so as novas', () => {
    const a = new ArquivoDeMensagens();
    expect(a.guardarVarias([entrada('1', A, AGORA), entrada('2', A, AGORA)])).toBe(2);
    // As mesmas de novo: nenhuma nova.
    expect(a.guardarVarias([entrada('1', A, AGORA), entrada('3', A, AGORA)])).toBe(1);
  });
});

describe('procurarEnviada', () => {
  const A = '5511111111111@s.whatsapp.net';

  it('acha a mensagem que saiu, e devolve o id', () => {
    const a = new ArquivoDeMensagens();
    a.guardar(entrada('m1', A, AGORA, { body: 'Boa tarde!', fromMe: true }));

    // O caso real: o envio nao respondeu, mas a mensagem esta la. Sem
    // esta busca o sistema marcaria FALHOU um envio que deu certo.
    expect(a.procurarEnviada(A, 'Boa tarde!', new Date((AGORA - 60) * 1000))).toBe('m1');
  });

  it('ignora o que o LEAD mandou, mesmo com o texto igual', () => {
    const a = new ArquivoDeMensagens();
    a.guardar(entrada('m1', A, AGORA, { body: 'Boa tarde!', fromMe: false }));

    expect(a.procurarEnviada(A, 'Boa tarde!', new Date(0))).toBeNull();
  });

  it('ignora o que e mais antigo que o corte', () => {
    const a = new ArquivoDeMensagens();
    a.guardar(entrada('m1', A, AGORA - 10_000, { body: 'Boa tarde!', fromMe: true }));

    // O corte existe para nao confundir o envio de agora com o mesmo
    // texto enviado semana passada.
    expect(a.procurarEnviada(A, 'Boa tarde!', new Date((AGORA - 60) * 1000))).toBeNull();
  });

  it('compara sem espaco sobrando nas pontas', () => {
    const a = new ArquivoDeMensagens();
    a.guardar(entrada('m1', A, AGORA, { body: ' Boa tarde! ', fromMe: true }));

    expect(a.procurarEnviada(A, 'Boa tarde!', new Date(0))).toBe('m1');
  });

  it('devolve null quando a conversa nem existe', () => {
    const a = new ArquivoDeMensagens();
    expect(a.procurarEnviada(A, 'oi', new Date(0))).toBeNull();
  });
});

// =============================================================================
// A ESCOLHA DO CANAL
// =============================================================================

describe('resolverCanal', () => {
  it('reconhece os tres canais', async () => {
    const { resolverCanal } = await import('./factory.js');

    expect(resolverCanal('baileys')).toBe('baileys');
    expect(resolverCanal('whatsapp-web')).toBe('whatsapp-web');
    expect(resolverCanal('simulado')).toBe('simulado');
  });

  it('aceita espaço e maiúscula, que é como se digita errado no .env', async () => {
    const { resolverCanal } = await import('./factory.js');
    expect(resolverCanal('  Baileys ')).toBe('baileys');
  });

  it('qualquer outra coisa cai em simulado', async () => {
    const { resolverCanal } = await import('./factory.js');

    // O padrão seguro é o que NÃO abre navegador e NÃO conecta em lugar
    // nenhum. Um erro de digitação no .env não pode ligar o WhatsApp de
    // verdade sem querer.
    expect(resolverCanal('bailyes')).toBe('simulado');
    expect(resolverCanal('')).toBe('simulado');
    expect(resolverCanal(undefined)).toBe('simulado');
  });
});
