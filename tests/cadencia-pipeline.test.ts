/**
 * A cadência de ponta a ponta, pelo pipeline REAL.
 *
 * ============================================================
 * O QUE ESTE ARQUIVO ATRAVESSA
 * ============================================================
 *   Postgres  ->  despachante (varredura)
 *             ->  BullMQ / Redis
 *             ->  worker de outbound (o de verdade)
 *             ->  adapter simulado
 *             ->  Postgres
 *
 * Não é teste de função pura. Se qualquer elo dessa corrente estiver
 * partido, aqui quebra — que é exatamente o que os testes unitários não
 * conseguiam mostrar.
 *
 * ============================================================
 * AS DUAS CADÊNCIAS
 * ============================================================
 * Uma etapa pode esperar de dois jeitos, e são mecanismos diferentes:
 *
 *   `aguardarResposta: true`  — a sequência congela até o lead falar.
 *                               O avanço nasce da resposta.
 *   `aguardarResposta: false` — a sequência anda sozinha, no tempo
 *                               configurado. Não depende de resposta.
 *
 * A segunda NUNCA existiu. O worker gravava
 * `LeadCampaign.status = 'EM_ANDAMENTO'` e nenhum código no sistema
 * inteiro lia esse status — verificável com um grep. O lead parava ali
 * para sempre, sem erro, sem job, sem nada na fila.
 *
 * NENHUM ENVIO REAL: o adapter é o simulado e a campanha está em
 * dry-run. Ao final, mensagens reais enviadas = 0.
 *
 * Requer Postgres e Redis no ar, migrado e com seed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { Logger } from 'pino';
import type { Worker } from 'bullmq';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });
process.env.LOG_LEVEL = 'silent';

const log = {
  error: () => {}, info: () => {}, warn: () => {}, debug: () => {},
} as unknown as Logger;

let prisma: typeof import('@prospector/database').prisma;
let despachante: typeof import('../apps/worker/src/workers/despachante.js');
let filas: typeof import('../apps/worker/src/queues.js');
let workerOutbound: Worker;

beforeAll(async () => {
  prisma = (await import('@prospector/database')).prisma;
  despachante = await import('../apps/worker/src/workers/despachante.js');
  filas = await import('../apps/worker/src/queues.js');

  const { criarWorkerOutbound } = await import(
    '../apps/worker/src/workers/outbound.js'
  );
  const { FakeWhatsAppAdapter } = await import('@prospector/integrations');

  filas.inicializarFilas();
  // Adapter simulado: ele registra o que TERIA sido enviado e devolve
  // sucesso. Nenhum byte sai para o WhatsApp.
  workerOutbound = criarWorkerOutbound(log, new FakeWhatsAppAdapter());
  await workerOutbound.waitUntilReady();
}, 60_000);

afterAll(async () => {
  await workerOutbound?.close();
  await filas?.fecharFilas();
  await prisma?.$disconnect();
});

beforeEach(async () => {
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
      nomeCompleto: `Studio Cadencia ${n}`,
      empresa: `Studio Cadencia ${n}`,
      telefone: `(11) 9${String(70000000 + n).slice(-8)}`,
      telefoneNormalizado: `55119${String(70000000 + n).slice(-8)}`,
      cidade: 'São Paulo',
      websiteStatus: 'NAO_INFORMADO',
      status: 'PRONTO',
    } as never,
  });
}

/**
 * Campanha de 3 etapas.
 *
 * `aguardarResposta` decide qual das duas cadências está sendo
 * exercitada. Delays em zero: o teste não pode depender de relógio de
 * parede — esperar de verdade tornaria a suíte lenta e intermitente.
 */
async function criarCampanha(aguardarResposta: boolean) {
  const campanha = await prisma.campaign.create({
    data: {
      nome: `Cadencia ${Date.now()}-${n}`,
      status: 'ATIVA',
      dryRun: true,
      delayMinSegundos: 0,
      delayMaxSegundos: 0,
      delayEntreLeadsMinSegundos: 0,
      delayEntreLeadsMaxSegundos: 0,
      horarioInicio: '00:00',
      horarioFim: '23:59',
      diasPermitidos: [0, 1, 2, 3, 4, 5, 6],
      filtros: {} as never,
    },
  });

  const etapas = [];
  for (let i = 1; i <= 3; i += 1) {
    etapas.push(
      await prisma.campaignStep.create({
        data: {
          campaignId: campanha.id,
          ordem: i,
          texto: `Mensagem ${i} para {{empresa}}`,
          ativo: true,
          aguardarResposta,
          enviarAutomaticamente: true,
        },
      })
    );
  }
  return { campanha, etapas };
}

