/**
 * As respostas que chegaram com o worker fora do ar.
 *
 * ============================================================
 * O DEFEITO QUE ESTES TESTES TRANCAM
 * ============================================================
 * O evento `message` do WhatsApp só existe AO VIVO. Se o worker não
 * estiver rodando no instante em que o lead responde, aquele evento
 * nunca é reentregue — a mensagem fica na conversa do celular e o
 * sistema simplesmente nunca soube dela.
 *
 * Aconteceu na validação real, do jeito mais silencioso possível:
 *
 *   01:18:48  mensagem 1 enviada
 *   01:18     lead responde "claro!"
 *   (o worker estava reiniciando naquele instante)
 *
 * A resposta apareceu nos dois celulares. No sistema, o diagnóstico
 * mostrou `RESPOSTAS DELE (0)` — nem mensagem, nem contato desconhecido,
 * nem erro. A sequência morreu ali e não havia nada apontando o porquê.
 *
 * Reiniciar o worker não é exceção: acontece a cada `git pull`, a cada
 * queda do Chromium, toda vez que o computador dorme.
 *
 * Requer Postgres e Redis no ar, migrado e com seed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { Logger } from 'pino';
import type { MensagemEntrada, WhatsAppAdapter } from '@prospector/integrations';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });
process.env.LOG_LEVEL = 'silent';

// Logger mudo, montado a mao: a raiz do monorepo nao declara `pino`
// como dependencia, e a recuperacao so usa `error`.
const log = { error: () => {}, info: () => {}, warn: () => {} } as unknown as Logger;

let prisma: typeof import('@prospector/database').prisma;
let rec: typeof import('../apps/worker/src/services/recuperar-perdidas.js');

beforeAll(async () => {
  prisma = (await import('@prospector/database')).prisma;
  rec = await import('../apps/worker/src/services/recuperar-perdidas.js');
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(async () => {
  // A marca do reset e um Setting REAL e persistente: rodar
  // `pnpm reset:fabrica` na maquina deixa ela gravada, e sem limpar
  // aqui todo teste de janela passaria a comparar com a data do ultimo
  // reset em vez da que o proprio teste montou.
  await prisma.setting.deleteMany({ where: { chave: 'canal.varredura_desde' } });
  await prisma.unknownContact.deleteMany();
  await prisma.outboundMessage.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.leadEvent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.task.deleteMany();
  await prisma.leadCampaign.deleteMany();
  await prisma.campaignStepRule.deleteMany();
  await prisma.campaignStep.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.lead.deleteMany();
});

let n = 0;

async function criarLead() {
  n += 1;
  return prisma.lead.create({
    data: {
      nomeCompleto: `Studio Perdida ${n}`,
      empresa: `Studio Perdida ${n}`,
      // 13 digitos: 55 + 11 + 9 + 8. Um digito a mais e `normalizarTelefone`
      // recusa por "longo demais" e a resposta cai em contato desconhecido.
      telefone: `(11) 9${String(80000000 + n).slice(-8)}`,
      telefoneNormalizado: `55119${String(80000000 + n).slice(-8)}`,
      cidade: 'São Paulo',
      websiteStatus: 'NAO_INFORMADO',
      status: 'AGUARDANDO_RESPOSTA',
    } as never,
  });
}

/**
 * Adapter de mentira que devolve o que "estava nas conversas".
 *
 * Só o método da varredura é real; o resto lança de propósito. Se a
 * recuperação passar a depender de outra coisa do adapter, o teste
 * quebra e diz qual.
 */
function adapterCom(mensagens: MensagemEntrada[]): {
  adapter: WhatsAppAdapter;
  pedidos: Date[];
} {
  const pedidos: Date[] = [];
  const naoUsar = (): never => {
    throw new Error('A varredura não deveria chamar isto');
  };

  const adapter = {
    modo: 'live',
    mensagensPerdidas: async (desde: Date) => {
      pedidos.push(desde);
      return mensagens.filter((m) => m.recebidaEm >= desde);
    },
    connect: naoUsar,
    disconnect: naoUsar,
    getStatus: naoUsar,
    sendMessage: naoUsar,
    isRegistered: naoUsar,
    getContacts: naoUsar,
    onReady: naoUsar,
    onQr: naoUsar,
    onMessage: naoUsar,
    onDisconnected: naoUsar,
    onStatusChange: naoUsar,
  } as unknown as WhatsAppAdapter;

  return { adapter, pedidos };
}

