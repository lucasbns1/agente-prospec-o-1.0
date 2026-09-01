/**
 * Despachante da fila de envio (Fase G/H).
 *
 * ============================================================
 * POR QUE ISSO EXISTE
 * ============================================================
 * O enfileiramento da campanha grava linhas em `outbound_messages` com
 * um `scheduledAt`. Sozinhas, essas linhas nao fazem nada — alguem
 * precisa transformar "esta na hora" em um job do BullMQ.
 *
 * POR QUE UM POLLER, E NAO UM JOB COM `delay` NA HORA DO ENFILEIRAMENTO:
 *  - uma campanha pode agendar para daqui a varios dias; segurar isso
 *    dentro do Redis por dias e fragil (o Redis aqui roda sem
 *    persistencia);
 *  - se o worker estiver parado no momento do enfileiramento, os jobs
 *    simplesmente nao existiriam;
 *  - o banco vira a unica fonte da verdade sobre o que falta enviar, e
 *    o Redis vira so o transporte. Reiniciar o Redis nao perde trabalho.
 *
 * ============================================================
 * ESTE MODULO NAO ENVIA NADA
 * ============================================================
 * Ele so decide QUANDO uma mensagem pode virar job. Quem processa e o
 * worker de outbound — que continua em dry-run.
 */
import { prisma } from '@prospector/database';
import { dentroDaJanela } from '@prospector/domain';
import { QUEUES } from '@prospector/shared';
import type { Logger } from 'pino';
import { getFila, OPCOES_JOB_PADRAO } from '../queues.js';
import { enfileirarProximaEtapa } from '../services/avancar-etapa.js';
import type { OutboundJobData } from './outbound.js';

/** De quanto em quanto tempo o despachante olha o banco. */
export const INTERVALO_VARREDURA_MS = 15_000;

/**
 * Teto por varredura.
 *
 * Sem isso, uma campanha de 5000 leads viraria 5000 jobs de uma vez e o
 * espacamento entre envios — que e a protecao anti-ban — seria decidido
 * so pelo `scheduledAt`. Com o teto, a fila do Redis fica curta e o
 * banco continua mandando no ritmo.
 */
export const MAX_POR_VARREDURA = 50;

export interface ResultadoVarredura {
  despachadas: number;
  bloqueadas: number;
  adiadas: number;
}

/**
 * Quantas mensagens REAIS ja sairam desta campanha na janela informada.
 *
 * SIMULADA fica de fora de proposito: dry-run nao consome cota. Se
 * contasse, testar a campanha gastaria o limite diario do dia seguinte.
 */
function contarEnviosReais(campaignId: string, desde: Date): Promise<number> {
  return prisma.outboundMessage.count({
    where: {
      campaignId,
      status: { in: ['ENVIADA'] },
      processedAt: { gte: desde },
    },
  });
}

/**
 * Uma passada: pega o que venceu, valida e despacha.
 *
 * Exportada para poder ser chamada direto no teste, sem depender de
 * timer.
 */
/**
 * Quanto tempo em PROCESSANDO antes de a mensagem ser considerada orfa.
 * Generoso de proposito: um envio lento nao pode virar worker morto.
 */
const MINUTOS_ATE_ORFA = 10;

/**
 * Devolve ao mundo o que ficou preso em PROCESSANDO.
 *
 * ============================================================
 * O BURACO QUE ISTO FECHA
 * ============================================================
 * A reserva marca PROCESSANDO. Se o worker morrer entre reservar e
 * terminar — Ctrl+C, queda do Chromium, reinicio — a mensagem fica nesse
 * estado PARA SEMPRE: a varredura so olha PENDENTE e AGENDADA, e a
 * reserva so pega quem esta nesses dois. Nada a resgata.
 *
 * Visto em uso real: tres mensagens paradas em "Processando" depois de
 * uma sequencia de reinicios.
 *
 * ============================================================
 * SIMULADA VOLTA; REAL NAO
 * ============================================================
 * Uma mensagem de simulacao nao tocou o WhatsApp — devolver para a fila
 * e seguro.
 *
 * Uma REAL e outra coisa. Ha uma janela, pequena mas real, entre o
 * WhatsApp aceitar a mensagem e o banco registrar isso. Morrer ali e
 * reenviar mandaria a MESMA mensagem duas vezes para a mesma pessoa.
 * Por isso ela vira FALHOU com o motivo explicito e espera decisao sua:
 * um incomodo seu custa menos que uma mensagem duplicada na conversa de
 * um cliente.
 */
