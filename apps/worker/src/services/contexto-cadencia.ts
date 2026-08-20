/**
 * Monta o retrato que a IA recebe.
 *
 * ============================================================
 * ESTE ARQUIVO E A RESPOSTA PARA "A MENSAGEM 2 FOI ENVIADA?"
 * ============================================================
 * Toda a arquitetura da Fase 9 depende de uma coisa: o modelo nunca
 * afirma nada sobre o estado. Ele LE o estado, opina, e no evento
 * seguinte le de novo, do zero.
 *
 * Por isso cada campo do `ContextoCadencia` sai de uma coluna do banco,
 * e nao de memoria, cache ou de algo que a IA tenha dito antes. Se esta
 * funcao mentir, todo o resto mente junto.
 *
 * ============================================================
 * O QUE NAO ESTA AQUI, DE PROPOSITO
 * ============================================================
 * Nao ha decisao nenhuma neste arquivo. Ele le e formata. Quem decide e
 * o modelo (ou o motor, em modo sombra), e quem valida e a guarda em
 * `validar-decisao.ts`.
 */
import { prisma } from '@prospector/database';
import { dentroDaJanela, type ContextoCadencia, type GatilhoCadencia } from '@prospector/domain';

/**
 * Quantas respostas do lead entram no retrato.
 *
 * O historico inteiro custaria token e afogaria o que importa, que e o
 * fim da conversa. Oito cobre qualquer ida e volta de uma prospeccao.
 */
const MAX_RESPOSTAS = 8;

/**
 * Quantas linhas da conversa inteira entram no retrato.
 *
 * Maior que `MAX_RESPOSTAS` porque conta os dois sentidos: uma
 * prospeccao de tres etapas com resposta em cada uma ja da seis linhas,
 * e cortar antes disso esconderia justamente o comeco da conversa.
 */
const MAX_CONVERSA = 20;

export interface ResultadoContexto {
  contexto: ContextoCadencia | null;
  /** Preenchido quando nao deu para montar. */
  motivo?: string;
}

/**
 * Le tudo o que a IA precisa saber sobre um lead numa campanha.
 *
 * Devolve `contexto: null` — e nao lanca — quando o par lead/campanha
 * nao existe mais ou a campanha foi apagada. Falta de contexto e um
 * estado normal do sistema, nao um erro.
 */
