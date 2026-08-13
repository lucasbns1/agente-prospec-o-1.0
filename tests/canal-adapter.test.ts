/**
 * O adapter do canal e a guarda de envio.
 *
 * ============================================================
 * POR QUE ESTES TESTES CONSEGUEM EXISTIR
 * ============================================================
 * O `whatsapp-web.js` exige Chromium aberto e celular pareado. Sem a
 * costura do `ProvedorWhatsApp`, nada aqui seria testavel — nem "o QR
 * expirou", nem "a sessao caiu", nem "a autenticacao falhou". Ficariam
 * todos dependendo de alguem escanear um QR na mao.
 *
 * O `ProvedorSimulado` emite os mesmos eventos, na mesma ordem, com os
 * mesmos formatos. Se o adapter estiver errado, ele quebra aqui.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  WhatsAppWebAdapter,
} from '../packages/integrations/src/whatsapp/whatsapp-web-adapter.js';
import { ProvedorSimulado } from '../packages/integrations/src/whatsapp/provedor-simulado.js';
import {
  avaliarGuardaEnvio,
  exigirPermissaoDeEnvioReal,
  EnvioRealBloqueadoError,
  FASE_PERMITE_ENVIO_REAL,
} from '../packages/integrations/src/whatsapp/guarda-envio.js';
import {
  criarWhatsAppAdapter,
  resolverCanal,
} from '../packages/integrations/src/whatsapp/factory.js';
import { BarramentoCanal } from '../packages/integrations/src/whatsapp/eventos-canal.js';
import type { EventoCanal } from '../packages/integrations/src/whatsapp/eventos-canal.js';

/** Adapter + provedor prontos, sem esperar de verdade na reconexão. */
function montar(opcoes: ConstructorParameters<typeof ProvedorSimulado>[0] = {}) {
  const provedor = new ProvedorSimulado(opcoes);
  const eventos: EventoCanal[] = [];
  const adapter = new WhatsAppWebAdapter({
    provedor,
    modo: 'dry-run',
    aguardar: async () => {},
    maxTentativasReconexao: 2,
  });
  adapter.ouvirCanal((e) => {
    eventos.push(e);
  });
  return { provedor, adapter, eventos };
}