function entrada(
  telefone: string,
  texto: string,
  recebidaEm: Date,
  id?: string
): MensagemEntrada {
  n += 1;
  return {
    providerMessageId: id ?? `perdida-${n}-${Date.now()}`,
    chatId: `${telefone}@c.us`,
    telefone,
    texto,
    nomeContato: 'Contato',
    recebidaEm,
    deMim: false,
    tipo: 'chat',
    temMidia: false,
  };
}

// ---------------------------------------------------------------------------

describe('inicioDaVarredura — de quando olhar para trás', () => {
  it('sem nenhuma mensagem, olha a janela de estreia para trás', async () => {
    const agora = new Date('2026-08-15T12:00:00Z');
    const desde = await rec.inicioDaVarredura(agora);
    // Banco sem nenhuma mensagem recebida = estreia. O padrão daqui são
    // 240h (dez dias), e não as 24h do regime normal — o caso real está
    // no teste logo abaixo.
    expect(desde.getTime()).toBe(agora.getTime() - 240 * 3600_000);
  });

  // ==========================================================
  // O CASO REAL: "MAS EU MANDEI MENSAGEM QUINTA PASSADA"
  // ==========================================================
  // O provedor novo entregou o histórico inteiro do WhatsApp —
  // milhares de mensagens, meses para trás — e a varredura devolveu
  // `encontradas: 0`. Não era o histórico: era a janela. Ela olhava
  // 72h, e as mensagens procuradas eram de cinco e seis dias antes.
  it('na estreia, a quinta e a sexta da semana passada estão dentro da janela', async () => {
    const agora = new Date('2026-09-01T20:00:00Z'); // segunda
    const quinta = new Date('2026-08-27T14:00:00Z');
    const sexta = new Date('2026-08-28T14:00:00Z');

    const desde = await rec.inicioDaVarredura(agora, 72);

    expect(desde.getTime()).toBeLessThan(quinta.getTime());
    expect(desde.getTime()).toBeLessThan(sexta.getTime());
    // E com a janela normal de 72h nem a sexta seria alcançada — é
    // exatamente essa a diferença que este teste tranca.
    expect(agora.getTime() - 72 * 3600_000).toBeGreaterThan(sexta.getTime());
  });

  it('a janela de estreia vale UMA vez: com mensagem conhecida, manda a normal', async () => {
    const lead = await criarLead();
    const agora = new Date('2026-09-01T20:00:00Z');
    const ultima = new Date('2026-09-01T19:00:00Z');

    const conversa = await prisma.conversation.create({
      data: {
        id: `${lead.id}-sem-campanha`,
        leadId: lead.id,
        chatId: `${lead.telefoneNormalizado}@c.us`,
        ultimaMensagemEm: ultima,
      },
    });
    await prisma.message.create({
      data: {
        conversationId: conversa.id,
        leadId: lead.id,
        direcao: 'RECEBIDA',
        status: 'ENTREGUE',
        texto: 'oi',
        whatsappMessageId: `wa-estreia-${Date.now()}`,
        recebidaEm: ultima,
      },
    });

    // Sem isto a varredura releria dez dias de conversa a cada cinco
    // minutos, para sempre.
    const desde = await rec.inicioDaVarredura(agora, 72, 240);
    expect(desde.getTime()).toBe(ultima.getTime() - 10 * 60_000);
  });

  it('quem pede uma janela explícita não leva o alargamento por cima', async () => {
    const agora = new Date('2026-09-01T20:00:00Z');
    // É o que o botão "reconciliar o dia X" faz: passa o mesmo valor
    // nos dois, e a escolha da pessoa manda.
    const desde = await rec.inicioDaVarredura(agora, 6, 6);
    expect(desde.getTime()).toBe(agora.getTime() - 6 * 3600_000);
  });

  it('com mensagem conhecida, parte dela com folga para trás', async () => {
    const lead = await criarLead();
    const agora = new Date('2026-08-15T12:00:00Z');
    const ultima = new Date('2026-08-15T11:00:00Z');

    const conversa = await prisma.conversation.create({
      data: {
        id: `${lead.id}-sem-campanha`,
        leadId: lead.id,
        chatId: `${lead.telefoneNormalizado}@c.us`,
        ultimaMensagemEm: ultima,
      },
    });
    await prisma.message.create({
      data: {
        conversationId: conversa.id,
        leadId: lead.id,
        direcao: 'RECEBIDA',
        status: 'ENTREGUE',
        texto: 'oi',
        whatsappMessageId: `wa-${Date.now()}`,
        recebidaEm: ultima,
      },
    });

    const desde = await rec.inicioDaVarredura(agora);

    // A folga não é capricho: a resposta real chegou no mesmo minuto do
    // envio, e sem folga ela ficaria de fora por segundos.
    expect(desde.getTime()).toBeLessThan(ultima.getTime());
    expect(desde.getTime()).toBe(ultima.getTime() - 10 * 60_000);
  });

  it('mensagem muito antiga não faz reler meses de conversa', async () => {
    const lead = await criarLead();
    const agora = new Date('2026-08-15T12:00:00Z');
    const antiga = new Date('2026-01-01T00:00:00Z');

    const conversa = await prisma.conversation.create({
      data: {
        id: `${lead.id}-sem-campanha`,
        leadId: lead.id,
        chatId: `${lead.telefoneNormalizado}@c.us`,
        ultimaMensagemEm: antiga,
      },
    });
    await prisma.message.create({
      data: {
        conversationId: conversa.id,
        leadId: lead.id,
        direcao: 'RECEBIDA',
        status: 'ENTREGUE',
        texto: 'oi',
        whatsappMessageId: `wa-antiga-${Date.now()}`,
        recebidaEm: antiga,
      },
    });

    const desde = await rec.inicioDaVarredura(agora);
    expect(desde.getTime()).toBe(agora.getTime() - 24 * 3600_000);
  });
});

