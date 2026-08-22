/**
 * O orquestrador da cadencia, com o pipeline REAL.
 *
 * ============================================================
 * NENHUM DESTES TESTES CHAMA O GOOGLE
 * ============================================================
 * O analisador e um fake roteirizado. Nao por economia — por
 * determinismo. Um teste que depende de um modelo remoto falha por
 * motivos que nada tem a ver com o codigo, e um teste que falha sozinho
 * deixa de ser lido.
 *
 * O que E real aqui: Postgres, BullMQ, Redis, o worker de outbound de
 * verdade, o despachante de verdade, as quatro barreiras. Se qualquer
 * elo estiver partido, quebra aqui.
 *
 * NENHUM ENVIO REAL: adapter simulado + campanha em dry-run.
 *
 * Requer Postgres e Redis no ar, migrado e com seed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { Logger } from 'pino';
import type {
  AnalisadorDeCadencia,
  ResultadoAnalise,
} from '@prospector/integrations';
import type { ContextoCadencia, DecisaoIA } from '@prospector/domain';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });
process.env.LOG_LEVEL = 'silent';
process.env.ENVIO_TIMEOUT_SEGUNDOS = '1';

const log = {
  error: () => {}, info: () => {}, warn: () => {}, debug: () => {},
} as unknown as Logger;

let prisma: typeof import('@prospector/database').prisma;
let filas: typeof import('../apps/worker/src/queues.js');
let orq: typeof import('../apps/worker/src/services/orquestrador.js');

// ---------------------------------------------------------------------------
// O ANALISADOR FALSO
// ---------------------------------------------------------------------------

/**
 * Devolve sempre a mesma decisao, ou sempre a mesma falha.
 *
 * Guarda o ultimo contexto recebido: varios testes verificam nao o que a
 * IA respondeu, mas o que ela VIU — que e onde mora a regra de que o
 * modelo le o banco e nunca a propria memoria.
 */
class AnalisadorFalso implements AnalisadorDeCadencia {
  readonly modelo = 'fake-1.0';
  ultimoContexto: ContextoCadencia | null = null;
  chamadas = 0;

  constructor(private readonly resposta: ResultadoAnalise | (() => ResultadoAnalise)) {}

  async analisar(contexto: ContextoCadencia): Promise<ResultadoAnalise> {
    this.ultimoContexto = contexto;
    this.chamadas += 1;
    return typeof this.resposta === 'function' ? this.resposta() : this.resposta;
  }
}

function decide(over: Partial<DecisaoIA> = {}): ResultadoAnalise {
  return {
    ok: true,
    modelo: 'fake-1.0',
    latenciaMs: 12,
    decisao: {
      intent: 'INTERESSE',
      acao: 'WAIT',
      etapaOrdem: null,
      confianca: 90,
      precisaHumano: false,
      optOut: false,
      motivo: 'decisao de teste',
      esperarSegundos: null,
      ...over,
    },
  };
}

function falha(erro: string): ResultadoAnalise {
  return { ok: false, erro, modelo: 'fake-1.0', latenciaMs: 8000 };
}

// ---------------------------------------------------------------------------

// NENHUM WORKER DE OUTBOUND AQUI, DE PROPOSITO.
//
// Estes testes verificam o que o orquestrador DECIDE e o que ele grava —
// isto e, se a ordem de envio foi criada, e com que estado. O que
// acontece com essa ordem depois (varredura, fila, transporte, ACK) e o
// assunto de `cadencia-pipeline.test.ts`, que atravessa o caminho
// inteiro.
//
// Subir o worker aqui so criaria concorrencia entre dois consumidores da
// mesma fila e tornaria a suite intermitente.
beforeAll(async () => {
  prisma = (await import('@prospector/database')).prisma;
  filas = await import('../apps/worker/src/queues.js');
  orq = await import('../apps/worker/src/services/orquestrador.js');
  filas.inicializarFilas();
}, 60_000);

