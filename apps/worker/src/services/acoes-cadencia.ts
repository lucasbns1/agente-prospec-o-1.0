/**
 * As acoes que a IA pode SOLICITAR. Note o verbo.
 *
 * ============================================================
 * NENHUMA FUNCAO AQUI ENVIA MENSAGEM
 * ============================================================
 * `SEND_STEP` nao chama o WhatsApp. Ele cria a linha em
 * `outbound_messages` — e dali para frente o caminho e o mesmo de
 * sempre: despachante, fila, worker, quatro barreiras.
 *
 * A diferenca importa e nao e estilistica. Se a IA tivesse uma
 * ferramenta que dispara o transporte, uma reexecucao do modelo — por
 * timeout de rede, JSON invalido no turno seguinte, retry do job —
 * poderia mandar a mesma mensagem duas vezes para um cliente seu.
 * Enfileirar duas vezes e inofensivo: a UNIQUE `idempotencyKey` barra.
 * Enviar duas vezes nao volta atras.
 *
 * ============================================================
 * TODA ACAO DEVOLVE O RESULTADO REAL
 * ============================================================
 * Nenhuma delas responde "feito" so porque foi chamada. O que volta e o
 * que o banco aceitou — inclusive quando o banco recusou.
 */
import { prisma } from '@prospector/database';
import type { AcaoIA } from '@prospector/domain';
import { publicarEvento } from '../events.js';
import { enfileirarProximaEtapa } from './avancar-etapa.js';
import { criarNotificacaoIdempotente, criarTarefaSeNaoExistir } from './notificar.js';

export interface ResultadoAcao {
  /** O que foi de fato executado. */
  acao: AcaoIA;
  /** false = a acao nao produziu efeito (e isso pode ser o correto). */
  efetivada: boolean;
  /** Legivel, vai para o log e para a tela. */
  detalhe: string;
  outboundMessageId?: string;
}

/**
 * Traduz "etapa de ordem N" para a ancora que `enfileirarProximaEtapa`
 * entende, que e a etapa ANTERIOR.
 *
 * Reusar aquela funcao em vez de escrever um enfileirador novo e
 * deliberado: ela ja carrega a checagem de campanha ativa, o opt-out, a
 * renderizacao com variaveis, o calculo do delay, o tratamento de etapa
 * manual e a chave de idempotencia. Um caminho paralelo teria que
 * repetir tudo isso — e a primeira coisa que alguem esqueceria seria a
 * barreira que mais importa.
 */
async function ancoraDaOrdem(
  campaignId: string,
  ordem: number
): Promise<{ ok: true; etapaAnteriorId: string | null } | { ok: false; motivo: string }> {
  if (ordem <= 1) return { ok: true, etapaAnteriorId: null };

  const anterior = await prisma.campaignStep.findFirst({
    where: { campaignId, ativo: true, ordem: { lt: ordem } },
    orderBy: { ordem: 'desc' },
    select: { id: true },
  });

  if (!anterior) {
    return { ok: false, motivo: `Nao ha etapa antes da ordem ${ordem} nesta campanha.` };
  }
  return { ok: true, etapaAnteriorId: anterior.id };
}

/**
 * Cria a ordem de envio de uma etapa.
 *
 * IDEMPOTENTE EM DOIS NIVEIS, de proposito:
 *
 *  1. aqui, pela consulta abaixo: se a etapa ja tem envio ocupando, nem
 *     tenta. Isso evita a decisao errada se repetir a cada evento.
 *  2. no banco, pela UNIQUE `idempotencyKey`: se duas execucoes
 *     simultaneas passarem pela consulta, uma perde na constraint.
 *
 * O nivel 1 sozinho seria uma corrida. O nivel 2 sozinho funcionaria,
 * mas encheria o log de P2002 e deixaria a IA repetindo o mesmo pedido
 * para sempre. Os dois juntos e que dao um sistema que se comporta bem.
 */