describe('recuperarMensagensPerdidas', () => {
  it('processa a resposta que o evento ao vivo não entregou', async () => {
    const lead = await criarLead();
    const m = entrada(lead.telefoneNormalizado!, 'quero sim', new Date());
    const { adapter } = adapterCom([m]);

    const r = await rec.recuperarMensagensPerdidas(adapter, log);

    expect(r.lidas).toBe(1);
    expect(r.novas).toBe(1);

    const gravada = await prisma.message.findFirst({
      where: { leadId: lead.id, direcao: 'RECEBIDA' },
    });
    expect(gravada?.texto).toBe('quero sim');
    // Classificada como qualquer outra: a varredura entra pelo MESMO
    // pipeline. Um caminho paralelo divergiria no primeiro ajuste.
    expect(gravada?.categoria).toBe('POSITIVO');
  });

  it('rodar duas vezes não duplica nada', async () => {
    const lead = await criarLead();
    const m = entrada(lead.telefoneNormalizado!, 'quero sim', new Date(), 'fixo-1');
    const { adapter } = adapterCom([m]);

    const primeira = await rec.recuperarMensagensPerdidas(adapter, log);
    const segunda = await rec.recuperarMensagensPerdidas(adapter, log);

    expect(primeira.novas).toBe(1);
    expect(segunda.novas).toBe(0);
    expect(segunda.jaConhecidas).toBe(1);

    // A idempotência é por `provider_message_id`, garantida por UNIQUE.
    // Sem ela, cada reinício do worker reprocessaria a conversa inteira
    // e reaplicaria todos os efeitos.
    expect(
      await prisma.message.count({ where: { leadId: lead.id, direcao: 'RECEBIDA' } })
    ).toBe(1);
  });

  it('uma mensagem quebrada não impede as outras', async () => {
    const lead = await criarLead();
    const boa = entrada(lead.telefoneNormalizado!, 'quero sim', new Date());
    // Telefone vazio: cai como contato desconhecido, não derruba nada.
    const ruim = entrada('', 'sei lá', new Date());

    const { adapter } = adapterCom([ruim, boa]);
    const r = await rec.recuperarMensagensPerdidas(adapter, log);

    expect(r.lidas).toBe(2);
    const gravada = await prisma.message.findFirst({
      where: { leadId: lead.id, direcao: 'RECEBIDA' },
    });
    expect(gravada).not.toBeNull();
  });

  it('pede ao adapter a partir da data calculada, não do zero', async () => {
    const { adapter, pedidos } = adapterCom([]);
    const agora = new Date('2026-08-15T12:00:00Z');

    // Janelas explícitas nos dois: o assunto aqui é o adapter receber a
    // data calculada, não qual janela vale.
    await rec.recuperarMensagensPerdidas(adapter, log, agora, 24, 24);

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.getTime()).toBe(agora.getTime() - 24 * 3600_000);
  });
});