async function recuperarOrfas(agora: Date): Promise<void> {
  const limite = new Date(agora.getTime() - MINUTOS_ATE_ORFA * 60_000);

  await prisma.outboundMessage.updateMany({
    where: { status: 'PROCESSANDO', dryRun: true, updatedAt: { lt: limite } },
    data: { status: 'AGENDADA', scheduledAt: agora },
  });

  await prisma.outboundMessage.updateMany({
    where: { status: 'PROCESSANDO', dryRun: false, updatedAt: { lt: limite } },
    data: {
      status: 'FALHOU',
      erro:
        'O worker parou no meio do envio. Pode ter saido ou nao — confira a ' +
        'conversa no WhatsApp antes de reenviar.',
      processedAt: agora,
    },
  });
}

/**
 * As sequencias que andam sozinhas.
 *
 * ============================================================
 * O BURACO QUE ISTO FECHA
 * ============================================================
 * Uma etapa espera de dois jeitos, e sao mecanismos diferentes:
 *
 *   `aguardarResposta: true`  — congela ate o lead falar. O avanco
 *                               nasce da resposta, no pipeline de
 *                               recebimento.
 *   `aguardarResposta: false` — anda sozinha, no tempo configurado.
 *                               Nao depende de resposta nenhuma.
 *
 * A SEGUNDA NUNCA EXISTIU. O worker de outbound gravava
 * `LeadCampaign.status = 'EM_ANDAMENTO'` — e nenhum codigo do sistema
 * inteiro lia esse status. Da para conferir com um grep: uma escrita,
 * zero leituras.
 *
 * O efeito era o pior possivel: a mensagem 1 saia, o CRM registrava
 * tudo certo, o quadro mostrava o lead na etapa 1, e a sequencia
 * simplesmente nunca continuava. Sem erro, sem job pendente, sem nada
 * na fila apontando o problema.
 *
 * ============================================================
 * POR QUE AQUI, E NAO NUM JOB COM DELAY
 * ============================================================
 * Pelo mesmo motivo do resto deste arquivo: o banco e a fonte da
 * verdade sobre o que falta enviar. Um job dormindo 24h dentro de um
 * Redis sem persistencia some num restart, e o lead ficaria parado de
 * novo — trocaria um silencio por outro.
 *
 * ============================================================
 * O QUE ISTO NAO FAZ
 * ============================================================
 * Nao envia. Cria a linha da proxima etapa em `outbound_messages` com
 * o `scheduledAt` calculado pelo delay configurado. Dali para frente e
 * o mesmo caminho de qualquer outra mensagem — varredura, fila, worker,
 * barreiras de envio.
 */
