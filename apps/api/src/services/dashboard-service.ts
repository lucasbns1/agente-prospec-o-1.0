/**
 * Agregacoes do dashboard.
 *
 * Este arquivo so BUSCA e MONTA. A decisao de ordem e de deduplicacao
 * mora em `@prospector/domain` (`priorizarAtencao`), que e testavel sem
 * banco.
 *
 * As seis consultas de candidatos rodam em paralelo e cada uma tem seu
 * proprio teto. Sem teto, um banco com 5 mil leads frios geraria 5 mil
 * candidatos para a funcao descartar depois — trabalho jogado fora no
 * banco, que e onde ele custa mais caro.
 */
import { prisma } from '@prospector/database';
import {
  agruparSemResposta,
  contarLeadsPorEtapa,
  montarResumoPorNicho,
  priorizarAtencao,
  estadoAoAssumirConversa,
  ORIGEM_MARCADO_A_MAO,
  DESCRICAO_MARCADO_A_MAO,
  type CandidatoAtencao,
  type EnvioSemResposta,
  type EtapaComLeads,
  type GrupoSemResposta,
  type LeadDoNicho,
  type ResumoPorNicho,
  type ItemAtencao,
} from '@prospector/domain';

/** Teto por motivo. A lista final é cortada de novo pelo domínio. */
const LIMITE_POR_MOTIVO = 25;

/** Status em que o lead saiu do jogo — não faz sentido cobrar ação. */
const STATUS_ENCERRADOS = ['OPT_OUT', 'ENCERRADO', 'CLIENTE'] as const;

const SELECAO = {
  id: true,
  nomeCompleto: true,
  empresa: true,
  categoria: true,
  bairro: true,
  cidade: true,
  temperatura: true,
  status: true,
  ultimaInteracaoEm: true,
  updatedAt: true,
} as const;

type LeadSelecionado = {
  id: string;
  nomeCompleto: string | null;
  empresa: string | null;
  categoria: string | null;
  bairro: string | null;
  cidade: string | null;
  temperatura: string;
  status: string;
  ultimaInteracaoEm: Date | null;
  updatedAt: Date;
};

function paraCandidato(
  lead: LeadSelecionado,
  motivo: CandidatoAtencao['motivo'],
  extras: { ultimaMensagem?: string | null; etapaAtual?: string | null; em?: Date } = {}
): CandidatoAtencao {
  return {
    leadId: lead.id,
    nome: lead.nomeCompleto ?? lead.empresa,
    categoria: lead.categoria,
    bairro: lead.bairro,
    cidade: lead.cidade,
    temperatura: lead.temperatura,
    status: lead.status,
    motivo,
    ultimaMensagem: extras.ultimaMensagem ?? null,
    etapaAtual: extras.etapaAtual ?? null,
    // `ultimaInteracaoEm` é o instante que importa: é quando o lead
    // passou a esperar. `updatedAt` é só o fallback.
    em: extras.em ?? lead.ultimaInteracaoEm ?? lead.updatedAt,
  };
}