afterAll(async () => {
  await filas?.fecharFilas();
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await prisma.aiDecision.deleteMany();
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

async function cenario(opcoes: { etapa3Manual?: boolean } = {}) {
  n += 1;
  const lead = await prisma.lead.create({
    data: {
      nomeCompleto: `Studio IA ${n}`,
      empresa: `Studio IA ${n}`,
      telefone: `(11) 9${String(80000000 + n).slice(-8)}`,
      telefoneNormalizado: `55119${String(80000000 + n).slice(-8)}`,
      cidade: 'Campinas',
      bairro: 'Centro',
      websiteStatus: 'NAO_INFORMADO',
      status: 'PRONTO',
    } as never,
  });

  const campanha = await prisma.campaign.create({
    data: {
      nome: `Campanha IA ${Date.now()}-${n}`,
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
          // false: a sequencia anda sozinha. Deixa o motor comparavel
          // com a IA sem depender de o lead ter respondido.
          aguardarResposta: false,
          enviarAutomaticamente: i === 3 ? !opcoes.etapa3Manual : true,
        },
      })
    );
  }

  await prisma.leadCampaign.create({
    data: {
      leadId: lead.id,
      campaignId: campanha.id,
      status: 'PENDENTE',
    },
  });

  return { lead, campanha, etapas };
}

function opcoes(analisador: AnalisadorDeCadencia | null, somenteAnalise = false) {
  return { analisador, somenteAnalise, log };
}

async function envios(leadId: string) {
  return prisma.outboundMessage.findMany({
    where: { leadId },
    select: { status: true, campaignStep: { select: { ordem: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

// =============================================================================
// 1 a 5 — A CADENCIA BASICA
// =============================================================================

describe('a IA pede o envio das etapas na ordem', () => {
  it('1. M1 pendente -> a IA pede M1 e o backend enfileira', async () => {
    const { lead, campanha } = await cenario();
    const ia = new AnalisadorFalso(decide({ acao: 'SEND_STEP', etapaOrdem: 1 }));

    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      opcoes(ia)
    );

    expect(r?.acaoExecutada).toBe('SEND_STEP');
    expect(r?.resultado?.efetivada).toBe(true);

    const fila = await envios(lead.id);
    expect(fila).toHaveLength(1);
    expect(fila[0]?.campaignStep?.ordem).toBe(1);
  });

  // O caso que o usuario pediu explicitamente: reexecucao do modelo.
  it('2. M1 ja enviada -> a IA pede M1 de novo e NADA e criado', async () => {
    const { lead, campanha } = await cenario();
    const ia = new AnalisadorFalso(decide({ acao: 'SEND_STEP', etapaOrdem: 1 }));
    const o = opcoes(ia);

    await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      o
    );
    // Cinco reexecucoes do modelo pedindo exatamente a mesma coisa.
    for (let i = 0; i < 5; i += 1) {
      await orq.orquestrarCadencia(
        { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
        o
      );
    }

    expect(await envios(lead.id)).toHaveLength(1);
  });

  it('3. a IA nao consegue pular etapa: pediu a 3, o sistema recusa', async () => {
    const { lead, campanha } = await cenario();
    const ia = new AnalisadorFalso(decide({ acao: 'SEND_STEP', etapaOrdem: 3 }));

    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      opcoes(ia)
    );

    expect(r?.acaoExecutada).toBe('WAIT');
    expect(await envios(lead.id)).toHaveLength(0);

    const trilha = await prisma.aiDecision.findFirstOrThrow();
    expect(trilha.motivoRejeicao).toBe('PULO_DE_ETAPA');
  });

  it('4. etapa que nao existe e recusada', async () => {
    const { lead, campanha } = await cenario();
    const ia = new AnalisadorFalso(decide({ acao: 'SEND_STEP', etapaOrdem: 99 }));

    await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      opcoes(ia)
    );

    expect(await envios(lead.id)).toHaveLength(0);
    const trilha = await prisma.aiDecision.findFirstOrThrow();
    expect(trilha.motivoRejeicao).toBe('ETAPA_INEXISTENTE');
  });

  it('5. M1 enfileirada -> a proxima decisao ja e sobre a M2', async () => {
    const { lead, campanha } = await cenario();

    const ia1 = new AnalisadorFalso(decide({ acao: 'SEND_STEP', etapaOrdem: 1 }));
    await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      opcoes(ia1)
    );

    const ia2 = new AnalisadorFalso(decide({ acao: 'SEND_STEP', etapaOrdem: 2 }));
    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      opcoes(ia2)
    );

    expect(r?.resultado?.efetivada).toBe(true);
    const fila = await envios(lead.id);
    expect(fila.map((e) => e.campaignStep?.ordem).sort()).toEqual([1, 2]);
  });
});

// =============================================================================
// 6 — A IA SABE EXATAMENTE ONDE O LEAD ESTA
// =============================================================================

describe('o que a IA VE e o estado real do banco', () => {
  it('6. o contexto entregue mostra a etapa 1 ENVIADA e aponta a 2 como proxima', async () => {
    const { lead, campanha, etapas } = await cenario();

    await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapas[0]!.id,
        idempotencyKey: `teste-ctx-${lead.id}-1`,
        status: 'ENVIADA',
        textoRenderizado: 'Mensagem 1',
        processedAt: new Date(),
        dryRun: true,
      },
    });

    const ia = new AnalisadorFalso(decide({ acao: 'WAIT' }));
    await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ACK_FINAL' },
      opcoes(ia)
    );

    const ctx = ia.ultimoContexto!;
    expect(ctx.envios).toHaveLength(1);
    expect(ctx.envios[0]).toMatchObject({ ordem: 1, statusOutbound: 'ENVIADA' });
    expect(ctx.sequencia).toHaveLength(3);

    const { proximaEtapaEsperada } = await import('@prospector/domain');
    expect(proximaEtapaEsperada(ctx)).toBe(2);
  });

  it('o contexto traz as respostas do lead com a classificacao do motor', async () => {
    const { lead, campanha } = await cenario();

    const conversa = await prisma.conversation.create({
      data: { id: `${lead.id}-${campanha.id}`, leadId: lead.id, campaignId: campanha.id },
    });
    await prisma.message.create({
      data: {
        conversationId: conversa.id,
        leadId: lead.id,
        campaignId: campanha.id,
        direcao: 'RECEBIDA',
        status: 'ENTREGUE',
        texto: 'claro, pode mandar!',
        categoria: 'POSITIVO',
        confianca: 88,
        recebidaEm: new Date(),
      },
    });

    const ia = new AnalisadorFalso(decide({ acao: 'WAIT' }));
    await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'MENSAGEM_RECEBIDA' },
      opcoes(ia)
    );

    expect(ia.ultimoContexto!.respostas).toEqual([
      expect.objectContaining({
        texto: 'claro, pode mandar!',
        categoriaDoMotor: 'POSITIVO',
        confiancaDoMotor: 88,
      }),
    ]);
  });
});