// ============================================================ 1-6 CONEXAO
describe('conexão — a máquina de estados', () => {
  it('1. pede QR quando não há sessão salva', async () => {
    const { adapter, eventos } = montar();
    await adapter.connect();

    expect(eventos.some((e) => e.tipo === 'canal.qr')).toBe(true);
    const qr = eventos.find((e) => e.tipo === 'canal.qr');
    expect(qr?.qr).toMatch(/\S/);
  });

  it('2. autentica e passa por AUTENTICANDO antes de CONECTADO', async () => {
    const { adapter, eventos } = montar();
    await adapter.connect();

    const estados = eventos
      .filter((e) => e.tipo === 'canal.status')
      .map((e) => e.status);

    expect(estados).toContain('INICIALIZANDO');
    expect(estados).toContain('AGUARDANDO_QR');
    expect(estados).toContain('AUTENTICANDO');
    expect(estados).toContain('CONECTADO');
    // A ordem importa: colapsar esses estados esconde exatamente a
    // informação que se precisa quando a conexão não sobe.
    expect(estados.indexOf('AUTENTICANDO')).toBeLessThan(
      estados.indexOf('CONECTADO')
    );
  });

  it('3. fica CONECTADO e expõe o telefone da conta', async () => {
    const { adapter } = montar({ telefone: '5519988887777' });
    await adapter.connect();

    const s = adapter.getStatus();
    expect(s.status).toBe('CONECTADO');
    expect(s.telefone).toBe('5519988887777');
    // O QR some assim que não é mais necessário.
    expect(s.qr).toBeUndefined();
  });

  it('4. desconectar leva a DESCONECTADO e destrói o provedor', async () => {
    const { adapter, provedor } = montar();
    await adapter.connect();
    await adapter.disconnect();

    expect(adapter.getStatus().status).toBe('DESCONECTADO');
    expect(provedor.foiDestruido).toBe(true);
  });

  it('5. queda inesperada tenta reconectar sozinha', async () => {
    const { adapter, provedor, eventos } = montar();
    await adapter.connect();

    provedor.derrubar('NAVIGATION');
    await vi.waitFor(() => {
      expect(
        eventos.some((e) => e.tipo === 'canal.status' && e.status === 'RECONECTANDO')
      ).toBe(true);
    });
  });

  it('5b. desiste depois do limite e assume FALHOU', async () => {
    const provedor = new ProvedorSimulado();
    const adapter = new WhatsAppWebAdapter({
      provedor,
      modo: 'dry-run',
      aguardar: async () => {},
      maxTentativasReconexao: 1,
    });
    await adapter.connect();

    // Cada reinicialização volta a cair.
    provedor.derrubar('CONFLICT');
    await vi.waitFor(() => {
      expect(['RECONECTANDO', 'CONECTADO', 'FALHOU']).toContain(
        adapter.getStatus().status
      );
    });

    provedor.derrubar('CONFLICT');
    provedor.derrubar('CONFLICT');
    await vi.waitFor(() => {
      expect(adapter.getStatus().status).toBe('FALHOU');
    });
  });

  it('6. falha de autenticação vai direto para FALHOU, sem reconectar', async () => {
    const { adapter, eventos } = montar({ falharAutenticacao: true });
    await adapter.connect();

    expect(adapter.getStatus().status).toBe('FALHOU');
    expect(eventos.some((e) => e.tipo === 'canal.falha_autenticacao')).toBe(true);
    // Reconectar não resolve credencial inválida — insistir só queima
    // tentativa.
    expect(
      eventos.some((e) => e.tipo === 'canal.status' && e.status === 'RECONECTANDO')
    ).toBe(false);
  });

  it('6b. falha ao inicializar não deixa o status mentir', async () => {
    const { adapter } = montar({ falharInicializacao: 'Chromium não encontrado' });

    await expect(adapter.connect()).rejects.toThrow(/Chromium/);
    expect(adapter.getStatus().status).toBe('FALHOU');
    expect(adapter.getStatus().detalhe).toContain('Chromium');
  });

  it('sessão já salva pula o QR', async () => {
    const { adapter, eventos } = montar({ sessaoExistente: true });
    await adapter.connect();

    expect(eventos.some((e) => e.tipo === 'canal.qr')).toBe(false);
    expect(adapter.getStatus().status).toBe('CONECTADO');
  });
});