export async function montarAtencao(limite = 20): Promise<ItemAtencao[]> {
  const agora = new Date();

  const [
    intervencao,
    quentes,
    pedidosPreco,
    tarefasAtrasadas,
    errosEnvio,
    tarefasPreview,
  ] = await Promise.all([
    // 1. O sistema não entendeu e parou. Ninguém está respondendo.
    prisma.lead.findMany({
      where: { status: 'AGUARDANDO_INTERVENCAO' },
      select: SELECAO,
      orderBy: { ultimaInteracaoEm: 'asc' },
      take: LIMITE_POR_MOTIVO,
    }),

    // 2. Lead quente que ainda não virou cliente.
    prisma.lead.findMany({
      where: {
        temperatura: 'QUENTE',
        optOut: false,
        status: { notIn: [...STATUS_ENCERRADOS] },
      },
      select: SELECAO,
      orderBy: { ultimaInteracaoEm: 'asc' },
      take: LIMITE_POR_MOTIVO,
    }),

    // 3. Perguntou preço. Sem resposta, esfria rápido.
    prisma.lead.findMany({
      where: {
        ultimaCategoria: 'PRECO',
        optOut: false,
        status: { notIn: [...STATUS_ENCERRADOS] },
      },
      select: SELECAO,
      orderBy: { ultimaInteracaoEm: 'asc' },
      take: LIMITE_POR_MOTIVO,
    }),

    prisma.task.findMany({
      where: {
        status: { in: ['ABERTA', 'EM_ANDAMENTO'] },
        prazo: { lt: agora },
        leadId: { not: null },
      },
      select: { prazo: true, titulo: true, lead: { select: SELECAO } },
      orderBy: { prazo: 'asc' },
      take: LIMITE_POR_MOTIVO,
    }),

    prisma.outboundMessage.findMany({
      where: { status: 'FALHOU' },
      select: { erro: true, processedAt: true, lead: { select: SELECAO } },
      orderBy: { processedAt: 'desc' },
      take: LIMITE_POR_MOTIVO,
    }),

    prisma.task.findMany({
      where: {
        tipo: 'CRIAR_PREVIEW',
        status: { in: ['ABERTA', 'EM_ANDAMENTO'] },
        leadId: { not: null },
      },
      select: { createdAt: true, titulo: true, lead: { select: SELECAO } },
      orderBy: { createdAt: 'asc' },
      take: LIMITE_POR_MOTIVO,
    }),
  ]);

  const candidatos: CandidatoAtencao[] = [
    ...intervencao.map((l) => paraCandidato(l, 'INTERVENCAO_NECESSARIA')),
    ...quentes.map((l) => paraCandidato(l, 'LEAD_QUENTE')),
    ...pedidosPreco.map((l) => paraCandidato(l, 'PEDIDO_PRECO')),
    ...tarefasAtrasadas
      .filter((t) => t.lead !== null)
      .map((t) =>
        paraCandidato(t.lead!, 'TAREFA_ATRASADA', {
          ultimaMensagem: t.titulo,
          em: t.prazo ?? undefined,
        })
      ),
    ...errosEnvio
      .filter((m) => m.lead !== null)
      .map((m) =>
        paraCandidato(m.lead, 'ERRO_ENVIO', {
          ultimaMensagem: m.erro,
          em: m.processedAt ?? undefined,
        })
      ),
    ...tarefasPreview
      .filter((t) => t.lead !== null)
      .map((t) =>
        paraCandidato(t.lead!, 'PEDIDO_PREVIEW', {
          ultimaMensagem: t.titulo,
          em: t.createdAt,
        })
      ),
  ];

  return priorizarAtencao(candidatos, { limite });
}

export interface ResumoCampanhaAtiva {
  id: string;
  nome: string;
  nicho: string | null;
  cidade: string | null;
  totalLeads: number;
  enviadasHoje: number;
  respostas: number;
  quentes: number;
  limiteDiario: number;
}

/**
 * Resumo da campanha ativa mais recente.
 *
 * Os quatro contadores eram fixos em zero desde a Fase 1 — o card
 * existia mas mentia. Agora vêm do banco.
 */
export async function resumoCampanhaAtiva(): Promise<ResumoCampanhaAtiva | null> {
  const campanha = await prisma.campaign.findFirst({
    where: { status: 'ATIVA' },
    orderBy: { iniciadaEm: 'desc' },
  });
  if (!campanha) return null;

  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);

  const [totalLeads, enviadasHoje, respostas, quentes] = await Promise.all([
    prisma.outboundMessage.count({ where: { campaignId: campanha.id } }),
    // Só envios REAIS de hoje. Simulações não consomem cota e não podem
    // dar a impressão de que a campanha está rodando de verdade.
    prisma.outboundMessage.count({
      where: {
        campaignId: campanha.id,
        status: 'ENVIADA',
        processedAt: { gte: inicioDoDia },
      },
    }),
    prisma.message.count({
      where: { campaignId: campanha.id, direcao: 'RECEBIDA' },
    }),
    prisma.lead.count({
      where: {
        temperatura: 'QUENTE',
        outbound: { some: { campaignId: campanha.id } },
      },
    }),
  ]);

  return {
    id: campanha.id,
    nome: campanha.nome,
    nicho: campanha.nicho,
    cidade: campanha.cidade,
    totalLeads,
    enviadasHoje,
    respostas,
    quentes,
    limiteDiario: campanha.limiteDiarioEnvios,
  };
}