async function avancarSequenciasAutomaticas(agora: Date): Promise<number> {
  const candidatos = await prisma.leadCampaign.findMany({
    where: {
      // EM_ANDAMENTO e escrito pelo worker de outbound quando a etapa
      // enviada NAO espera resposta. Ate agora era um estado terminal
      // por acidente.
      status: 'EM_ANDAMENTO',
      aguardandoLiberacao: false,
      campaign: { status: 'ATIVA' },
      lead: {
        optOut: false,
        status: { notIn: ['OPT_OUT', 'AGUARDANDO_INTERVENCAO'] },
        // Ja ha mensagem esperando para sair? Entao a proxima etapa ja
        // foi criada e ainda nao saiu. Criar outra aqui atropelaria a
        // sequencia — duas mensagens da mesma campanha na fila ao
        // mesmo tempo, e o lead recebendo duas seguidas.
        outbound: {
          none: { status: { in: ['PENDENTE', 'AGENDADA', 'PROCESSANDO'] } },
        },
      },
    },
    select: { leadId: true, campaignId: true, etapaAtualId: true },
    take: MAX_POR_VARREDURA,
  });

  let avancadas = 0;
  let jaEnfileiradas = 0;
  for (const c of candidatos) {
    const r = await enfileirarProximaEtapa({
      leadId: c.leadId,
      campaignId: c.campaignId,
      etapaAtualId: c.etapaAtualId,
      agora,
    });
    if (r.enfileirou) avancadas += 1;
    else if (r.motivo === 'JA_ENFILEIRADA') jaEnfileiradas += 1;
  }

  // ============================================================
  // UM NUMERO NO LUGAR DE CINQUENTA BLOCOS VERMELHOS
  // ============================================================
  // O filtro acima descarta quem tem mensagem em PENDENTE, AGENDADA ou
  // PROCESSANDO — mas NAO quem ja tem uma em estado terminal (ENVIADA,
  // SIMULADA, FALHOU, BLOQUEADA). Esses leads voltam a ser candidatos em
  // TODA varredura, batem na UNIQUE e sao recusados, de quinze em
  // quinze segundos, para sempre.
  //
  // Recusar esta certo: a idempotencia funcionando. O problema e outro,
  // e e maior do que parece — cada um deles ocupa uma das
  // MAX_POR_VARREDURA vagas. Com mais leads nessa situacao do que o
  // teto, os leads que PODERIAM avancar ficam sem vez, em silencio.
  //
  // Este numero e o que torna isso visivel. Perto do teto, a fila esta
  // entupida e a causa esta nos leads que nunca avancam.
  ultimoTotalJaEnfileiradas = jaEnfileiradas;
  return avancadas;
}

/**
 * Quantos candidatos da ultima varredura nao avancaram por ja terem
 * ordem para aquela etapa. Lido pelo log da varredura.
 */
let ultimoTotalJaEnfileiradas = 0;

export function candidatosSemAvanco(): number {
  return ultimoTotalJaEnfileiradas;
}