// =============================================================================
// 7 e 8 — OPT-OUT
// =============================================================================

describe('opt-out e uma barreira que a IA nao atravessa', () => {
  it('7. a IA detecta opt-out -> encerra, marca o lead e cancela o que estava agendado', async () => {
    const { lead, campanha, etapas } = await cenario();

    await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapas[1]!.id,
        idempotencyKey: `teste-optout-${lead.id}-2`,
        status: 'AGENDADA',
        textoRenderizado: 'Mensagem 2',
        scheduledAt: new Date(Date.now() + 60_000),
        dryRun: true,
      },
    });

    const ia = new AnalisadorFalso(
      decide({ intent: 'OPT_OUT', acao: 'STOP_CAMPAIGN', optOut: true, motivo: 'pediu para parar' })
    );

    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'MENSAGEM_RECEBIDA' },
      opcoes(ia)
    );

    expect(r?.acaoExecutada).toBe('STOP_CAMPAIGN');

    const depois = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(depois.optOut).toBe(true);
    expect(depois.status).toBe('OPT_OUT');

    // O ponto que mais importa: a mensagem que ja estava agendada NAO sai.
    const agendada = await prisma.outboundMessage.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(agendada.status).toBe('CANCELADA');
  });

  // Nem confianca 100, nem intent de aceite, nem RESUME. A guarda nao
  // consulta o modelo para isto.
  it('8. lead em opt-out: a IA pede envio com confianca 100 e nada sai', async () => {
    const { lead, campanha } = await cenario();
    await prisma.lead.update({
      where: { id: lead.id },
      data: { optOut: true, optOutEm: new Date(), status: 'OPT_OUT' },
    });

    const ia = new AnalisadorFalso(
      decide({ intent: 'ACEITE', acao: 'SEND_STEP', etapaOrdem: 1, confianca: 100 })
    );

    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'MENSAGEM_RECEBIDA' },
      opcoes(ia)
    );

    expect(r?.acaoExecutada).toBe('STOP_CAMPAIGN');
    expect(await envios(lead.id)).toHaveLength(0);

    const trilha = await prisma.aiDecision.findFirstOrThrow();
    expect(trilha.motivoRejeicao).toBe('LEAD_EM_OPT_OUT');
  });
});

