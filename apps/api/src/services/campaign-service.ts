/**
 * Servico de campanhas.
 *
 * Orquestra: filtros -> qualificacao (domain) -> render (domain) ->
 * agendamento (domain) -> fila (banco). Nenhuma regra de negocio mora
 * aqui; este arquivo so coordena e persiste.
 *
 * ============================================================
 * O ENVIO REAL NAO ACONTECE AQUI
 * ============================================================
 * Este servico apenas ENFILEIRA. Quem processa e o worker, e ele esta
 * em dry-run. Nenhuma funcao deste arquivo chama o WhatsApp.
 */
import { prisma, Prisma } from '@prospector/database';
import { createHash } from 'node:crypto';
import {
  qualificarLead,
  renderizarMensagem,
  calcularAgendamento,
  distribuirNoTempo,
  type CriteriosQualificacao,
  type LeadParaQualificar,
  type ContextoLead,
} from '@prospector/domain';

// -----------------------------------------------------------------------------
// FILTROS
// -----------------------------------------------------------------------------

/** Filtros de segmentacao, guardados em `Campaign.filtros`. */
export interface FiltrosCampanha extends CriteriosQualificacao {
  /** Filtro adicional aplicado no SQL, antes da qualificacao. */
  status?: string[];
  origem?: string[];
  /**
   * Lotes de importacao. E o filtro que responde "faca a campanha em
   * cima da planilha de psicologos de Campinas que subi ontem" — sem
   * ele, o publico e sempre "todos os leads que casam com os criterios",
   * misturando nichos e cidades de planilhas diferentes.
   */
  captureSessionIds?: string[];
  /** Lotes por arquivo, quando a importacao nao foi classificada. */
  importIds?: string[];
  /** true = exclui quem ja recebeu mensagem de QUALQUER campanha. */
  excluirJaContatados?: boolean;
}

/**
 * Monta o WHERE do Prisma a partir dos filtros.
 *
 * O que da para filtrar em SQL fica em SQL — carregar 10 mil leads na
 * memoria para descartar 9 mil seria desperdicio. A qualificacao fina
 * (que precisa de motivo legivel) roda depois, sobre o subconjunto.
 *
 * DUAS EXCLUSOES SAO SEMPRE APLICADAS, independentemente dos filtros:
 * opt-out e leads aguardando intervencao. Elas nao sao configuraveis.
 */
export function montarWhere(filtros: FiltrosCampanha): Prisma.LeadWhereInput {
  const condicoes: Prisma.LeadWhereInput[] = [
    // --- Exclusoes inegociaveis ---
    { optOut: false },
    { status: { notIn: ['OPT_OUT', 'AGUARDANDO_INTERVENCAO'] } },
  ];

  if (filtros.exigirTelefone !== false) {
    condicoes.push({ telefoneNormalizado: { not: null } });
  }

  if (filtros.exigirSemSite) {
    condicoes.push({
      websiteStatus: { in: ['NAO_INFORMADO', 'REDE_SOCIAL', 'INVALIDO'] },
    });
  }
  if (filtros.exigirComSite) {
    condicoes.push({ websiteStatus: 'SITE_PROPRIO' });
  }
  if (filtros.exigirSemInstagram) condicoes.push({ instagramUrl: null });
  if (filtros.exigirComInstagram) condicoes.push({ instagramUrl: { not: null } });

  if (filtros.avaliacaoMinima !== undefined) {
    condicoes.push({ avaliacao: { gte: filtros.avaliacaoMinima } });
  }
  if (filtros.totalAvaliacoesMinimo !== undefined) {
    condicoes.push({ totalAvaliacoes: { gte: filtros.totalAvaliacoesMinimo } });
  }

  if (filtros.cidades?.length) {
    condicoes.push({ OR: filtros.cidades.map((c) => ({ cidade: { equals: c, mode: 'insensitive' as const } })) });
  }
  if (filtros.estados?.length) {
    condicoes.push({ estado: { in: filtros.estados.map((e) => e.toUpperCase()) } });
  }
  if (filtros.categorias?.length) {
    condicoes.push({
      OR: filtros.categorias.map((c) => ({
        categoria: { contains: c, mode: 'insensitive' as const },
      })),
    });
  }
  if (filtros.tags?.length) condicoes.push({ tags: { hasSome: filtros.tags } });
  if (filtros.status?.length) condicoes.push({ status: { in: filtros.status as never[] } });
  if (filtros.origem?.length) condicoes.push({ origem: { in: filtros.origem } });

  // Lote: por sessao de captura (planilha classificada) ou por arquivo.
  // Os dois entram como OR — escolher "psicologos Campinas" e mais uma
  // planilha solta e uma combinacao legitima.
  const lotes: Prisma.LeadWhereInput[] = [];
  if (filtros.captureSessionIds?.length) {
    lotes.push({ captureSessionId: { in: filtros.captureSessionIds } });
  }
  if (filtros.importIds?.length) {
    lotes.push({ importId: { in: filtros.importIds } });
  }
  if (lotes.length > 0) condicoes.push({ OR: lotes });

  if (filtros.excluirJaContatados || filtros.apenasNuncaContatados) {
    condicoes.push({ messages: { none: { direcao: 'ENVIADA' } } });
  }

  return { AND: condicoes };
}