/**
 * Roda a varredura e espera a fila esvaziar.
 *
 * O `waitUntilFinished` de cada job é o que torna o teste
 * determinístico: sem ele restaria `setTimeout`, que é lento quando
 * funciona e mentiroso quando não funciona.
 */
async function processarFila(agora = new Date()): Promise<number> {
  const { QUEUES } = await import('@prospector/shared');
  const r = await despachante.varrer(agora);
  if (r.despachadas === 0) return 0;

  const fila = filas.getFila(QUEUES.OUTBOUND_SEND);
  const eventos = new (await import('bullmq')).QueueEvents(QUEUES.OUTBOUND_SEND, {
    connection: (await import('../apps/worker/src/redis.js')).opcoesRedis(),
  });
  await eventos.waitUntilReady();

  const jobs = await fila.getJobs(['waiting', 'active', 'delayed', 'completed']);
  await Promise.all(
    jobs.map((j) => j.waitUntilFinished(eventos, 15_000).catch(() => undefined))
  );
  await eventos.close();
  return r.despachadas;
}

async function statusDaEtapa(leadId: string, etapaId: string): Promise<string | null> {
  const m = await prisma.outboundMessage.findFirst({
    where: { leadId, campaignStepId: etapaId },
  });
  return m?.status ?? null;
}