// =============================================================================
// 9 e 10 — INTERVENCAO HUMANA
// =============================================================================

describe('intervencao humana', () => {
  it('9. precisa de humano -> pausa + tarefa + UMA notificacao', async () => {
    const { lead, campanha } = await cenario();
    const ia = new AnalisadorFalso(
      decide({
        intent: 'PRECO',
        acao: 'CREATE_INTERVENTION',
        precisaHumano: true,
        motivo: 'O lead perguntou o preco e nao ha resposta configurada.',
      })
    );

    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'MENSAGEM_RECEBIDA' },
      opcoes(ia)
    );

    expect(r?.acaoExecutada).toBe('CREATE_INTERVENTION');

    const lc = await prisma.leadCampaign.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(lc.status).toBe('AGUARDANDO_INTERVENCAO');
    expect(lc.aguardandoLiberacao).toBe(true);

    expect(await prisma.notification.count()).toBe(1);
    expect(await prisma.task.count()).toBe(1);
  });

  it('10. o mesmo evento tres vezes continua produzindo UMA notificacao', async () => {
    const { lead, campanha } = await cenario();
    const ia = new AnalisadorFalso(
      decide({ acao: 'CREATE_INTERVENTION', precisaHumano: true, motivo: 'preco' })
    );
    const o = opcoes(ia);

    for (let i = 0; i < 3; i += 1) {
      await orq.orquestrarCadencia(
        { leadId: lead.id, campaignId: campanha.id, gatilho: 'MENSAGEM_RECEBIDA' },
        o
      );
    }

    expect(await prisma.notification.count()).toBe(1);
    expect(await prisma.task.count()).toBe(1);
  });

  it('etapa configurada como manual vira intervencao, nao envio', async () => {
    const { lead, campanha, etapas } = await cenario({ etapa3Manual: true });

    for (const [i, etapa] of [etapas[0]!, etapas[1]!].entries()) {
      await prisma.outboundMessage.create({
        data: {
          leadId: lead.id,
          campaignId: campanha.id,
          campaignStepId: etapa.id,
          idempotencyKey: `teste-manual-${lead.id}-${i}`,
          status: 'ENVIADA',
          textoRenderizado: `Mensagem ${i + 1}`,
          processedAt: new Date(),
          dryRun: true,
        },
      });
    }

    const ia = new AnalisadorFalso(decide({ acao: 'SEND_STEP', etapaOrdem: 3 }));
    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ACK_FINAL' },
      opcoes(ia)
    );

    expect(r?.acaoExecutada).toBe('CREATE_INTERVENTION');
    // A etapa 3 continua sem ordem de envio.
    expect(await envios(lead.id)).toHaveLength(2);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('11. sequencia esperando liberacao nao e retomada pela IA', async () => {
    const { lead, campanha } = await cenario();
    await prisma.leadCampaign.updateMany({
      where: { leadId: lead.id },
      data: { status: 'PAUSADO', aguardandoLiberacao: true },
    });

    const ia = new AnalisadorFalso(decide({ acao: 'RESUME', etapaOrdem: 1 }));
    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'MENSAGEM_RECEBIDA' },
      opcoes(ia)
    );

    expect(r?.acaoExecutada).toBe('WAIT');
    expect(await envios(lead.id)).toHaveLength(0);
  });

  it('12. depois da liberacao, a cadencia continua da etapa certa', async () => {
    const { lead, campanha, etapas } = await cenario();

    await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapas[0]!.id,
        idempotencyKey: `teste-libera-${lead.id}-1`,
        status: 'ENVIADA',
        textoRenderizado: 'Mensagem 1',
        processedAt: new Date(),
        dryRun: true,
      },
    });
    await prisma.leadCampaign.updateMany({
      where: { leadId: lead.id },
      data: { status: 'PAUSADO', aguardandoLiberacao: true, etapaAtualId: etapas[0]!.id, etapaAtualOrdem: 1 },
    });

    // O operador libera.
    await prisma.leadCampaign.updateMany({
      where: { leadId: lead.id },
      data: { status: 'EM_ANDAMENTO', aguardandoLiberacao: false },
    });

    const ia = new AnalisadorFalso(decide({ acao: 'SEND_STEP', etapaOrdem: 2 }));
    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'OPERADOR_LIBEROU' },
      opcoes(ia)
    );

    expect(r?.resultado?.efetivada).toBe(true);
    const fila = await envios(lead.id);
    // Continuou da 2, nao recomecou da 1.
    expect(fila.map((e) => e.campaignStep?.ordem).sort()).toEqual([1, 2]);
  });
});