// -----------------------------------------------------------------------------
// PREVIEW
// -----------------------------------------------------------------------------

export interface ResumoPreview {
  totalEncontrados: number;
  elegiveis: number;
  bloqueados: number;
  naoQualificados: number;
  revisar: number;
  semTelefone: number;
  optOut: number;
  jaContatados: number;
  prontos: number;
}

export interface LinhaPreview {
  leadId: string;
  empresa: string | null;
  telefone: string | null;
  cidade: string | null;
  site: string | null;
  temSite: boolean;
  instagram: string | null;
  avaliacao: number | null;
  totalAvaliacoes: number | null;
  status: string;
  qualificacao: string;
  motivo: string;
  /** Mensagem que ESTE lead receberia. `null` se bloqueada. */
  mensagemPrevista: string | null;
  motivoBloqueioMensagem: string | null;
  variaveisUsadas: Record<string, string>;
}

export interface ResultadoPreview {
  resumo: ResumoPreview;
  linhas: LinhaPreview[];
  truncado: boolean;
  /** Texto da etapa usado para renderizar a previa. */
  templateUsado: string | null;
}

/** Campos do lead necessarios para qualificar e renderizar. */
const SELECAO_LEAD = {
  id: true, nomeCompleto: true, primeiroNome: true, nomeContato: true, empresa: true,
  telefone: true, telefoneNormalizado: true, websiteStatus: true, websiteUrl: true,
  instagramUrl: true, cidade: true, bairro: true, estado: true, categoria: true,
  avaliacao: true, totalAvaliacoes: true, status: true, optOut: true, tags: true,
} as const;

type LeadSelecionado = Prisma.LeadGetPayload<{ select: typeof SELECAO_LEAD }>;

function paraQualificar(l: LeadSelecionado, jaContatado: boolean): LeadParaQualificar {
  return {
    id: l.id,
    nomeCompleto: l.nomeCompleto,
    primeiroNome: l.primeiroNome,
    empresa: l.empresa,
    telefoneNormalizado: l.telefoneNormalizado,
    websiteStatus: l.websiteStatus,
    instagramUrl: l.instagramUrl,
    cidade: l.cidade,
    estado: l.estado,
    categoria: l.categoria,
    avaliacao: l.avaliacao,
    totalAvaliacoes: l.totalAvaliacoes,
    status: l.status,
    optOut: l.optOut,
    tags: l.tags,
    jaContatado,
  };
}

function paraContexto(l: LeadSelecionado): ContextoLead {
  return {
    nome: l.nomeCompleto,
    primeiro_nome: l.primeiroNome,
    // Nome de pessoa sai SO de `nomeContato`, preenchido a partir de uma
    // coluna declarada de responsavel — nunca do estabelecimento.
    nome_contato: l.nomeContato,
    empresa: l.empresa ?? l.nomeCompleto,
    cidade: l.cidade,
    bairro: l.bairro,
    estado: l.estado,
    categoria: l.categoria,
    telefone: l.telefoneNormalizado,
    avaliacao: l.avaliacao,
    totalAvaliacoes: l.totalAvaliacoes,
    site_preview_url: null,
  };
}

/** Resolve o texto de uma etapa: template tem prioridade sobre o inline. */
export async function textoDaEtapa(campaignStepId: string): Promise<string | null> {
  const etapa = await prisma.campaignStep.findUnique({
    where: { id: campaignStepId },
    include: { template: true },
  });
  if (!etapa) return null;
  return etapa.template?.texto ?? etapa.texto ?? null;
}