export async function varrer(agora: Date = new Date()): Promise<ResultadoVarredura> {
  await recuperarOrfas(agora);
  await avancarSequenciasAutomaticas(agora);

  const vencidas = await prisma.outboundMessage.findMany({
    where: {
      status: { in: ['PENDENTE', 'AGENDADA'] },
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: agora } }],
    },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    take: MAX_POR_VARREDURA,
    include: {
      campaign: {
        select: {
          id: true, nome: true, status: true,
          horarioInicio: true, horarioFim: true, diasPermitidos: true,
          limiteDiarioEnvios: true, limiteHorarioEnvios: true,
        },
      },
    },
  });

  const resultado: ResultadoVarredura = { despachadas: 0, bloqueadas: 0, adiadas: 0 };
  if (vencidas.length === 0) return resultado;

  const fila = getFila(QUEUES.OUTBOUND_SEND);

  // Cache por campanha: varias mensagens da mesma campanha compartilham
  // a mesma contagem, e recontar por mensagem seria uma consulta a mais
  // para cada linha.
  const cota = new Map<string, { hoje: number; hora: number }>();

  const inicioDoDia = new Date(agora);
  inicioDoDia.setHours(0, 0, 0, 0);
  const umaHoraAtras = new Date(agora.getTime() - 3600_000);

  for (const m of vencidas) {
    const c = m.campaign;

    // --- Campanha precisa estar ATIVA ---
    if (c.status !== 'ATIVA') {
      await prisma.outboundMessage.update({
        where: { id: m.id },
        data: {
          status: 'BLOQUEADA',
          motivoBloqueio: 'CAMPANHA_PAUSADA',
          detalheBloqueio: `Campanha esta ${c.status}`,
          processedAt: agora,
        },
      });
      resultado.bloqueadas += 1;
      continue;
    }

    // --- Janela de horario ---
    //
    // Fora da janela a mensagem NAO e bloqueada: ela e adiada. Bloquear
    // aqui perderia o lead so porque a fila virou a noite.
    if (
      !dentroDaJanela(agora, {
        horarioInicio: c.horarioInicio,
        horarioFim: c.horarioFim,
        diasPermitidos: c.diasPermitidos,
      })
    ) {
      await prisma.outboundMessage.update({
        where: { id: m.id },
        data: { scheduledAt: new Date(agora.getTime() + 15 * 60_000) },
      });
      resultado.adiadas += 1;
      continue;
    }

    // --- Limites diario e horario ---
    let contagem = cota.get(c.id);
    if (!contagem) {
      contagem = {
        hoje: await contarEnviosReais(c.id, inicioDoDia),
        hora: await contarEnviosReais(c.id, umaHoraAtras),
      };
      cota.set(c.id, contagem);
    }

    if (contagem.hoje >= c.limiteDiarioEnvios) {
      // Amanha, no inicio da janela. O limite diario nao e motivo para
      // desistir do lead.
      const amanha = new Date(inicioDoDia.getTime() + 24 * 3600_000);
      await prisma.outboundMessage.update({
        where: { id: m.id },
        data: { scheduledAt: amanha },
      });
      resultado.adiadas += 1;
      continue;
    }

    if (contagem.hora >= c.limiteHorarioEnvios) {
      await prisma.outboundMessage.update({
        where: { id: m.id },
        data: { scheduledAt: new Date(agora.getTime() + 60 * 60_000) },
      });
      resultado.adiadas += 1;
      continue;
    }

    // --- Despacha ---
    //
    // `jobId` fixo no id da mensagem: se a varredura rodar duas vezes
    // antes do worker pegar o job, o BullMQ descarta o duplicado. Nao
    // substitui a idempotencia do banco — soma com ela.
    //
    // O separador e "-" e nao ":": o BullMQ recusa dois-pontos em id
    // customizado (ele usa ":" nas proprias chaves do Redis).
    await fila.add(
      'enviar',
      { outboundMessageId: m.id } satisfies OutboundJobData,
      { ...OPCOES_JOB_PADRAO, jobId: `outbound-${m.id}` }
    );

    // Reservado de forma otimista para a proxima varredura nao contar de
    // novo a mesma mensagem. Quem confirma o consumo e o worker.
    contagem.hora += 1;
    contagem.hoje += 1;
    resultado.despachadas += 1;
  }

  return resultado;
}

/**
 * Liga o laco de varredura. Devolve a funcao que o desliga.
 */
export function iniciarDespachante(log: Logger): () => void {
  let rodando = false;

  const tick = async (): Promise<void> => {
    // Uma varredura lenta nao pode se sobrepor a proxima: duas passadas
    // simultaneas leriam as mesmas linhas.
    if (rodando) return;
    rodando = true;
    try {
      const r = await varrer();
      const parados = candidatosSemAvanco();
      if (r.despachadas > 0 || r.bloqueadas > 0 || r.adiadas > 0 || parados > 0) {
        log.info(
          // `paradosNaMesmaEtapa` no lugar de cinquenta blocos vermelhos
          // do Prisma. Perto de MAX_POR_VARREDURA, a fila esta entupida:
          // esses leads ocupam as vagas de quem poderia avancar.
          { ...r, paradosNaMesmaEtapa: parados },
          parados >= MAX_POR_VARREDURA
            ? 'Varredura da fila de envio — TETO de candidatos parados na mesma etapa; leads que poderiam avancar podem estar sem vez'
            : 'Varredura da fila de envio'
        );
      }
    } catch (err) {
      log.error({ err }, 'Falha na varredura da fila de envio');
    } finally {
      rodando = false;
    }
  };

  const timer = setInterval(() => void tick(), INTERVALO_VARREDURA_MS);
  void tick();

  log.info(
    { intervaloMs: INTERVALO_VARREDURA_MS, maxPorVarredura: MAX_POR_VARREDURA },
    'Despachante da fila de envio iniciado'
  );

  return () => clearInterval(timer);
}