// ---------------------------------------------------------------------------
// MENSAGEM 1 — o começo funciona
// ---------------------------------------------------------------------------
describe('Mensagem 1 atravessa o pipeline inteiro', () => {
  it('sai de AGENDADA e chega a SIMULADA passando pelo worker de verdade', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha(true);

    const servico = await import('../apps/api/src/services/campaign-service.js');
    await servico.enfileirarCampanha(campanha.id);

    // Antes de o worker rodar: AGENDADA. Nunca "enviada" só porque
    // existe uma linha no banco.
    expect(await statusDaEtapa(lead.id, etapas[0]!.id)).toBe('AGENDADA');

    await processarFila();

    // Dry-run: SIMULADA, não ENVIADA. Os dois estados são diferentes de
    // propósito — confundi-los faria a fila mentir sobre o que saiu.
    expect(await statusDaEtapa(lead.id, etapas[0]!.id)).toBe('SIMULADA');

    const vinculo = await prisma.leadCampaign.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(vinculo.etapaAtualOrdem).toBe(1);
    expect(vinculo.totalEnviadas).toBe(1);
  }, 30_000);

  it('a etapa 2 NÃO nasce sozinha quando a etapa espera resposta', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha(true);

    const servico = await import('../apps/api/src/services/campaign-service.js');
    await servico.enfileirarCampanha(campanha.id);
    await processarFila();

    // Correto: `aguardarResposta: true` significa "congela até ele
    // falar". Mandar a 2 sozinha aqui seria falar duas vezes sem o lead
    // ter dito nada.
    expect(await statusDaEtapa(lead.id, etapas[1]!.id)).toBeNull();

    const vinculo = await prisma.leadCampaign.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(vinculo.status).toBe('AGUARDANDO_RESPOSTA');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// A CADÊNCIA POR TEMPO — o bug
// ---------------------------------------------------------------------------
describe('cadência por tempo (aguardarResposta: false)', () => {
  it('MSG_1 -> MSG_2 -> MSG_3 -> fim, sem nenhuma resposta do lead', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha(false);

    const servico = await import('../apps/api/src/services/campaign-service.js');
    await servico.enfileirarCampanha(campanha.id);

    // --- MSG 1 ---
    await processarFila();
    expect(await statusDaEtapa(lead.id, etapas[0]!.id)).toBe('SIMULADA');

    // --- MSG 2 ---
    // Aqui é onde a sequência morria. O worker gravava
    // `status: 'EM_ANDAMENTO'` e ninguém lia esse status — nenhum
    // poller, nenhum job, nada. O lead ficava parado para sempre.
    await processarFila();
    expect(await statusDaEtapa(lead.id, etapas[1]!.id)).toBe('SIMULADA');

    // --- MSG 3 ---
    await processarFila();
    expect(await statusDaEtapa(lead.id, etapas[2]!.id)).toBe('SIMULADA');

    // --- Fim ---
    await processarFila();
    const vinculo = await prisma.leadCampaign.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(vinculo.status).toBe('CONCLUIDO');
    expect(vinculo.etapaAtualOrdem).toBe(3);
    expect(vinculo.totalEnviadas).toBe(3);

    // Exatamente 3 mensagens: nem uma a menos (sequência travada), nem
    // uma a mais (avanço disparado duas vezes).
    expect(await prisma.outboundMessage.count({ where: { leadId: lead.id } })).toBe(3);
  }, 60_000);

  it('não cria job nem mensagem depois da última etapa', async () => {
    const lead = await criarLead();
    const { campanha } = await criarCampanha(false);

    const servico = await import('../apps/api/src/services/campaign-service.js');
    await servico.enfileirarCampanha(campanha.id);
    for (let i = 0; i < 5; i += 1) await processarFila();

    // Cinco varreduras depois do fim: continua 3. Uma varredura que
    // insiste criaria mensagem vazia ou repetiria a última etapa.
    expect(await prisma.outboundMessage.count({ where: { leadId: lead.id } })).toBe(3);
  }, 60_000);

  it('campanha pausada no meio interrompe a cadência', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha(false);

    const servico = await import('../apps/api/src/services/campaign-service.js');
    await servico.enfileirarCampanha(campanha.id);
    await processarFila();

    await prisma.campaign.update({
      where: { id: campanha.id },
      data: { status: 'PAUSADA' },
    });

    await processarFila();
    await processarFila();

    // Pausar tem de significar alguma coisa. Se a cadência continuasse,
    // o botão de pausa seria decorativo.
    expect(await statusDaEtapa(lead.id, etapas[1]!.id)).toBeNull();
  }, 60_000);

  it('lead em opt-out sai da cadência', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha(false);

    const servico = await import('../apps/api/src/services/campaign-service.js');
    await servico.enfileirarCampanha(campanha.id);
    await processarFila();

    await prisma.lead.update({
      where: { id: lead.id },
      data: { optOut: true, optOutEm: new Date(), status: 'OPT_OUT' },
    });

    await processarFila();
    await processarFila();

    expect(await statusDaEtapa(lead.id, etapas[1]!.id)).toBeNull();
  }, 60_000);

  it('lead aguardando intervenção não avança sozinho', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha(false);

    const servico = await import('../apps/api/src/services/campaign-service.js');
    await servico.enfileirarCampanha(campanha.id);
    await processarFila();

    await prisma.leadCampaign.updateMany({
      where: { leadId: lead.id },
      data: { status: 'AGUARDANDO_INTERVENCAO' },
    });

    await processarFila();
    await processarFila();

    // Você assumiu a conversa. A automação não pode falar por cima.
    expect(await statusDaEtapa(lead.id, etapas[1]!.id)).toBeNull();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// NENHUM ENVIO REAL
// ---------------------------------------------------------------------------
describe('a garantia que não pode falhar', () => {
  it('depois de toda a cadência, mensagens REAIS enviadas = 0', async () => {
    const lead = await criarLead();
    const { campanha } = await criarCampanha(false);

    const servico = await import('../apps/api/src/services/campaign-service.js');
    await servico.enfileirarCampanha(campanha.id);
    for (let i = 0; i < 4; i += 1) await processarFila();

    const reais = await prisma.outboundMessage.count({
      where: { leadId: lead.id, dryRun: false, status: 'ENVIADA' },
    });
    expect(reais).toBe(0);

    // E todas passaram pelo pipeline — não ficaram paradas.
    const simuladas = await prisma.outboundMessage.count({
      where: { leadId: lead.id, status: 'SIMULADA' },
    });
    expect(simuladas).toBe(3);
  }, 60_000);
});