// =============================================================================
// FALLBACK — a cadencia nao para porque a IA parou
// =============================================================================

describe('quando a IA falha, o sistema NAO arrisca uma mensagem', () => {
  // ============================================================
  // A REGRA QUE ESTES TESTES DEFENDEM
  // ============================================================
  // Com a IA ligada, ela e quem decide. Se ela nao respondeu, o sistema
  // nao sabe o que o lead disse — sabe so o que o dicionario achou, que
  // e exatamente a limitacao que motivou liga-la.
  //
  // Mandar a proxima mensagem nesse estado e apostar, e mensagem enviada
  // nao volta atras. Um lead esperando meia hora a mais volta.
  it.each([
    ['timeout', 'Tempo esgotado (8000ms)'],
    ['JSON invalido', 'JSON fora do contrato — intent: valor invalido'],
    ['resposta vazia', 'O modelo devolveu resposta vazia'],
  ])('%s -> nada e enviado e a cadencia para para voce decidir', async (_nome, erro) => {
    const { lead, campanha } = await cenario();
    const ia = new AnalisadorFalso(falha(erro));

    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      opcoes(ia)
    );

    expect(r?.fallback).toBe(true);
    // O motor QUERIA enviar; o sistema recusou por falta da IA.
    expect(r?.acaoMotor).toBe('SEND_STEP');
    expect(r?.acaoExecutada).toBe('CREATE_INTERVENTION');
    expect(await envios(lead.id)).toHaveLength(0);

    // E voce e avisado — silencio aqui seria um lead parado sem motivo
    // visivel.
    expect(await prisma.notification.count()).toBe(1);

    const trilha = await prisma.aiDecision.findFirstOrThrow();
    expect(trilha.fallback).toBe(true);
    expect(trilha.erro).toBe(erro);
    expect(trilha.acaoIa).toBeNull();
    // Distingue "a guarda recusou a IA" de "o sistema nao arriscou sem ela".
    expect(trilha.motivoRejeicao).toBe('FALLBACK_NAO_ENVIA');
  });

  // Acoes que so silenciam nao arriscam nada, entao o fallback as executa
  // normalmente.
  it('uma acao que nao envia passa mesmo com a IA fora do ar', async () => {
    const { lead, campanha, etapas } = await cenario();
    // Tudo ja enviado: o motor decide WAIT.
    for (const [i, etapa] of etapas.entries()) {
      await prisma.outboundMessage.create({
        data: {
          leadId: lead.id,
          campaignId: campanha.id,
          campaignStepId: etapa.id,
          idempotencyKey: `fb-${lead.id}-${i}`,
          status: 'ENVIADA',
          textoRenderizado: `Mensagem ${i + 1}`,
          processedAt: new Date(),
          dryRun: true,
        },
      });
    }

    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      opcoes(new AnalisadorFalso(falha('caiu')))
    );

    expect(r?.acaoExecutada).toBe('WAIT');
    expect(await prisma.notification.count()).toBe(0);
  });

  // A distincao que importa: com a IA DESLIGADA o motor e o dono do
  // sistema, nao um substituto de emergencia. O comportamento e o de
  // antes da Fase 9.
  it('com a IA DESLIGADA o motor envia normalmente', async () => {
    const { lead, campanha } = await cenario();

    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      opcoes(null)
    );

    expect(r?.acaoExecutada).toBe('SEND_STEP');
    expect(await envios(lead.id)).toHaveLength(1);
  });

  it('a IA desligada nao grava nada em ai_decisions', async () => {
    const { lead, campanha } = await cenario();
    await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      opcoes(null)
    );
    expect(await prisma.aiDecision.count()).toBe(0);
  });
});

// =============================================================================
// MODO SOMBRA
// =============================================================================

