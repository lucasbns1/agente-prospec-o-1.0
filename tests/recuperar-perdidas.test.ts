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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  it('sem nenhuma mensagem, olha 24h para trás', async () => {
    const agora = new Date('2026-08-15T12:00:00Z');
    const desde = await rec.inicioDaVarredura(agora);
    expect(desde.getTime()).toBe(agora.getTime() - 24 * 3600_000);
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

    await rec.recuperarMensagensPerdidas(adapter, log, agora);

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