// ---------------------------------------------------------------------------
// O CENÁRIO EXATO QUE ACONTECEU
// ---------------------------------------------------------------------------
describe('o caso real: resposta no mesmo minuto do envio, worker reiniciando', () => {
  it('a resposta perdida é recuperada e a sequência volta a andar', async () => {
    const lead = await criarLead();

    const campanha = await prisma.campaign.create({
      data: {
        nome: `Real ${Date.now()}`,
        status: 'ATIVA',
        dryRun: true,
        delayMinSegundos: 0,
        delayMaxSegundos: 0,
        filtros: {} as never,
      },
    });

    const etapas = [];
    for (let i = 1; i <= 2; i += 1) {
      etapas.push(
        await prisma.campaignStep.create({
          data: {
            campaignId: campanha.id,
            ordem: i,
            texto: `Mensagem ${i} para {{empresa}}`,
            ativo: true,
          },
        })
      );
    }
    await prisma.campaignStepRule.create({
      data: {
        campaignStepId: etapas[0]!.id,
        categoria: 'POSITIVO',
        acao: 'AVANCAR',
      },
    });

    // Mensagem 1 saiu 01:18:48; o lead está na etapa 1.
    const envio = new Date('2026-08-15T01:18:48');
    await prisma.leadCampaign.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        status: 'AGUARDANDO_RESPOSTA',
        etapaAtualId: etapas[0]!.id,
        etapaAtualOrdem: 1,
        totalEnviadas: 1,
      },
    });

    // O lead respondeu 01:18 — ANTES do segundo do envio, porque o
    // WhatsApp arredonda para o minuto. O worker estava reiniciando e o
    // evento nunca chegou.
    const resposta = entrada(
      lead.telefoneNormalizado!,
      'claro!',
      new Date('2026-08-15T01:18:00')
    );
    void envio;

    const { adapter } = adapterCom([resposta]);
    const r = await rec.recuperarMensagensPerdidas(
      adapter,
      log,
      new Date('2026-08-15T01:25:00')
    );

    expect(r.novas).toBe(1);

    // Classificada...
    const gravada = await prisma.message.findFirstOrThrow({
      where: { leadId: lead.id, direcao: 'RECEBIDA' },
    });
    expect(gravada.categoria).toBe('POSITIVO');

    // ...e a etapa 2 entrou na fila. Sem a varredura, esta linha não
    // existiria e a sequência ficaria parada para sempre.
    const proxima = await prisma.outboundMessage.findFirst({
      where: { leadId: lead.id, campaignStepId: etapas[1]!.id },
    });
    expect(proxima).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A MARCA DO RESET
//
// O reset apaga o banco, mas não apaga a conversa no WhatsApp — nem
// poderia. Sem uma marca, os "quero sim" dos testes anteriores seriam
// lidos como respostas novas e o lead recém-importado nasceria QUENTE.
//
// No uso real é pior: reimportar uma lista para uma campanha nova faria
// cada lead herdar a última resposta dada à campanha ANTERIOR — e um
// "não tenho interesse" de três meses atrás encerraria a nova sequência
// antes da primeira mensagem sair.
// ---------------------------------------------------------------------------
describe('a marca deixada pelo reset de fábrica', () => {
  async function marcar(quando: Date | null): Promise<void> {
    if (quando === null) {
      await prisma.setting.deleteMany({ where: { chave: rec.CHAVE_VARREDURA_DESDE } });
      return;
    }
    await prisma.setting.upsert({
      where: { chave: rec.CHAVE_VARREDURA_DESDE },
      update: { valor: quando.toISOString() },
      create: {
        chave: rec.CHAVE_VARREDURA_DESDE,
        valor: quando.toISOString(),
        descricao: 'teste',
        categoria: 'canal',
      },
    });
  }

  afterEach(async () => {
    await marcar(null);
  });

  it('a varredura não olha antes da marca', async () => {
    const agora = new Date('2026-08-15T12:00:00Z');
    const reset = new Date('2026-08-15T11:30:00Z');
    await marcar(reset);

    // Sem a marca seriam 24h para trás.
    const desde = await rec.inicioDaVarredura(agora);
    expect(desde.getTime()).toBe(reset.getTime());
  });

  it('a marca vence até a última mensagem conhecida', async () => {
    const lead = await criarLead();
    const agora = new Date('2026-08-15T12:00:00Z');
    const antesDoReset = new Date('2026-08-15T10:00:00Z');
    const reset = new Date('2026-08-15T11:30:00Z');

    const conversa = await prisma.conversation.create({
      data: {
        id: `${lead.id}-sem-campanha`,
        leadId: lead.id,
        chatId: `${lead.telefoneNormalizado}@c.us`,
        ultimaMensagemEm: antesDoReset,
      },
    });
    await prisma.message.create({
      data: {
        conversationId: conversa.id,
        leadId: lead.id,
        direcao: 'RECEBIDA',
        status: 'ENTREGUE',
        texto: 'resposta velha',
        whatsappMessageId: `wa-velha-${Date.now()}`,
        recebidaEm: antesDoReset,
      },
    });
    await marcar(reset);

    // A marca é uma afirmação explícita — "o que veio antes disto não me
    // pertence". Nenhum cálculo de janela pode passar por cima dela.
    const desde = await rec.inicioDaVarredura(agora);
    expect(desde.getTime()).toBe(reset.getTime());
  });

  it('resposta anterior ao reset não é reprocessada', async () => {
    const lead = await criarLead();
    const agora = new Date('2026-08-15T12:00:00Z');
    const reset = new Date('2026-08-15T11:30:00Z');
    await marcar(reset);

    const velha = entrada(
      lead.telefoneNormalizado!,
      'quero sim',
      new Date('2026-08-15T10:00:00Z')
    );
    const { adapter } = adapterCom([velha]);

    const r = await rec.recuperarMensagensPerdidas(adapter, log, agora);

    expect(r.lidas).toBe(0);
    expect(
      await prisma.message.count({ where: { leadId: lead.id, direcao: 'RECEBIDA' } })
    ).toBe(0);
    // E o lead continua frio: ele não conversou com esta campanha.
    const depois = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(depois.temperatura).toBe('FRIO');
  });

  it('resposta DEPOIS do reset entra normalmente', async () => {
    const lead = await criarLead();
    const agora = new Date('2026-08-15T12:00:00Z');
    const reset = new Date('2026-08-15T11:30:00Z');
    await marcar(reset);

    const nova = entrada(
      lead.telefoneNormalizado!,
      'quero sim',
      new Date('2026-08-15T11:45:00Z')
    );
    const { adapter } = adapterCom([nova]);

    const r = await rec.recuperarMensagensPerdidas(adapter, log, agora);
    expect(r.novas).toBe(1);
  });

  it('marca corrompida é ignorada em vez de quebrar a varredura', async () => {
    await prisma.setting.upsert({
      where: { chave: rec.CHAVE_VARREDURA_DESDE },
      update: { valor: 'isto nao e uma data' },
      create: {
        chave: rec.CHAVE_VARREDURA_DESDE,
        valor: 'isto nao e uma data',
        descricao: 'teste',
        categoria: 'canal',
      },
    });

    const agora = new Date('2026-08-15T12:00:00Z');
    // `Invalid Date` numa comparação dá sempre false, e a varredura
    // passaria a ler tudo de novo sem nenhum sinal.
    const desde = await rec.inicioDaVarredura(agora);
    expect(Number.isNaN(desde.getTime())).toBe(false);
    expect(desde.getTime()).toBe(agora.getTime() - 240 * 3600_000);
  });
});