// ======================================================= EVENTOS DE ENTRADA
describe('recebimento no adapter', () => {
  it('7. traduz a mensagem do provedor para o formato interno', async () => {
    const { adapter, provedor, eventos } = montar();
    await adapter.connect();

    provedor.receber({
      id: 'ABC123',
      from: '5519999991111@c.us',
      body: 'Pode mandar',
      notifyName: 'Maria',
    });

    const evento = eventos.find((e) => e.tipo === 'canal.mensagem_recebida');
    expect(evento?.mensagem).toMatchObject({
      providerMessageId: 'ABC123',
      telefone: '5519999991111',
      texto: 'Pode mandar',
      nomeContato: 'Maria',
      deMim: false,
    });
  });

  it('ignora o eco das próprias mensagens', async () => {
    const { adapter, provedor, eventos } = montar();
    await adapter.connect();

    provedor.receber({ from: '5519999991111@c.us', body: 'oi', fromMe: true });

    // Processar o próprio envio como entrada faria o sistema classificar
    // as mensagens que ele mesmo escreveu.
    expect(eventos.some((e) => e.tipo === 'canal.mensagem_recebida')).toBe(false);
  });

  // ---- Conversas LID (defeito achado na validação com WhatsApp real) ----

  it('NÃO usa o LID como telefone', async () => {
    const { adapter, provedor, eventos } = montar();
    await adapter.connect();

    // Foi exatamente isto que chegou no teste real: o WhatsApp entregou
    // "75866486894727@lid" e o sistema gravou esses dígitos como
    // telefone. Nenhum lead casava, e toda resposta virava
    // "contato desconhecido".
    provedor.receber({ from: '75866486894727@lid', body: 'oi' });

    const m = eventos.find((e) => e.tipo === 'canal.mensagem_recebida')?.mensagem;
    expect(m?.telefone).toBe('');
    expect(m?.telefone).not.toContain('75866486894727');
    // A mensagem NÃO se perde: sem telefone ela cai em "desconhecido",
    // que é onde você decide o que fazer com ela.
    expect(m?.texto).toBe('oi');
  });

  it('usa o telefone que o provedor resolveu numa conversa LID', async () => {
    const { adapter, provedor, eventos } = montar();
    await adapter.connect();

    provedor.receber({
      from: '75866486894727@lid',
      body: 'oi',
      telefone: '5519999991111',
      fonteTelefone: 'senderPn',
    });

    const m = eventos.find((e) => e.tipo === 'canal.mensagem_recebida')?.mensagem;
    expect(m?.telefone).toBe('5519999991111');
  });

  it('o chatId continua sendo o endereço da conversa, não o telefone', async () => {
    const { adapter, provedor, eventos } = montar();
    await adapter.connect();

    provedor.receber({
      from: '75866486894727@lid',
      body: 'oi',
      telefone: '5519999991111',
    });

    // Responder exige o endereço original. Trocá-lo pelo telefone faria
    // a resposta ir para uma conversa que não existe.
    const m = eventos.find((e) => e.tipo === 'canal.mensagem_recebida')?.mensagem;
    expect(m?.chatId).toBe('75866486894727@lid');
  });

  it('marca mídia sem perder a mensagem', async () => {
    const { adapter, provedor, eventos } = montar();
    await adapter.connect();

    provedor.receber({
      from: '5519999991111@c.us',
      body: '',
      type: 'image',
      hasMedia: true,
    });

    const m = eventos.find((e) => e.tipo === 'canal.mensagem_recebida')?.mensagem;
    expect(m?.temMidia).toBe(true);
    expect(m?.tipo).toBe('image');
  });

  it('repassa a confirmação de entrega', async () => {
    const { adapter, provedor, eventos } = montar();
    await adapter.connect();

    provedor.confirmar('MSG1', 3);

    const e = eventos.find((x) => x.tipo === 'canal.confirmacao_entrega');
    expect(e?.providerMessageId).toBe('MSG1');
    expect(e?.ack).toBe(3);
  });
});