export async function solicitarEnvioDeEtapa(params: {
  leadId: string;
  campaignId: string;
  ordem: number;
  agora?: Date;
}): Promise<ResultadoAcao> {
  const jaTem = await prisma.outboundMessage.findFirst({
    where: {
      leadId: params.leadId,
      campaignId: params.campaignId,
      campaignStep: { ordem: params.ordem },
      status: { in: ['PENDENTE', 'AGENDADA', 'PROCESSANDO', 'SIMULADA', 'ENVIADA'] },
    },
    select: { id: true, status: true },
  });

  if (jaTem) {
    return {
      acao: 'SEND_STEP',
      efetivada: false,
      detalhe: `A etapa ${params.ordem} ja esta ${jaTem.status}. Nada foi criado.`,
      outboundMessageId: jaTem.id,
    };
  }

  const ancora = await ancoraDaOrdem(params.campaignId, params.ordem);
  if (!ancora.ok) {
    return { acao: 'SEND_STEP', efetivada: false, detalhe: ancora.motivo };
  }

  const r = await enfileirarProximaEtapa({
    leadId: params.leadId,
    campaignId: params.campaignId,
    etapaAtualId: ancora.etapaAnteriorId,
    agora: params.agora,
  });

  return {
    acao: 'SEND_STEP',
    efetivada: r.enfileirou,
    detalhe: r.enfileirou
      ? `Etapa ${params.ordem} enfileirada. O envio segue pelas quatro barreiras.`
      : `Nao enfileirou: ${r.motivo}${r.detalhe ? ` — ${r.detalhe}` : ''}`,
    ...(r.outboundMessageId ? { outboundMessageId: r.outboundMessageId } : {}),
  };
}

/**
 * Congela a sequencia. Nao cria tarefa nem avisa ninguem — para isso
 * existe `criarIntervencao`.
 */
export async function pausarCadencia(params: {
  leadId: string;
  campaignId: string;
  motivo: string;
}): Promise<ResultadoAcao> {
  await prisma.leadCampaign.updateMany({
    where: { leadId: params.leadId, campaignId: params.campaignId },
    data: {
      status: 'PAUSADO',
      aguardandoLiberacao: true,
      motivoParada: params.motivo,
    },
  });
  void publicarEvento('dashboard.atualizar');

  return { acao: 'PAUSE', efetivada: true, detalhe: params.motivo };
}

/**
 * Congela + tarefa + UM aviso.
 *
 * Os tres juntos de proposito. So o aviso nao basta: notificacao e lida
 * e some, e o lead pronto para a etapa manual sumia da vista no momento
 * em que voce clicava no sino. A tarefa e o trabalho, e ela sobrevive a
 * leitura do aviso.
 */
export async function criarIntervencao(params: {
  leadId: string;
  campaignId: string;
  titulo: string;
  motivo: string;
  /** O que identifica o acontecimento, para o aviso nao duplicar. */
  referencia: string;
}): Promise<ResultadoAcao> {
  await prisma.leadCampaign.updateMany({
    where: { leadId: params.leadId, campaignId: params.campaignId },
    data: {
      status: 'AGUARDANDO_INTERVENCAO',
      aguardandoLiberacao: true,
      motivoParada: params.motivo,
    },
  });

  await prisma.lead.update({
    where: { id: params.leadId },
    data: { status: 'AGUARDANDO_INTERVENCAO', proximaAcao: params.titulo },
  });

  const aviso = await criarNotificacaoIdempotente({
    tipo: 'INTERVENCAO_NECESSARIA',
    titulo: params.titulo,
    mensagem: params.motivo,
    nivel: 'ALERTA',
    leadId: params.leadId,
    link: `/conversas/${params.leadId}`,
    referencia: params.referencia,
  });

  await criarTarefaSeNaoExistir({
    leadId: params.leadId,
    tipo: 'RESPONDER_CLIENTE',
    prioridade: 'ALTA',
    titulo: params.titulo,
    descricao: params.motivo,
  });

  void publicarEvento('dashboard.atualizar');

  return {
    acao: 'CREATE_INTERVENTION',
    efetivada: true,
    // O detalhe diz se o aviso e novo. Repetir a intervencao nao e erro
    // — mas avisar de novo seria.
    detalhe: aviso.criada
      ? `${params.motivo} (voce foi avisado)`
      : `${params.motivo} (voce ja havia sido avisado)`,
  };
}