/**
 * Pre-visualizacao da campanha. NAO GRAVA NADA E NAO ENVIA NADA.
 */
export async function previewCampanha(
  campaignId: string,
  limite = 100
): Promise<ResultadoPreview> {
  const campanha = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      steps: {
        where: { ativo: true },
        orderBy: { ordem: 'asc' },
        take: 1,
        include: { template: true },
      },
    },
  });
  if (!campanha) throw new Error('Campanha nao encontrada');

  const filtros = (campanha.filtros ?? {}) as FiltrosCampanha;
  const primeiraEtapa = campanha.steps[0];
  const template = primeiraEtapa?.template?.texto ?? primeiraEtapa?.texto ?? null;

  // O WHERE ja exclui opt-out e intervencao. Para o RESUMO, porem,
  // precisamos saber quantos ficaram de fora e por que — entao contamos
  // os excluidos separadamente.
  const where = montarWhere(filtros);

  const [totalEncontrados, optOut, semTelefone] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { optOut: true } }),
    prisma.lead.count({ where: { telefoneNormalizado: null } }),
  ]);

  const leads = await prisma.lead.findMany({
    where,
    select: { ...SELECAO_LEAD, _count: { select: { messages: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.max(limite, 1),
  });

  const resumo: ResumoPreview = {
    totalEncontrados, elegiveis: 0, bloqueados: 0, naoQualificados: 0,
    revisar: 0, semTelefone, optOut, jaContatados: 0, prontos: 0,
  };

  const linhas: LinhaPreview[] = [];

  for (const lead of leads) {
    const jaContatado = lead._count.messages > 0;
    if (jaContatado) resumo.jaContatados++;

    const q = qualificarLead(paraQualificar(lead, jaContatado), filtros);

    if (q.qualificacao === 'QUALIFICADO') resumo.elegiveis++;
    else if (q.qualificacao === 'BLOQUEADO') resumo.bloqueados++;
    else if (q.qualificacao === 'REVISAR') resumo.revisar++;
    else resumo.naoQualificados++;

    // Renderiza a mensagem DESTE lead, com os dados DELE.
    let mensagem: string | null = null;
    let motivoMensagem: string | null = null;
    let variaveis: Record<string, string> = {};

    if (template) {
      const r = renderizarMensagem(template, paraContexto(lead));
      mensagem = r.texto;
      motivoMensagem = r.motivoBloqueio;
      variaveis = r.variaveisUsadas;
    } else {
      motivoMensagem = 'A campanha nao tem etapa ativa com texto';
    }

    if (q.qualificacao === 'QUALIFICADO' && mensagem) resumo.prontos++;

    linhas.push({
      leadId: lead.id,
      empresa: lead.empresa ?? lead.nomeCompleto,
      telefone: lead.telefone,
      cidade: lead.cidade,
      site: lead.websiteUrl,
      temSite: lead.websiteStatus === 'SITE_PROPRIO',
      instagram: lead.instagramUrl,
      avaliacao: lead.avaliacao,
      totalAvaliacoes: lead.totalAvaliacoes,
      status: lead.status,
      qualificacao: q.qualificacao,
      motivo: q.motivo,
      mensagemPrevista: mensagem,
      motivoBloqueioMensagem: motivoMensagem,
      variaveisUsadas: variaveis,
    });
  }

  return {
    resumo,
    linhas,
    truncado: totalEncontrados > leads.length,
    templateUsado: template,
  };
}

// -----------------------------------------------------------------------------
// ENFILEIRAMENTO
// -----------------------------------------------------------------------------

/**
 * Chave de idempotencia deterministica.
 *
 * Mesmo lead + mesma campanha + mesma etapa = mesma chave, sempre.
 * Cem jobs identicos colidem na constraint UNIQUE e resultam em UMA
 * linha. E o banco que garante, nao a aplicacao.
 */
export function chaveIdempotencia(
  leadId: string,
  campaignId: string,
  campaignStepId: string
): string {
  const base = `${leadId}|${campaignId}|${campaignStepId}`;
  return `out:${createHash('sha256').update(base).digest('hex').slice(0, 40)}`;
}

export interface ResultadoEnfileiramento {
  criadas: number;
  bloqueadas: number;
  jaExistiam: number;
  detalhes: Array<{
    leadId: string;
    empresa: string | null;
    resultado: 'CRIADA' | 'BLOQUEADA' | 'JA_EXISTIA';
    motivo: string | null;
  }>;
}

/**
 * Coloca a primeira etapa da campanha na fila.
 *
 * NAO ENVIA NADA. Cria linhas em `outbound_messages` com `scheduledAt`
 * calculado. O worker (em dry-run) e quem processa depois.
 */
export async function enfileirarCampanha(
  campaignId: string,
  opcoes: { agora?: Date; limite?: number } = {}
): Promise<ResultadoEnfileiramento> {
  const agora = opcoes.agora ?? new Date();

  const campanha = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      steps: {
        where: { ativo: true },
        orderBy: { ordem: 'asc' },
        take: 1,
        include: { template: true },
      },
    },
  });

  if (!campanha) throw new Error('Campanha nao encontrada');

  const resultado: ResultadoEnfileiramento = {
    criadas: 0, bloqueadas: 0, jaExistiam: 0, detalhes: [],
  };

  // --- Guardas de campanha ---
  if (campanha.status !== 'ATIVA') {
    throw new Error(
      `Campanha esta ${campanha.status}. Só campanhas ATIVAS podem enfileirar.`
    );
  }

  const etapa = campanha.steps[0];
  if (!etapa) {
    throw new Error('Campanha nao tem nenhuma etapa ativa');
  }

  const template = etapa.template?.texto ?? etapa.texto;
  if (!template || template.trim() === '') {
    throw new Error('A etapa nao tem texto nem template');
  }

  const filtros = (campanha.filtros ?? {}) as FiltrosCampanha;
  const limite =
    opcoes.limite ?? (campanha.maxLeads > 0 ? campanha.maxLeads : 500);

  const leads = await prisma.lead.findMany({
    where: montarWhere(filtros),
    select: { ...SELECAO_LEAD, _count: { select: { messages: true } } },
    orderBy: { createdAt: 'desc' },
    take: limite,
  });

  // Espalha o primeiro disparo: 76 mensagens no mesmo segundo e o
  // padrao de disparo em massa que os antispam mais reconhecem.
  const horarios = distribuirNoTempo(leads.length, agora, {
    minSegundos: campanha.delayEntreLeadsMinSegundos,
    maxSegundos: campanha.delayEntreLeadsMaxSegundos,
  });

  const janela = {
    horarioInicio: campanha.horarioInicio,
    horarioFim: campanha.horarioFim,
    diasPermitidos: campanha.diasPermitidos,
  };

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]!;
    const jaContatado = lead._count.messages > 0;
    const idempotencyKey = chaveIdempotencia(lead.id, campanha.id, etapa.id);

    // --- Validacoes de bloqueio (Fase F) ---
    const q = qualificarLead(paraQualificar(lead, jaContatado), filtros);

    let motivoBloqueio:
      | 'LEAD_OPT_OUT' | 'LEAD_SEM_TELEFONE' | 'LEAD_AGUARDANDO_INTERVENCAO'
      | 'LEAD_BLOQUEADO' | 'VARIAVEL_OBRIGATORIA_AUSENTE' | 'MENSAGEM_VAZIA'
      | 'MENSAGEM_MUITO_LONGA' | 'FORA_DA_JANELA' | null = null;
    let detalhe: string | null = null;
    let textoRenderizado: string | null = null;
    let variaveis: Record<string, string> = {};

    if (q.qualificacao !== 'QUALIFICADO') {
      if (lead.optOut) motivoBloqueio = 'LEAD_OPT_OUT';
      else if (!lead.telefoneNormalizado) motivoBloqueio = 'LEAD_SEM_TELEFONE';
      else if (lead.status === 'AGUARDANDO_INTERVENCAO') {
        motivoBloqueio = 'LEAD_AGUARDANDO_INTERVENCAO';
      } else motivoBloqueio = 'LEAD_BLOQUEADO';
      detalhe = q.motivo;
    } else {
      const r = renderizarMensagem(template, paraContexto(lead));
      if (!r.ok) {
        motivoBloqueio = r.faltando.length > 0
          ? 'VARIAVEL_OBRIGATORIA_AUSENTE'
          : 'MENSAGEM_VAZIA';
        detalhe = r.motivoBloqueio;
      } else {
        textoRenderizado = r.texto;
        variaveis = r.variaveisUsadas;
      }
    }

    // --- Agendamento ---
    let scheduledAt: Date | null = null;
    if (!motivoBloqueio) {
      const ag = calcularAgendamento({
        agora: horarios[i]!,
        intervalo: {
          minSegundos: campanha.delayMinSegundos,
          maxSegundos: campanha.delayMaxSegundos,
        },
        janela,
        limites: {
          limiteDiario: campanha.limiteDiarioEnvios,
          limiteHorario: campanha.limiteHorarioEnvios,
          // Em dry-run nada conta para os limites reais.
          enviadosHoje: 0,
          enviadosNaHora: 0,
        },
      });

      if ('bloqueado' in ag) {
        motivoBloqueio = 'FORA_DA_JANELA';
        detalhe = ag.detalhe;
      } else {
        scheduledAt = ag.scheduledAt;
      }
    }

    // --- Grava, tratando colisao como "ja existe" ---
    //
    // INSERT direto com catch de P2002. Nao ha SELECT antes: esse par
    // nao e atomico e permitiria duas linhas sob concorrencia.
    try {
      await prisma.outboundMessage.create({
        data: {
          leadId: lead.id,
          campaignId: campanha.id,
          campaignStepId: etapa.id,
          idempotencyKey,
          status: motivoBloqueio ? 'BLOQUEADA' : 'AGENDADA',
          motivoBloqueio,
          detalheBloqueio: detalhe,
          telefoneDestino: lead.telefoneNormalizado,
          textoRenderizado,
          textoTemplate: template,
          variaveisUsadas: variaveis as Prisma.InputJsonValue,
          scheduledAt,
          dryRun: true,
        },
      });

      // --- O vinculo lead <-> campanha ---
      //
      // E o que alimenta o quadro de estado. Sem esta linha o lead entra
      // na fila mas nao aparece em coluna nenhuma: o quadro leria uma
      // tabela que ninguem escreve.
      //
      // `upsert` porque enfileirar duas vezes e normal (voce adiciona
      // leads novos a uma campanha ja rodando) e nao pode derrubar o
      // progresso de quem ja esta andando.
      await prisma.leadCampaign.upsert({
        where: { leadId_campaignId: { leadId: lead.id, campaignId: campanha.id } },
        // Nasce PENDENTE e SEM etapa: ele ainda nao recebeu nada. Dizer
        // que ja esta na etapa 1 seria afirmar um envio que nao houve.
        create: {
          leadId: lead.id,
          campaignId: campanha.id,
          status: motivoBloqueio ? 'PARADO' : 'PENDENTE',
          motivoParada: motivoBloqueio ? detalhe : null,
        },
        // Reenfileirar NAO reseta quem ja avancou.
        update: {},
      });

      if (motivoBloqueio) {
        resultado.bloqueadas++;
        resultado.detalhes.push({
          leadId: lead.id, empresa: lead.empresa ?? lead.nomeCompleto,
          resultado: 'BLOQUEADA', motivo: detalhe,
        });
      } else {
        resultado.criadas++;
        resultado.detalhes.push({
          leadId: lead.id, empresa: lead.empresa ?? lead.nomeCompleto,
          resultado: 'CRIADA', motivo: null,
        });
      }
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        resultado.jaExistiam++;
        resultado.detalhes.push({
          leadId: lead.id, empresa: lead.empresa ?? lead.nomeCompleto,
          resultado: 'JA_EXISTIA', motivo: 'Ja existe mensagem para este lead nesta etapa',
        });
        continue;
      }
      throw err;
    }
  }

  return resultado;
}

/** Recalcula e grava a qualificacao de todos os leads que casam com o filtro. */
export async function requalificarLeads(
  filtros: FiltrosCampanha = {},
  limite = 5000
): Promise<{ atualizados: number; porQualificacao: Record<string, number> }> {
  const leads = await prisma.lead.findMany({
    select: { ...SELECAO_LEAD, _count: { select: { messages: true } } },
    take: limite,
  });

  const contagem: Record<string, number> = {};
  let atualizados = 0;
  const agora = new Date();

  for (const lead of leads) {
    const q = qualificarLead(
      paraQualificar(lead, lead._count.messages > 0),
      filtros
    );
    contagem[q.qualificacao] = (contagem[q.qualificacao] ?? 0) + 1;

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        qualificacao: q.qualificacao as never,
        motivoQualificacao: q.motivo,
        qualificadoEm: agora,
      },
    });
    atualizados++;
  }

  return { atualizados, porQualificacao: contagem };
}