describe('modo sombra — a IA opina, o motor manda', () => {
  it('a IA quer PAUSE, o motor quer SEND_STEP: quem manda e o motor', async () => {
    const { lead, campanha } = await cenario();
    const ia = new AnalisadorFalso(decide({ acao: 'PAUSE', motivo: 'acho melhor esperar' }));

    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      opcoes(ia, true)
    );

    expect(r?.modo).toBe('SOMBRA');
    expect(r?.acaoMotor).toBe('SEND_STEP');
    expect(r?.acaoExecutada).toBe('SEND_STEP');
    expect(r?.divergiu).toBe(true);

    // A etapa 1 saiu, apesar de a IA ter pedido pausa.
    expect(await envios(lead.id)).toHaveLength(1);

    const lc = await prisma.leadCampaign.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(lc.status).not.toBe('PAUSADO');
    expect(lc.estadoIa).toBe('SOMBRA');
  });

  it('a divergencia fica gravada — e ela o relatorio do modo sombra', async () => {
    const { lead, campanha } = await cenario();
    const ia = new AnalisadorFalso(decide({ acao: 'PAUSE', intent: 'DUVIDA', confianca: 77 }));

    await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      opcoes(ia, true)
    );

    const t = await prisma.aiDecision.findFirstOrThrow();
    expect(t).toMatchObject({
      acaoIa: 'PAUSE',
      acaoMotor: 'SEND_STEP',
      acaoExecutada: 'SEND_STEP',
      intentIa: 'DUVIDA',
      confianca: 77,
      divergiu: true,
      fallback: false,
      modelo: 'fake-1.0',
    });
  });

  it('quando os dois concordam, divergiu = false', async () => {
    const { lead, campanha } = await cenario();
    const ia = new AnalisadorFalso(decide({ acao: 'SEND_STEP', etapaOrdem: 1 }));

    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      opcoes(ia, true)
    );

    expect(r?.divergiu).toBe(false);
  });

  // Em modo sombra a IA nem sequer consegue registrar opt-out — porque
  // opt-out ali e decisao do motor, e o motor nao viu opt-out nenhum.
  it('em sombra, um opt-out inventado pela IA nao marca o lead', async () => {
    const { lead, campanha } = await cenario();
    const ia = new AnalisadorFalso(
      decide({ intent: 'OPT_OUT', acao: 'STOP_CAMPAIGN', optOut: true })
    );

    await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'MENSAGEM_RECEBIDA' },
      opcoes(ia, true)
    );

    const depois = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(depois.optOut).toBe(false);
  });
});

// =============================================================================
// MODO OBSERVADOR — usado no caminho de mensagem recebida
// =============================================================================

describe('modo observador — nao toca em nada', () => {
  it('registra a decisao sem executar acao nenhuma', async () => {
    const { lead, campanha } = await cenario();
    const ia = new AnalisadorFalso(decide({ acao: 'SEND_STEP', etapaOrdem: 1 }));

    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'MENSAGEM_RECEBIDA' },
      { ...opcoes(ia), observarApenas: true }
    );

    expect(r?.resultado?.efetivada).toBe(false);
    // Nenhuma ordem de envio criada, apesar de a acao ser SEND_STEP.
    expect(await envios(lead.id)).toHaveLength(0);
    // Mas a trilha existe: e para isso que o modo serve.
    expect(await prisma.aiDecision.count()).toBe(1);
  });

  it('nem mesmo CREATE_INTERVENTION cria notificacao no modo observador', async () => {
    const { lead, campanha } = await cenario();
    const ia = new AnalisadorFalso(decide({ acao: 'CREATE_INTERVENTION', precisaHumano: true }));

    await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'MENSAGEM_RECEBIDA' },
      { ...opcoes(ia), observarApenas: true }
    );

    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.task.count()).toBe(0);
  });
});

// =============================================================================
// O MOTOR DETERMINISTICO SOZINHO
// =============================================================================

describe('decidirSemIA — o chao do sistema', () => {
  it('campanha nao ATIVA nunca envia', async () => {
    const { lead, campanha } = await cenario();
    await prisma.campaign.update({
      where: { id: campanha.id },
      data: { status: 'PAUSADA' },
    });

    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      opcoes(null)
    );

    expect(r?.acaoExecutada).toBe('WAIT');
    expect(await envios(lead.id)).toHaveLength(0);
  });

  it('lead em opt-out encerra, mesmo sem IA', async () => {
    const { lead, campanha } = await cenario();
    await prisma.lead.update({
      where: { id: lead.id },
      data: { optOut: true, status: 'OPT_OUT' },
    });

    const r = await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'MENSAGEM_RECEBIDA' },
      opcoes(null)
    );

    expect(r?.acaoExecutada).toBe('STOP_CAMPAIGN');
  });
});

// =============================================================================
// NENHUM ENVIO REAL
// =============================================================================

