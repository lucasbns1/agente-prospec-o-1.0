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
// Sem isto, os tres casos de travamento esperariam 90s cada — quatro
// minutos e meio de suite parada para exercitar um `Promise.race`.
process.env.ENVIO_TIMEOUT_SEGUNDOS = '1';

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

// ---------------------------------------------------------------------------
// O ENVIO INTERROMPIDO NO MEIO
//
// O BullMQ considera "travado" um job cujo worker sumiu — reinício,
// Ctrl+C, queda do Chromium — e o reexecuta. A reserva então encontrava
// o PROCESSANDO que ela mesma tinha deixado, devolvia `count: 0`, e o
// handler ia embora dizendo "já processada".
//
// Resultado visto em uso real, e do jeito mais confuso possível: a
// mensagem CHEGOU no celular do lead, a fila mostrava "Processando", e
// o diagnóstico mostrava `outbound_send: concluído 2 | FALHOU 0`. Nada
// acusava erro em lugar nenhum. Como a etapa nunca concluía, o lead
// ficava parado e a próxima mensagem nunca nascia.
// ---------------------------------------------------------------------------
describe('envio interrompido no meio', () => {
  async function mensagemPresa(dryRun: boolean) {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha(true);

    // Uma linha exatamente como o worker a deixa ao ser interrompido:
    // reservada, marcada PROCESSANDO, e nunca concluída.
    const m = await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapas[0]!.id,
        idempotencyKey: `presa-${Date.now()}-${n}`,
        status: 'PROCESSANDO',
        telefoneDestino: lead.telefoneNormalizado,
        textoRenderizado: 'oi',
        textoTemplate: 'oi',
        variaveisUsadas: {},
        dryRun,
      },
    });
    return { lead, m };
  }

  async function reprocessar(outboundMessageId: string): Promise<void> {
    const { QUEUES } = await import('@prospector/shared');
    const fila = filas.getFila(QUEUES.OUTBOUND_SEND);
    const { QueueEvents } = await import('bullmq');
    const eventos = new QueueEvents(QUEUES.OUTBOUND_SEND, {
      connection: (await import('../apps/worker/src/redis.js')).opcoesRedis(),
    });
    await eventos.waitUntilReady();

    // Sem `jobId` fixo: este é o job que o BullMQ recria ao considerar o
    // anterior travado.
    const job = await fila.add('enviar', { outboundMessageId });
    await job.waitUntilFinished(eventos, 15_000).catch(() => undefined);
    await eventos.close();
  }

  it('mensagem REAL presa vira FALHOU, com o motivo escrito', async () => {
    const { m } = await mensagemPresa(false);

    await reprocessar(m.id);

    const depois = await prisma.outboundMessage.findUniqueOrThrow({
      where: { id: m.id },
    });
    // Antes: continuava PROCESSANDO para sempre, com o job marcado
    // concluído no Redis. Nada acusava o problema.
    expect(depois.status).toBe('FALHOU');
    expect(depois.erro).toMatch(/PODE ter saído/i);
  }, 30_000);

  it('mensagem REAL presa NÃO é reenviada automaticamente', async () => {
    const { m } = await mensagemPresa(false);
    await reprocessar(m.id);

    const depois = await prisma.outboundMessage.findUniqueOrThrow({
      where: { id: m.id },
    });
    // Devolver para a fila mandaria a mesma frase duas vezes na conversa
    // de um cliente — e no caso real que originou este código, a
    // mensagem tinha chegado.
    expect(depois.status).not.toBe('AGENDADA');
  }, 30_000);

  it('mensagem SIMULADA presa volta para a fila', async () => {
    const { m } = await mensagemPresa(true);
    await reprocessar(m.id);

    const depois = await prisma.outboundMessage.findUniqueOrThrow({
      where: { id: m.id },
    });
    // Simulação não tocou o WhatsApp: reenviar é seguro, e o dry-run
    // existe justamente para ensaiar o fluxo inteiro.
    expect(depois.status).toBe('AGENDADA');
  }, 30_000);

  it('mensagem já ENVIADA continua ENVIADA — isso sim é duplicata', async () => {
    const { m } = await mensagemPresa(false);
    await prisma.outboundMessage.update({
      where: { id: m.id },
      data: { status: 'ENVIADA', processedAt: new Date() },
    });

    await reprocessar(m.id);

    const depois = await prisma.outboundMessage.findUniqueOrThrow({
      where: { id: m.id },
    });
    // O caminho antigo continua valendo para o caso que ele realmente
    // resolvia: outra execução terminou o trabalho.
    expect(depois.status).toBe('ENVIADA');
    expect(depois.erro).toBeNull();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// O ENVIO QUE TRAVA MAS SAI
//
// `sendMessage` às vezes entrega a mensagem e nunca resolve a promessa.
// O código anterior só podia supor, e escolhia o caminho conservador:
// FALHOU, "PODE ter saído".
//
// Só que ela tinha saído — três vezes seguidas em uso real. Mensagem
// entregue no celular do lead às 12:47 e a fila marcando "Falhou". A
// sequência parava numa falha que não existia: a etapa não avançava, e
// a mensagem 3 nunca nascia.
//
// O WhatsApp sabe a resposta. A mensagem está na conversa.
// ---------------------------------------------------------------------------
describe('envio que trava mas chega', () => {
  /**
   * Adapter que reproduz o travamento: `sendMessage` nunca resolve.
   *
   * `saiu` decide o que a conversa vai dizer quando for consultada — é
   * a diferença entre "travou e chegou" e "travou e não chegou".
   */
  function adapterQueTrava(saiu: boolean) {
    const consultas: Array<{ texto: string; desde: Date }> = [];
    return {
      adapter: {
        modo: 'live' as const,
        sendMessage: () => new Promise<never>(() => {}),
        confirmarEnvio: async (_t: string, texto: string, desde: Date) => {
          consultas.push({ texto, desde });
          return saiu ? 'wa-confirmado-123' : null;
        },
        isRegistered: async () => true,
        getContacts: async () => [],
        mensagensPerdidas: async () => [],
        connect: async () => {},
        disconnect: async () => {},
        getStatus: () => ({ status: 'CONECTADO', modo: 'live' }),
        onReady: () => {},
        onQr: () => {},
        onMessage: () => {},
        onDisconnected: () => {},
        onStatusChange: () => {},
      } as never,
      consultas,
    };
  }

  async function enviarCom(adapter: never, dryRunCampanha: boolean) {
    const { criarWorkerOutbound } = await import(
      '../apps/worker/src/workers/outbound.js'
    );

    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha(true);
    await prisma.campaign.update({
      where: { id: campanha.id },
      data: { dryRun: dryRunCampanha },
    });

    // O vínculo é o que o quadro lê. Sem ele, o `updateMany` do worker
    // não encontra linha e o avanço de etapa passa despercebido — que é
    // justamente o que este teste precisa observar.
    await prisma.leadCampaign.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        status: 'PENDENTE',
      },
    });

    const m = await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapas[0]!.id,
        idempotencyKey: `trava-${Date.now()}-${n}`,
        status: 'AGENDADA',
        telefoneDestino: lead.telefoneNormalizado,
        textoRenderizado: 'Olá!',
        textoTemplate: 'Olá!',
        variaveisUsadas: {},
        dryRun: dryRunCampanha,
        scheduledAt: new Date(),
      },
    });

    // Worker próprio, com o adapter que trava. O de cima não serve: ele
    // responde na hora.
    //
    // `WHATSAPP_MODE=live` só aqui: sem ele o worker toma o caminho de
    // simulação e nunca chega a chamar `sendMessage` — não haveria
    // travamento nenhum para exercitar. O adapter continua sendo de
    // mentira, então nada sai.
    const modoAntes = process.env.WHATSAPP_MODE;
    process.env.WHATSAPP_MODE = 'live';

    // O worker do `beforeAll` escuta a MESMA fila e responde na hora —
    // ele pegaria o job antes deste e o travamento nunca aconteceria.
    // Levou uma rodada de teste para aparecer.
    await workerOutbound.pause();

    const w = criarWorkerOutbound(log, adapter);
    await w.waitUntilReady();
    try {
      await processarFila();
    } finally {
      await w.close();
      await workerOutbound.resume();
      if (modoAntes === undefined) delete process.env.WHATSAPP_MODE;
      else process.env.WHATSAPP_MODE = modoAntes;
    }

    return { m, lead, etapas };
  }

  it('travou mas a mensagem ESTÁ na conversa: conta como enviada', async () => {
    const { adapter, consultas } = adapterQueTrava(true);
    const { m, lead, etapas } = await enviarCom(adapter, false);

    const depois = await prisma.outboundMessage.findUniqueOrThrow({
      where: { id: m.id },
    });

    // Antes: FALHOU, e a sequência morria numa falha que não existia.
    expect(depois.status).toBe('ENVIADA');

    // O id do WhatsApp fica na mensagem gravada, não na linha da fila —
    // e é ele que amarra a confirmação de entrega (ACK) depois.
    const gravada = await prisma.message.findFirstOrThrow({
      where: { leadId: lead.id, direcao: 'ENVIADA' },
    });
    expect(gravada.whatsappMessageId).toBe('wa-confirmado-123');
    expect(gravada.simulada).toBe(false);

    // E a etapa avança — que era o ponto de tudo isto.
    const vinculo = await prisma.leadCampaign.findFirst({ where: { leadId: lead.id } });
    expect(vinculo?.etapaAtualId).toBe(etapas[0]!.id);

    // A busca na conversa olha para trás a partir do envio, não do
    // início dos tempos: uma janela larga demais acharia uma mensagem
    // idêntica de outra campanha.
    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.texto).toBe('Olá!');
    expect(consultas[0]!.desde.getTime()).toBeLessThan(Date.now());
  }, 60_000);

  it('travou e NÃO está na conversa: aí sim é falha', async () => {
    const { adapter } = adapterQueTrava(false);
    const { m } = await enviarCom(adapter, false);

    const depois = await prisma.outboundMessage.findUniqueOrThrow({
      where: { id: m.id },
    });
    expect(depois.status).toBe('FALHOU');
    expect(depois.erro).toMatch(/PODE ter saído/i);
  }, 60_000);

  it('a falha vira notificação — não fica só na aba Fila', async () => {
    const { adapter } = adapterQueTrava(false);
    const { lead } = await enviarCom(adapter, false);

    // Antes, uma falha de envio só existia na Fila. Quem não abrisse
    // aquela tela nunca saberia, e a sequência daquele lead parava em
    // silêncio.
    const aviso = await prisma.notification.findFirst({
      where: { leadId: lead.id },
    });
    expect(aviso).not.toBeNull();
    expect(aviso?.nivel).toBe('ERRO');
    expect(aviso?.mensagem).toMatch(/PODE ter saído/i);
  }, 60_000);

  it('não reenvia sozinho nem quando não confirmou', async () => {
    const { adapter } = adapterQueTrava(false);
    const { m } = await enviarCom(adapter, false);

    const depois = await prisma.outboundMessage.findUniqueOrThrow({
      where: { id: m.id },
    });
    // "Não achei" não é o mesmo que "não saiu". Devolver para a fila
    // mandaria a mesma frase duas vezes na conversa de um cliente.
    expect(depois.status).not.toBe('AGENDADA');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// OS DOIS CENÁRIOS QUE PRECISAM ESTAR PROVADOS
// ---------------------------------------------------------------------------
describe('WhatsApp envia → erro depois → NÃO marca FALHOU', () => {
  /**
   * Adapter que envia com sucesso, como o real faz.
   */
  function adapterQueEnvia() {
    return {
      modo: 'live' as const,
      sendMessage: async () => ({
        sucesso: true,
        whatsappMessageId: 'wa-entregue-777',
        simulado: false,
      }),
      confirmarEnvio: async () => null,
      isRegistered: async () => true,
      getContacts: async () => [],
      mensagensPerdidas: async () => [],
      connect: async () => {},
      disconnect: async () => {},
      getStatus: () => ({ status: 'CONECTADO', modo: 'live' }),
      onReady: () => {}, onQr: () => {}, onMessage: () => {},
      onDisconnected: () => {}, onStatusChange: () => {},
    } as never;
  }

  it('envio OK + pós-processamento quebrado = ENVIADA, nunca FALHOU', async () => {
    const { criarWorkerOutbound } = await import(
      '../apps/worker/src/workers/outbound.js'
    );
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha(true);
    await prisma.campaign.update({
      where: { id: campanha.id },
      data: { dryRun: false },
    });

    const m = await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapas[0]!.id,
        idempotencyKey: `pos-${Date.now()}-${n}`,
        status: 'AGENDADA',
        telefoneDestino: lead.telefoneNormalizado,
        textoRenderizado: 'Olá!',
        textoTemplate: 'Olá!',
        variaveisUsadas: {},
        dryRun: false,
        scheduledAt: new Date(),
      },
    });

    // A quebra do pós-processamento, provocada de propósito: apagar a
    // etapa faz a criação da Message violar a chave estrangeira, e isso
    // acontece DEPOIS de o WhatsApp já ter aceitado o envio.
    //
    // É a forma mais fiel de reproduzir o caso real, em que o transporte
    // deu certo e algo posterior falhou.
    const modoAntes = process.env.WHATSAPP_MODE;
    process.env.WHATSAPP_MODE = 'live';
    await workerOutbound.pause();

    const w = criarWorkerOutbound(log, adapterQueEnvia());
    await w.waitUntilReady();
    try {
      const { QUEUES } = await import('@prospector/shared');
      await despachante.varrer(new Date());

      // Quebra o pós-processamento no instante em que o job já saiu.
      await prisma.conversation.deleteMany({ where: { leadId: lead.id } });
      await prisma.$executeRawUnsafe(
        `ALTER TABLE messages ADD CONSTRAINT quebra_proposital CHECK (texto <> 'Olá!')`
      );

      const fila = filas.getFila(QUEUES.OUTBOUND_SEND);
      const { QueueEvents } = await import('bullmq');
      const ev = new QueueEvents(QUEUES.OUTBOUND_SEND, {
        connection: (await import('../apps/worker/src/redis.js')).opcoesRedis(),
      });
      await ev.waitUntilReady();
      const jobs = await fila.getJobs(['waiting', 'active', 'delayed', 'completed']);
      await Promise.all(
        jobs.map((j) => j.waitUntilFinished(ev, 15_000).catch(() => undefined))
      );
      await ev.close();
    } finally {
      await prisma
        .$executeRawUnsafe(`ALTER TABLE messages DROP CONSTRAINT IF EXISTS quebra_proposital`)
        .catch(() => undefined);
      await w.close();
      await workerOutbound.resume();
      if (modoAntes === undefined) delete process.env.WHATSAPP_MODE;
      else process.env.WHATSAPP_MODE = modoAntes;
    }

    const depois = await prisma.outboundMessage.findUniqueOrThrow({
      where: { id: m.id },
    });

    // O CRITÉRIO DE ACEITAÇÃO: o WhatsApp entregou, então o CRM diz
    // ENVIADA. O erro posterior é registrado, não vira falha de envio.
    expect(depois.status).toBe('ENVIADA');
    expect(depois.erro).toMatch(/pós-processamento/i);
  }, 60_000);
});