/** So avisa. Nao congela nada. */
export async function avisarOperador(params: {
  leadId: string;
  titulo: string;
  mensagem: string;
  referencia: string;
}): Promise<ResultadoAcao> {
  const r = await criarNotificacaoIdempotente({
    tipo: 'INTERVENCAO_NECESSARIA',
    titulo: params.titulo,
    mensagem: params.mensagem,
    nivel: 'ALERTA',
    leadId: params.leadId,
    link: `/conversas/${params.leadId}`,
    referencia: params.referencia,
  });

  return {
    acao: 'NOTIFY_OPERATOR',
    efetivada: r.criada,
    detalhe: r.criada ? params.mensagem : 'Voce ja havia sido avisado disso.',
  };
}

/**
 * Encerra a sequencia.
 *
 * `optOut: true` faz muito mais do que parar: marca o lead, cancela o
 * que estiver pendente e fecha a porta. Um lead em opt-out nunca mais
 * passa pela guarda de envio, e nenhuma decisao futura da IA reverte
 * isso — so voce, na mao.
 */
export async function encerrarCadencia(params: {
  leadId: string;
  campaignId: string;
  motivo: string;
  optOut: boolean;
}): Promise<ResultadoAcao> {
  await prisma.leadCampaign.updateMany({
    where: { leadId: params.leadId, campaignId: params.campaignId },
    data: {
      status: params.optOut ? 'OPT_OUT' : 'PARADO',
      motivoParada: params.motivo,
      concluidoEm: new Date(),
      aguardandoLiberacao: false,
    },
  });

  if (params.optOut) {
    await prisma.lead.update({
      where: { id: params.leadId },
      data: { optOut: true, optOutEm: new Date(), status: 'OPT_OUT' },
    });
  }

  // Cancela o que ainda nao saiu. Sem isto, uma mensagem ja agendada
  // sairia depois do opt-out — o pior erro possivel deste sistema.
  const canceladas = await prisma.outboundMessage.updateMany({
    where: {
      leadId: params.leadId,
      campaignId: params.campaignId,
      status: { in: ['PENDENTE', 'AGENDADA'] },
    },
    data: {
      status: 'CANCELADA',
      erro: params.optOut ? 'Cancelada por opt-out do lead' : params.motivo,
    },
  });

  void publicarEvento('dashboard.atualizar');

  return {
    acao: 'STOP_CAMPAIGN',
    efetivada: true,
    detalhe:
      `${params.motivo}` +
      (canceladas.count > 0 ? ` (${canceladas.count} envio(s) pendente(s) cancelado(s))` : ''),
  };
}

/**
 * Registra que o sistema decidiu esperar.
 *
 * Nao ha efeito colateral nenhum: WAIT e a acao que NAO faz nada. O que
 * ela grava e o que a tela precisa mostrar — "proxima acao, e quando" —
 * que ate agora nao existia em lugar nenhum do banco.
 */
export async function registrarEspera(params: {
  leadId: string;
  campaignId: string;
  motivo: string;
  esperarSegundos: number | null;
  agora?: Date;
}): Promise<ResultadoAcao> {
  const agora = params.agora ?? new Date();
  const quando =
    params.esperarSegundos !== null
      ? new Date(agora.getTime() + params.esperarSegundos * 1000)
      : null;

  await prisma.leadCampaign.updateMany({
    where: { leadId: params.leadId, campaignId: params.campaignId },
    data: {
      proximaAcao: 'WAIT',
      proximaAcaoEm: quando,
      proximaAcaoMotivo: params.motivo,
    },
  });

  return {
    acao: 'WAIT',
    efetivada: true,
    detalhe: quando
      ? `${params.motivo} (proxima verificacao por volta de ${quando.toISOString()})`
      : params.motivo,
  };
}

/** Grava na tela qual e a proxima acao decidida. */
export async function registrarProximaAcao(params: {
  leadId: string;
  campaignId: string;
  acao: AcaoIA;
  motivo: string;
  estadoIa: 'DESLIGADA' | 'SOMBRA' | 'ATIVA' | 'FALHOU';
}): Promise<void> {
  await prisma.leadCampaign.updateMany({
    where: { leadId: params.leadId, campaignId: params.campaignId },
    data: {
      proximaAcao: params.acao,
      proximaAcaoMotivo: params.motivo,
      estadoIa: params.estadoIa,
    },
  });
}