describe('a garantia que vale para o arquivo inteiro', () => {
  it('nenhuma mensagem REAL foi enviada em nenhum teste deste arquivo', async () => {
    const reais = await prisma.outboundMessage.count({
      where: { dryRun: false, status: 'ENVIADA' },
    });
    expect(reais).toBe(0);
  });
});

// =============================================================================
// A IA NO COMANDO DO CAMINHO DE RESPOSTA
// =============================================================================
//
// O que muda em relacao aos casos acima: aqui o evento entra por
// `processarMensagemRecebida`, o mesmo caminho que uma resposta de
// verdade percorre. E ali que motor e IA poderiam colidir.

describe('mensagem recebida com a IA conduzindo', () => {
  it('a IA executa a cadencia e o motor NAO enfileira em dobro', async () => {
    const { lead, campanha, etapas } = await cenario();

    // A etapa 1 ja saiu; o lead responde.
    await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapas[0]!.id,
        idempotencyKey: `cmd-${lead.id}-1`,
        status: 'ENVIADA',
        textoRenderizado: 'Mensagem 1',
        processedAt: new Date(),
        dryRun: true,
      },
    });
    await prisma.leadCampaign.updateMany({
      where: { leadId: lead.id },
      data: { etapaAtualId: etapas[0]!.id, etapaAtualOrdem: 1, status: 'AGUARDANDO_RESPOSTA' },
    });

    // A etapa PRECISA esperar resposta para este teste fazer sentido: o
    // que ele verifica é a resposta conduzindo a cadência. Numa etapa que
    // anda pelo relógio, a resposta deliberadamente não conduz nada — é
    // o teste logo abaixo.
    //
    // O fixture usa `false` por outro motivo (deixar a sequência andar
    // sozinha nos casos que não envolvem resposta), e é isso que precisa
    // ser desfeito aqui.
    await prisma.campaignStep.update({
      where: { id: etapas[0]!.id },
      data: { aguardarResposta: true },
    });

    const gatilhos = await import('../apps/worker/src/services/gatilhos-ia.js');
    const inbound = await import('../apps/worker/src/services/inbound.js');

    const ia = new AnalisadorFalso(decide({ acao: 'SEND_STEP', etapaOrdem: 2 }));
    gatilhos.configurarIA({ analisador: ia, somenteAnalise: false, log });

    try {
      const r = await inbound.processarMensagemRecebida({
        providerMessageId: `wa-cmd-${lead.id}`,
        chatId: '5511980000001@c.us',
        telefone: (await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } }))
          .telefoneNormalizado!,
        texto: 'claro, pode mandar',
        nomeContato: null,
        recebidaEm: new Date(),
        deMim: false,
        tipo: 'chat',
        temMidia: false,
      });
      expect(r.processada).toBe(true);
    } finally {
      gatilhos.desconfigurarIA();
    }

    // UMA ordem para a etapa 2, nao duas: o motor pulou AVANCAR_ETAPA
    // porque a IA conduziu.
    const daEtapa2 = await prisma.outboundMessage.findMany({
      where: { leadId: lead.id, campaignStepId: etapas[1]!.id },
    });
    expect(daEtapa2).toHaveLength(1);

    // E a IA foi de fato consultada, com o estado real na mao.
    expect(ia.chamadas).toBe(1);
    expect(ia.ultimoContexto?.envios.some((e) => e.ordem === 1)).toBe(true);
  });

  // ==========================================================
  // A ETAPA QUE ANDA PELO RELOGIO
  // ==========================================================
  // Pedido de quem usa: "eu nao quero que voce analise essa mensagem 1
  // que ele me responder. Manda a primeira, e depois dos minutos que eu
  // configurar, manda a 2 automaticamente. A partir da 2, ai sim analisa
  // a resposta."
  //
  // A abordagem e "Oi, prazer, me chamo Lucas." — curta de proposito,
  // para provocar a saudacao automatica do WhatsApp Business. Deixar a
  // cadencia depender dessa resposta e o contrario do que ela serve: a
  // saudacao caia em DUVIDA, a regra da etapa mandava
  // AGUARDAR_INTERVENCAO, e o lead era congelado antes de a conversa
  // comecar.
  it('resposta a uma etapa sem espera nao aciona a IA nem enfileira nada', async () => {
    const { lead, campanha, etapas } = await cenario();

    await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapas[0]!.id,
        idempotencyKey: `relogio-${lead.id}-1`,
        status: 'ENVIADA',
        textoRenderizado: 'Oi, prazer, me chamo Lucas.',
        processedAt: new Date(),
        dryRun: true,
      },
    });
    // O fixture ja cria as etapas com `aguardarResposta: false` — que e
    // exatamente a configuracao sob teste aqui.
    await prisma.leadCampaign.updateMany({
      where: { leadId: lead.id },
      data: { etapaAtualId: etapas[0]!.id, etapaAtualOrdem: 1, status: 'EM_ANDAMENTO' },
    });

    const gatilhos = await import('../apps/worker/src/services/gatilhos-ia.js');
    const inbound = await import('../apps/worker/src/services/inbound.js');

    const ia = new AnalisadorFalso(decide({ acao: 'SEND_STEP', etapaOrdem: 2 }));
    gatilhos.configurarIA({ analisador: ia, somenteAnalise: false, log });

    try {
      const r = await inbound.processarMensagemRecebida({
        providerMessageId: `wa-relogio-${lead.id}`,
        chatId: '5511980000001@c.us',
        telefone: (await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } }))
          .telefoneNormalizado!,
        // A cara de uma saudacao automatica de WhatsApp Business.
        texto: 'Olá! Recebemos sua mensagem e responderemos em breve.',
        nomeContato: null,
        recebidaEm: new Date(),
        deMim: false,
        tipo: 'chat',
        temMidia: false,
      });
      // A mensagem E processada: ela entra no historico e na conversa.
      expect(r.processada).toBe(true);
    } finally {
      gatilhos.desconfigurarIA();
    }

    // Nada foi enfileirado por causa da resposta. Quem coloca a etapa 2
    // na fila e o despachante, no tempo configurado — nao isto aqui.
    const daEtapa2 = await prisma.outboundMessage.findMany({
      where: { leadId: lead.id, campaignStepId: etapas[1]!.id },
    });
    expect(daEtapa2).toHaveLength(0);

    // A IA nao foi nem consultada: nao ha decisao de cadencia a tomar.
    expect(ia.chamadas).toBe(0);

    // E voce nao foi incomodado. Esta e a assercao que descreve o
    // sintoma relatado.
    const avisos = await prisma.notification.findMany({ where: { leadId: lead.id } });
    expect(avisos).toHaveLength(0);

    // O lead nao foi congelado.
    const vinculo = await prisma.leadCampaign.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(vinculo.status).toBe('EM_ANDAMENTO');
    expect(vinculo.aguardandoLiberacao).toBe(false);

    // Mas a conversa EXISTE: registrar nunca foi o problema.
    const recebidas = await prisma.message.findMany({
      where: { leadId: lead.id, direcao: 'RECEBIDA' },
    });
    expect(recebidas).toHaveLength(1);
  });

  it('o contexto entregue traz a conversa nos DOIS sentidos', async () => {
    const { lead, campanha, etapas } = await cenario();

    const conversa = await prisma.conversation.create({
      data: { id: `${lead.id}-${campanha.id}`, leadId: lead.id, campaignId: campanha.id },
    });
    await prisma.message.create({
      data: {
        conversationId: conversa.id,
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapas[0]!.id,
        direcao: 'ENVIADA',
        status: 'ENTREGUE',
        texto: 'Oi! É do Studio aí do Centro?',
        enviadaEm: new Date(Date.now() - 120_000),
      },
    });
    await prisma.message.create({
      data: {
        conversationId: conversa.id,
        leadId: lead.id,
        campaignId: campanha.id,
        direcao: 'RECEBIDA',
        status: 'ENTREGUE',
        texto: 'claro, pode mandar',
        categoria: 'POSITIVO',
        confianca: 85,
        recebidaEm: new Date(),
      },
    });

    const ia = new AnalisadorFalso(decide({ acao: 'WAIT' }));
    await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'MENSAGEM_RECEBIDA' },
      opcoes(ia)
    );

    const c = ia.ultimoContexto!.conversa;
    expect(c).toHaveLength(2);
    // Ordem cronologica: o que perguntamos vem antes da resposta. Sem
    // isso, "pode mandar" ficaria sem referente.
    expect(c[0]?.direcao).toBe('ENVIADA');
    expect(c[1]?.direcao).toBe('RECEBIDA');
    expect(c[1]?.categoriaDoMotor).toBe('POSITIVO');
  });
});