export async function montarContexto(params: {
  leadId: string;
  campaignId: string;
  gatilho: GatilhoCadencia;
  agora?: Date;
}): Promise<ResultadoContexto> {
  const agora = params.agora ?? new Date();

  const [campanha, lead, leadCampaign] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id: params.campaignId },
      select: {
        id: true,
        nome: true,
        status: true,
        horarioInicio: true,
        horarioFim: true,
        diasPermitidos: true,
        steps: {
          where: { ativo: true },
          orderBy: { ordem: 'asc' },
          select: {
            id: true,
            ordem: true,
            nome: true,
            texto: true,
            aguardarResposta: true,
            enviarAutomaticamente: true,
            delayMinSegundos: true,
            delayMaxSegundos: true,
          },
        },
      },
    }),
    prisma.lead.findUnique({
      where: { id: params.leadId },
      select: {
        id: true,
        nomeCompleto: true,
        nomeContato: true,
        empresa: true,
        bairro: true,
        cidade: true,
        optOut: true,
        status: true,
        temperatura: true,
      },
    }),
    prisma.leadCampaign.findUnique({
      where: { leadId_campaignId: { leadId: params.leadId, campaignId: params.campaignId } },
      select: {
        status: true,
        etapaAtualId: true,
        etapaAtualOrdem: true,
        aguardandoLiberacao: true,
        proximoEnvioEm: true,
      },
    }),
  ]);

  if (!campanha) return { contexto: null, motivo: 'Campanha nao encontrada' };
  if (!lead) return { contexto: null, motivo: 'Lead nao encontrado' };

  // --- Os envios REAIS ---
  //
  // Sao DUAS consultas porque sao duas verdades diferentes:
  // `OutboundMessage` sabe se a ordem de envio saiu; so a `Message` sabe
  // se ela chegou e se foi lida (o ACK vive la). O retrato precisa das
  // duas juntas — e e exatamente essa distincao que o modelo tem que ver
  // para nunca confundir "mandei" com "chegou".
  //
  // Casadas pela ETAPA, e nao por `messageId`: aquele campo e escalar,
  // sem relacao no schema, e a etapa e o vinculo que interessa aqui.
  const [outbound, enviadas] = await Promise.all([
    prisma.outboundMessage.findMany({
      where: { leadId: params.leadId, campaignId: params.campaignId },
      select: {
        status: true,
        erro: true,
        dryRun: true,
        processedAt: true,
        campaignStep: { select: { ordem: true } },
      },
    }),
    prisma.message.findMany({
      where: {
        leadId: params.leadId,
        campaignId: params.campaignId,
        direcao: 'ENVIADA',
      },
      select: {
        status: true,
        enviadaEm: true,
        campaignStep: { select: { ordem: true } },
      },
    }),
  ]);

  // Por etapa, o estado mais adiantado que a mensagem alcancou. Se houver
  // mais de uma linha para a mesma etapa — nao deveria haver, mas o
  // codigo nao pode depender disso — a ultima enviada vence.
  const mensagemPorOrdem = new Map<number, { status: string; enviadaEm: Date | null }>();
  for (const m of enviadas) {
    if (!m.campaignStep) continue;
    const atual = mensagemPorOrdem.get(m.campaignStep.ordem);
    if (!atual || (m.enviadaEm && (!atual.enviadaEm || m.enviadaEm > atual.enviadaEm))) {
      mensagemPorOrdem.set(m.campaignStep.ordem, {
        status: m.status,
        enviadaEm: m.enviadaEm,
      });
    }
  }

  const envios = outbound.map((o) => {
    const ordem = o.campaignStep.ordem;
    const msg = mensagemPorOrdem.get(ordem);
    return {
      ordem,
      statusOutbound: o.status,
      statusMensagem: msg?.status ?? null,
      enviadaEm: (msg?.enviadaEm ?? o.processedAt)?.toISOString() ?? null,
      erro: o.erro,
      dryRun: o.dryRun,
    };
  });

  // --- A conversa: os dois sentidos ---
  //
  // UMA consulta para os dois, e nao duas: a ordem cronologica entre o
  // que saiu e o que chegou e o que torna a conversa legivel, e juntar
  // duas listas ordenadas separadamente por campos diferentes
  // (`recebidaEm` e `enviadaEm`) daria uma sequencia embaralhada.
  const linhas = await prisma.message.findMany({
    where: { leadId: params.leadId },
    orderBy: { createdAt: 'desc' },
    take: MAX_CONVERSA,
    select: {
      direcao: true,
      texto: true,
      status: true,
      recebidaEm: true,
      enviadaEm: true,
      createdAt: true,
      categoria: true,
      confianca: true,
    },
  });

  // Mais recentes por ultimo: e assim que se le uma conversa.
  const cronologica = [...linhas].reverse();

  const conversa = cronologica.map((m) => ({
    direcao: m.direcao as 'ENVIADA' | 'RECEBIDA',
    texto: m.texto,
    quando: (m.recebidaEm ?? m.enviadaEm ?? m.createdAt).toISOString(),
    status: m.status,
    ...(m.direcao === 'RECEBIDA'
      ? { categoriaDoMotor: m.categoria ?? 'DESCONHECIDO' }
      : {}),
  }));

  const respostas = cronologica
    .filter((m) => m.direcao === 'RECEBIDA')
    .slice(-MAX_RESPOSTAS)
    .map((m) => ({
      texto: m.texto,
      recebidaEm: (m.recebidaEm ?? m.createdAt).toISOString(),
      categoriaDoMotor: m.categoria ?? 'DESCONHECIDO',
      confiancaDoMotor: m.confianca ?? 0,
    }));

  // --- As regras da etapa atual ---
  const regras = leadCampaign?.etapaAtualId
    ? await prisma.campaignStepRule.findMany({
        where: { campaignStepId: leadCampaign.etapaAtualId, ativo: true },
        select: { categoria: true, acao: true },
      })
    : [];

  // --- O relogio, resolvido pelo backend ---
  //
  // O item "o Gemini nao decide que horas sao" vale tambem para a conta
  // de quanto tempo passou. Ela e feita aqui, e o modelo recebe o
  // numero pronto.
  const ultimoEnvio = envios
    .map((e) => (e.enviadaEm ? new Date(e.enviadaEm).getTime() : null))
    .filter((t): t is number => t !== null)
    .sort((a, b) => b - a)[0];

  const segundosDesdeUltimoEnvio =
    ultimoEnvio === undefined
      ? null
      : Math.max(0, Math.floor((agora.getTime() - ultimoEnvio) / 1000));

  return {
    contexto: {
      gatilho: params.gatilho,
      campanha: {
        id: campanha.id,
        nome: campanha.nome,
        status: campanha.status,
        dentroDaJanela: dentroDaJanela(agora, {
          horarioInicio: campanha.horarioInicio,
          horarioFim: campanha.horarioFim,
          diasPermitidos: campanha.diasPermitidos,
        }),
      },
      sequencia: campanha.steps.map((s) => ({
        ordem: s.ordem,
        nome: s.nome,
        texto: s.texto,
        aguardarResposta: s.aguardarResposta,
        enviarAutomaticamente: s.enviarAutomaticamente,
        // A campanha tem um intervalo (min/max) e o sorteio acontece no
        // enfileiramento. Para o modelo, o minimo e a informacao util:
        // e o "ainda nao deu a hora" mais conservador.
        delaySegundos: s.delayMinSegundos ?? 0,
      })),
      lead: {
        id: lead.id,
        nome: lead.nomeContato ?? lead.nomeCompleto,
        empresa: lead.empresa,
        bairro: lead.bairro,
        cidade: lead.cidade,
        optOut: lead.optOut,
        status: lead.status,
        temperatura: lead.temperatura,
      },
      posicao: {
        etapaAtualOrdem: leadCampaign?.etapaAtualOrdem ?? null,
        statusNaCampanha: leadCampaign?.status ?? 'PENDENTE',
        aguardandoLiberacao: leadCampaign?.aguardandoLiberacao ?? false,
        proximoEnvioEm: leadCampaign?.proximoEnvioEm?.toISOString() ?? null,
      },
      envios,
      respostas,
      conversa,
      regras: regras.map((r) => ({ categoria: r.categoria, acao: r.acao })),
      relogio: {
        agora: agora.toISOString(),
        segundosDesdeUltimoEnvio,
      },
    },
  };
}