/**
 * Quem recebeu mensagem e nunca respondeu, agrupado pela ultima etapa
 * que saiu.
 *
 * ============================================================
 * O SILENCIO NAO TINHA TELA
 * ============================================================
 * Todo o resto do dashboard fala de leads que FIZERAM alguma coisa. O
 * grupo maior de qualquer prospeccao — quem recebeu e ficou calado — nao
 * aparecia em lugar nenhum, nem para contar quantos sao.
 *
 * ============================================================
 * "NAO RESPONDEU" E LITERAL
 * ============================================================
 * Zero mensagens RECEBIDAS daquele lead. Nao e "nao respondeu a esta
 * etapa": e nunca falou nada. Alguem que respondeu a mensagem 1 e sumiu
 * na 2 nao esta aqui — ele ja aparece nas outras secoes, com o que
 * disse.
 *
 * SIMULADA nao conta como envio: um ensaio nao gerou silencio de
 * ninguem.
 *
 * Opt-outs e encerrados ficam de fora: cobrar acao de quem saiu do jogo
 * e a forma mais rapida de uma tela virar ruido.
 */
export async function leadsSemResposta(
  limitePorEtapa = 50
): Promise<GrupoSemResposta[]> {
  // Quem ja falou alguma coisa, uma vez que seja.
  const responderam = await prisma.message.findMany({
    where: { direcao: 'RECEBIDA' },
    select: { leadId: true },
    distinct: ['leadId'],
  });
  const jaFalaram = new Set(
    responderam.map((r) => r.leadId).filter((id): id is string => id !== null)
  );

  // Quem VOCE ja riscou da lista com o botao "já mandei".
  //
  // Sem isto a lista e uma fila de trabalho que nunca encolhe: voce
  // manda na mao, volta ao dashboard, e os mesmos leads continuam la —
  // ate voce mandar de novo para o mesmo numero.
  const marcados = await prisma.leadEvent.findMany({
    where: { tipo: 'MENSAGEM_ENVIADA', origem: ORIGEM_MARCADO_A_MAO },
    select: { leadId: true },
    distinct: ['leadId'],
  });
  for (const m of marcados) jaFalaram.add(m.leadId);

  const envios = await prisma.outboundMessage.findMany({
    where: {
      // ENVIADA de verdade. `SIMULADA` fica fora de proposito.
      status: 'ENVIADA',
      ...(jaFalaram.size > 0 ? { leadId: { notIn: [...jaFalaram] } } : {}),
      lead: {
        optOut: false,
        status: { notIn: [...STATUS_ENCERRADOS] },
      },
    },
    select: {
      leadId: true,
      processedAt: true,
      createdAt: true,
      campaignStep: { select: { ordem: true, nome: true } },
      lead: {
        select: {
          nomeCompleto: true,
          empresa: true,
          categoria: true,
          bairro: true,
          cidade: true,
          temperatura: true,
          status: true,
        },
      },
    },
    orderBy: { processedAt: 'desc' },
    // Teto generoso: o agrupamento e por lead, e um lead com tres etapas
    // ocupa tres linhas aqui. Cortar cedo demais esconderia leads
    // inteiros, e nao so o excedente de um grupo.
    take: limitePorEtapa * 20,
  });

  const linhas: EnvioSemResposta[] = envios
    .filter((e) => e.campaignStep !== null && e.lead !== null)
    .map((e) => ({
      leadId: e.leadId,
      nome: e.lead!.empresa ?? e.lead!.nomeCompleto,
      categoria: e.lead!.categoria,
      bairro: e.lead!.bairro,
      cidade: e.lead!.cidade,
      temperatura: e.lead!.temperatura,
      status: e.lead!.status,
      ordem: e.campaignStep!.ordem,
      etapaNome: e.campaignStep!.nome,
      // `processedAt` e quando saiu. Sem ele — nao deveria acontecer numa
      // ENVIADA — o `createdAt` serve de piso.
      enviadaEm: e.processedAt ?? e.createdAt,
    }));

  return agruparSemResposta(linhas).map((g) => ({
    ...g,
    // O total continua sendo o de VERDADE; so a lista e cortada. Um
    // contador que encolhe junto com a pagina mente sobre o tamanho do
    // problema.
    leads: g.leads.slice(0, limitePorEtapa),
  }));
}