describe('M2 enviada → M3 exige intervenção, e NÃO sai sozinha', () => {
  it('cria notificação, para a cadência e não enfileira a M3', async () => {
    const avanco = await import('../apps/worker/src/services/avancar-etapa.js');
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha(true);

    // A M3 é a da prévia: só sai quando você liberar.
    await prisma.campaignStep.update({
      where: { id: etapas[2]!.id },
      data: { enviarAutomaticamente: false, notificarAoChegar: true },
    });

    // O lead acabou de receber a M2.
    await prisma.leadCampaign.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        status: 'AGUARDANDO_RESPOSTA',
        etapaAtualId: etapas[1]!.id,
        etapaAtualOrdem: 2,
        totalEnviadas: 2,
      },
    });

    const r = await avanco.enfileirarProximaEtapa({
      leadId: lead.id,
      campaignId: campanha.id,
      etapaAtualId: etapas[1]!.id,
    });

    expect(r.motivo).toBe('ETAPA_MANUAL');

    // 1. NÃO enfileirou nada. Uma linha AGENDADA que ninguém pode
    //    despachar ficaria na fila fingindo que vai sair.
    expect(
      await prisma.outboundMessage.count({
        where: { leadId: lead.id, campaignStepId: etapas[2]!.id },
      })
    ).toBe(0);

    // 2. O lead saiu da automação e está esperando você. `PAUSADO` é o
    //    status que o quadro lê como "Precisa de você".
    const vinculo = await prisma.leadCampaign.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(vinculo.status).toBe('PAUSADO');
    expect(vinculo.aguardandoLiberacao).toBe(true);

    // 3. Você foi avisado.
    const aviso = await prisma.notification.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(aviso.tipo).toBe('PEDIDO_PREVIEW');

    // 4. E existe uma tarefa — o aviso some da tela; a tarefa fica até
    //    alguém fazer o trabalho.
    const tarefa = await prisma.task.findFirst({ where: { leadId: lead.id } });
    expect(tarefa).not.toBeNull();
    expect(tarefa?.tipo).toBe('CRIAR_PREVIEW');
  }, 30_000);
});