// ============================================================ 21-22 DRY-RUN
describe('a guarda de envio', () => {
  it('a fase está travada — este é o invariante da Fase 6A', () => {
    expect(FASE_PERMITE_ENVIO_REAL).toBe(false);
  });

  it('21. tentar enviar devolve resultado simulado e não toca o provedor', async () => {
    const { adapter, provedor } = montar();
    await adapter.connect();

    const r = await adapter.sendMessage('5519999991111', 'Olá!');

    expect(r.simulado).toBe(true);
    expect(r.whatsappMessageId).toBeNull();
    // 22. A prova de que nada saiu: o provedor não recebeu nada.
    expect(provedor.enviadas).toHaveLength(0);
  });

  it('nem com WHATSAPP_MODE=live o envio passa', async () => {
    const original = process.env.WHATSAPP_MODE;
    process.env.WHATSAPP_MODE = 'live';
    try {
      const { adapter, provedor } = montar();
      await adapter.connect();

      const r = await adapter.sendMessage('5519999991111', 'Olá!');

      // A variável de ambiente sozinha não destrava nada — é exatamente
      // para isso que a guarda de fase existe.
      expect(r.simulado).toBe(true);
      expect(provedor.enviadas).toHaveLength(0);
    } finally {
      if (original === undefined) delete process.env.WHATSAPP_MODE;
      else process.env.WHATSAPP_MODE = original;
    }
  });

  it('a última barreira lança em vez de simular em silêncio', () => {
    expect(() => exigirPermissaoDeEnvioReal('teste')).toThrow(
      EnvioRealBloqueadoError
    );
    expect(() => exigirPermissaoDeEnvioReal('teste')).toThrow(/guarda de fase/);
  });

  it('acumula todos os motivos, não só o primeiro', () => {
    const v = avaliarGuardaEnvio({
      modoGlobal: 'dry-run',
      campanhaDryRun: true,
      mensagemDryRun: true,
    });

    // Saber que são quatro barreiras, e não uma, é o que evita alguém
    // baixar só uma e achar que liberou o envio.
    expect(v.simular).toBe(true);
    expect(v.motivos).toEqual([
      'FASE_BLOQUEIA',
      'MODO_GLOBAL',
      'CAMPANHA_DRY_RUN',
      'MENSAGEM_DRY_RUN',
    ]);
    expect(v.explicacao).toContain('fase atual');
  });

  it('mesmo com tudo o mais liberado, a fase ainda bloqueia', () => {
    const v = avaliarGuardaEnvio({
      modoGlobal: 'live',
      campanhaDryRun: false,
      mensagemDryRun: false,
    });

    expect(v.simular).toBe(true);
    expect(v.motivos).toEqual(['FASE_BLOQUEIA']);
  });

  it('isRegistered não consulta nada enquanto o canal não está pronto', async () => {
    const { adapter } = montar();
    expect(await adapter.isRegistered('5519999991111')).toBe(false);
  });

  it('getContacts é vazio — extrair a agenda não faz parte desta fase', async () => {
    const { adapter } = montar();
    await adapter.connect();
    expect(await adapter.getContacts()).toEqual([]);
  });
});

// ================================================================= FACTORY
describe('factory — conectar e enviar são chaves diferentes', () => {
  it('canal desconhecido cai no simulado', () => {
    for (const v of ['', 'whatsapp', 'web', undefined, 'WHATSAPP-WEB ']) {
      const esperado = v?.trim().toLowerCase() === 'whatsapp-web' ? 'whatsapp-web' : 'simulado';
      expect(resolverCanal(v)).toBe(esperado);
    }
  });

  it('canal simulado não carrega a biblioteca real', async () => {
    const adapter = await criarWhatsAppAdapter({ canal: 'simulado', modo: 'dry-run' });
    expect(adapter.getStatus().status).toBe('DESCONECTADO');
  });

  it('com provedor injetado, monta o adapter real sem tocar no Puppeteer', async () => {
    const provedor = new ProvedorSimulado();
    const adapter = await criarWhatsAppAdapter({
      canal: 'whatsapp-web',
      modo: 'dry-run',
      provedor,
    });

    await adapter.connect();
    expect(adapter.getStatus().status).toBe('CONECTADO');
  });
});

// ============================================================== BARRAMENTO
describe('barramento de eventos', () => {
  it('um ouvinte que falha não derruba os outros nem a conexão', async () => {
    const vistos: string[] = [];
    const falhas: unknown[] = [];
    const bus = new BarramentoCanal((e) => falhas.push(e));

    bus.ouvir(() => {
      throw new Error('ouvinte quebrado');
    });
    bus.ouvir(() => {
      vistos.push('ok');
    });

    await bus.publicar({ tipo: 'canal.pronto', em: new Date() });

    // Com EventEmitter puro, a exceção derrubaria o processo que segura
    // a sessão do WhatsApp — perder a conexão por um bug de logging.
    expect(vistos).toEqual(['ok']);
    expect(falhas).toHaveLength(1);
  });

  it('deixa de notificar depois de cancelar a inscrição', async () => {
    const vistos: string[] = [];
    const bus = new BarramentoCanal();
    const cancelar = bus.ouvir(() => vistos.push('x'));

    await bus.publicar({ tipo: 'canal.pronto', em: new Date() });
    cancelar();
    await bus.publicar({ tipo: 'canal.pronto', em: new Date() });

    expect(vistos).toHaveLength(1);
    expect(bus.totalOuvintes).toBe(0);
  });
});