/**
 * Onde a sua prospeccao esta: quantos leads pararam em cada etapa.
 *
 * ============================================================
 * O NUMERO QUE FALTAVA
 * ============================================================
 * Pedido: "coloque também: clientes etapa tal / clientes etapa tal".
 *
 * O painel sabia dizer quantos leads existem, quantos estao quentes e
 * quantos fecharam — e nao sabia dizer a coisa mais simples de todas:
 * ate onde a sequencia foi. Vinte pessoas paradas na mensagem 1 e vinte
 * espalhadas ate a 4 sao duas semanas completamente diferentes, e as
 * metricas que a tela mostrava eram identicas nos dois casos.
 *
 * SIMULADA fica de fora: um ensaio nao colocou ninguem em etapa nenhuma.
 * Opt-outs e encerrados tambem — eles sairam da fila, e conta-los como
 * "esta na etapa 2" faria a fila parecer maior do que e.
 *
 * A regra de "esta na etapa N" (a MAIOR que saiu) e do dominio, em
 * `contarLeadsPorEtapa`.
 */
export async function leadsPorEtapa(): Promise<EtapaComLeads[]> {
  const envios = await prisma.outboundMessage.findMany({
    where: {
      status: 'ENVIADA',
      lead: { optOut: false, status: { notIn: [...STATUS_ENCERRADOS] } },
    },
    select: {
      leadId: true,
      campaignStep: { select: { ordem: true, nome: true } },
    },
  });

  return contarLeadsPorEtapa(
    envios
      .filter((e) => e.campaignStep !== null)
      .map((e) => ({
        leadId: e.leadId,
        ordem: e.campaignStep!.ordem,
        etapaNome: e.campaignStep!.nome,
      }))
  );
}

/**
 * A prospeccao separada por nicho, mais o total de tudo.
 *
 * ============================================================
 * O NICHO EXISTIA E NAO APARECIA
 * ============================================================
 * Pedido: "quero que tenha um total — todos os nichos mandados — e as
 * informacoes de quantos mandaram e etc de cada nicho tambem".
 *
 * Desde a importacao, "psicologos em Campinas" vira uma CaptureSession
 * que etiqueta cada lead do lote. Esse dado estava no banco e nao
 * chegava em tela nenhuma: todo numero do painel era a soma de tudo — e
 * a soma de tudo esconde a decisao que a semana seguinte pede, que e
 * qual lista vale continuar.
 *
 * ============================================================
 * TRES CONSULTAS, E NAO UMA POR NICHO
 * ============================================================
 * A tentacao aqui e um `count` por nicho por metrica, que vira dezenas
 * de idas ao banco e cresce com o numero de planilhas importadas.
 *
 * Em vez disso: uma linha por lead, uma contagem de envios por lead, e a
 * lista de quem respondeu. O cruzamento e feito em memoria pelo dominio.
 * E um CRM local de uma pessoa — alguns milhares de linhas cabem
 * folgado, e a conta fica num lugar que da para testar.
 *
 * SIMULADA nao conta como envio: um ensaio nao abordou ninguem.
 */
export async function resumoPorNicho(): Promise<ResumoPorNicho> {
  const [leads, envios, responderam] = await Promise.all([
    prisma.lead.findMany({
      select: {
        id: true,
        temperatura: true,
        status: true,
        optOut: true,
        captureSession: { select: { nicho: true } },
      },
    }),
    prisma.outboundMessage.groupBy({
      by: ['leadId'],
      where: { status: 'ENVIADA' },
      _count: { _all: true },
    }),
    prisma.message.findMany({
      where: { direcao: 'RECEBIDA' },
      select: { leadId: true },
      distinct: ['leadId'],
    }),
  ]);

  const enviadasPorLead = new Map(envios.map((e) => [e.leadId, e._count._all]));
  const falaram = new Set(
    responderam.map((r) => r.leadId).filter((id): id is string => id !== null)
  );

  const linhas: LeadDoNicho[] = leads.map((l) => ({
    leadId: l.id,
    nicho: l.captureSession?.nicho ?? null,
    temperatura: l.temperatura,
    status: l.status,
    optOut: l.optOut,
    enviadas: enviadasPorLead.get(l.id) ?? 0,
    respondeu: falaram.has(l.id),
  }));

  return montarResumoPorNicho(linhas);
}
