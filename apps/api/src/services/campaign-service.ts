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
import {
  chaveIdempotencia,
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
 * Esta campanha esta presa a uma planilha, ou pega o CRM inteiro?
 *
 * ============================================================
 * POR QUE ISTO E UMA PERGUNTA QUE PRECISA DE RESPOSTA
 * ============================================================
 * Uma campanha nao guarda copia da planilha: guarda um FILTRO. Sem lote
 * escolhido, o filtro nao restringe nada e o publico e toda lead ja
 * importada — de qualquer lista, nicho ou cidade.
 *
 * Aconteceu de verdade: uma campanha de Muzambinho, Guaxupe e Alfenas
 * saiu mandando mensagem para leads de Osasco e Sao Paulo, de uma
 * importacao completamente diferente. O unico aviso era uma frase cinza
 * na tela de filtros, que ninguem le antes de clicar em Ativar.
 *
 * Cidade e categoria NAO contam como restricao aqui, de proposito. Elas
 * refinam DENTRO do publico; nao dizem de qual planilha ele sai. Uma
 * campanha filtrada por "Alfenas" ainda pega leads de Alfenas de
 * qualquer importacao que voce ja tenha feito.
 */
export function restringeAPlanilha(filtros: {
  captureSessionIds?: string[];
  importIds?: string[];
}): boolean {
  return (
    (filtros.captureSessionIds?.length ?? 0) > 0 ||
    (filtros.importIds?.length ?? 0) > 0
  );
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

/**
 * Onde os leads se perderam entre a planilha e a campanha.
 *
 * ============================================================
 * UM ZERO SEM EXPLICACAO E UM BUG DE PRODUTO
 * ============================================================
 * A tela mostrava "0 leads" e parava por ai. O zero pode vir de quatro
 * lugares diferentes — opt-out, falta de telefone, ja contatado, ou a
 * planilha errada — e nenhum deles aparecia. Sem isso, ajustar o publico
 * vira tentativa e erro: foi exatamente o que fez os filtros antigos
 * serem removidos, e o problema nao era dos filtros.
 *
 * O funil e cumulativo e na ordem em que o `montarWhere` aplica. Cada
 * numero e "quantos sobraram DEPOIS deste corte", e nao "quantos este
 * corte pegou" — assim a soma nunca mente quando um lead cai por dois
 * motivos ao mesmo tempo.
 */
export interface ExplicacaoContagem {
  /** Na planilha escolhida (ou no CRM inteiro, se nao houver planilha). */
  naPlanilha: number;
  /** Sobraram depois de tirar opt-out e quem aguarda intervencao. */
  aposExclusoesFixas: number;
  /** Sobraram depois de exigir telefone. */
  aposTelefone: number;
  /** O numero final — o mesmo que `total`. */
  total: number;
}

export async function explicarContagem(
  filtros: FiltrosCampanha
): Promise<ExplicacaoContagem> {
  // So o recorte de lote, sem nenhum corte. E o "de quantos partimos".
  const lotes: Prisma.LeadWhereInput[] = [];
  if (filtros.captureSessionIds?.length) {
    lotes.push({ captureSessionId: { in: filtros.captureSessionIds } });
  }
  if (filtros.importIds?.length) {
    lotes.push({ importId: { in: filtros.importIds } });
  }
  const soLote: Prisma.LeadWhereInput = lotes.length > 0 ? { OR: lotes } : {};

  const fixas: Prisma.LeadWhereInput = {
    AND: [
      soLote,
      { optOut: false },
      { status: { notIn: ['OPT_OUT', 'AGUARDANDO_INTERVENCAO'] } },
    ],
  };

  const comTelefone: Prisma.LeadWhereInput = {
    AND: [fixas, { telefoneNormalizado: { not: null } }],
  };

  const [naPlanilha, aposExclusoesFixas, aposTelefone, total] = await Promise.all([
    prisma.lead.count({ where: soLote }),
    prisma.lead.count({ where: fixas }),
    prisma.lead.count({ where: comTelefone }),
    prisma.lead.count({ where: montarWhere(filtros) }),
  ]);

  return { naPlanilha, aposExclusoesFixas, aposTelefone, total };
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
 * Reexportada por compatibilidade: a implementacao mudou de lugar.
 *
 * Ela mora no dominio agora porque o worker tambem precisa dela — o
 * avanco de etapa disparado por uma resposta cria mensagem para o mesmo
 * par lead+etapa. Duas copias da funcao divergiriam no primeiro ajuste,
 * e a constraint UNIQUE deixaria de colidir: o lead receberia a mesma
 * mensagem duas vezes.
 */
export { chaveIdempotencia };

export interface ResultadoEnfileiramento {
  criadas: number;
  /**
   * Linhas que ja existiam e foram ATUALIZADAS: texto re-renderizado,
   * horario recalculado, modo de envio herdado da campanha de novo.
   *
   * Separado de `criadas` porque a diferenca importa na tela. "1 criada"
   * quando nada foi criado e impreciso; "1 ja existia" quando a mensagem
   * mudou de modo de envio e pior — foi assim que um usuario ficou preso
   * numa fila em dry-run achando que o reenfileiramento nao fazia nada.
   */
  atualizadas: number;
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
  opcoes: {
    agora?: Date;
    limite?: number;
    /**
     * Enfileira APENAS estes leads, ignorando o limite.
     *
     * E o que permite "mandar para estes cinco, que eu escolhi na
     * previa" em vez de "os cinco primeiros que o filtro devolver".
     * A diferenca importa no primeiro envio real: voce quer escolher
     * quem recebe, nao aceitar quem a ordenacao entregou.
     *
     * Os filtros da campanha CONTINUAM valendo por cima: um lead em
     * opt-out selecionado a mao segue bloqueado. A selecao restringe,
     * nunca libera.
     */
    leadIds?: string[];
  } = {}
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
    criadas: 0, atualizadas: 0, bloqueadas: 0, jaExistiam: 0, detalhes: [],
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

  const selecionados = opcoes.leadIds?.length ? opcoes.leadIds : null;

  const leads = await prisma.lead.findMany({
    where: selecionados
      // A selecao entra em AND com os filtros: escolher um lead a mao
      // nao contorna opt-out, telefone ausente nem lote. Selecao
      // restringe; nunca libera.
      ? { AND: [montarWhere(filtros), { id: { in: selecionados } }] }
      : montarWhere(filtros),
    select: { ...SELECAO_LEAD, _count: { select: { messages: true } } },
    orderBy: { createdAt: 'desc' },
    // Com selecao explicita o limite nao se aplica: voce ja disse
    // exatamente quantos quer, e cortar em silencio deixaria alguem de
    // fora sem avisar.
    ...(selecionados ? {} : { take: limite }),
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
          // Herdado da campanha, e nao fixo em `true`.
          //
          // Fixo, a barreira #4 nunca caia: mesmo com a trava de fase
          // aberta, o modo global em `live` e a campanha liberada, toda
          // mensagem nascia simulada e nada saia. Era uma quinta trava
          // escondida — pior do que uma trava a mais, porque ninguem
          // sabia dela.
          //
          // Congelado no enfileiramento de proposito: liberar a campanha
          // depois NAO transforma em envio real o que ja esta na fila.
          // Quem quiser isso reenfileira, e a decisao fica explicita.
          dryRun: campanha.dryRun,
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
        // --- Ja existe uma mensagem para este lead nesta etapa ---
        //
        // "Ja existe" nao quer dizer "nao ha o que fazer". Pausar uma
        // campanha CANCELA a fila (e certo: pausa que nao para nada seria
        // enfeite), e uma mensagem bloqueada por telefone ausente pode
        // ter sido corrigida desde entao.
        //
        // Sem reviver, uma campanha pausada nunca mais voltava a rodar:
        // reenfileirar batia na chave de idempotencia e respondia "ja
        // existiam" para tudo. Nao havia saida pela interface.
        //
        // O UPDATE e CONDICIONAL nos status que ainda nao sairam. Reviver
        // uma ENVIADA ou SIMULADA seria mandar de novo para quem ja
        // recebeu — o unico erro que este arquivo inteiro existe para
        // evitar. O banco garante isso no `where`, nao a aplicacao.
        //
        // ============================================================
        // PENDENTE E AGENDADA TAMBEM ENTRAM NA LISTA
        // ============================================================
        // Antes so CANCELADA e BLOQUEADA eram revividas, e isso criava um
        // beco sem saida com nome e sobrenome:
        //
        //   1. voce cria a campanha (ela nasce em simulacao, sempre);
        //   2. enfileira o lead -> a mensagem nasce dryRun: true;
        //   3. percebe, vai em Configuracoes e DESLIGA a simulacao;
        //   4. reenfileira... e nada muda.
        //
        // A mensagem estava AGENDADA, fora da lista, e o reenfileiramento
        // respondia "ja existia" sem tocar nela. A campanha aparecia
        // liberada na tela e a fila continuava com o selo Dry-run, para
        // sempre, sem nenhuma saida pela interface.
        //
        // AGENDADA e PENDENTE nao sairam para lugar nenhum: atualizar e
        // seguro. ENVIADA, SIMULADA e PROCESSANDO continuam intocaveis.
        const revividas = await prisma.outboundMessage.updateMany({
          where: {
            idempotencyKey,
            status: { in: ['CANCELADA', 'BLOQUEADA', 'PENDENTE', 'AGENDADA'] },
          },
          data: {
            status: motivoBloqueio ? 'BLOQUEADA' : 'AGENDADA',
            motivoBloqueio,
            detalheBloqueio: detalhe,
            telefoneDestino: lead.telefoneNormalizado,
            // Recalculados agora: o texto pode ter mudado e o horario
            // antigo ja passou.
            textoRenderizado,
            textoTemplate: template,
            variaveisUsadas: variaveis as Prisma.InputJsonValue,
            scheduledAt,
            // ============================================================
            // O CAMPO QUE FALTAVA
            // ============================================================
            // Sem esta linha, uma mensagem revivida guardava para sempre o
            // modo com que nasceu. Liberar a campanha e reenfileirar era o
            // caminho que a propria tela recomenda ("as mensagens ja na
            // fila mantem o modo com que nasceram") — e ele nao levava a
            // lugar nenhum.
            //
            // Herda da campanha, como na criacao. A barreira #4 continua
            // existindo: ela so passou a refletir a decisao ATUAL em vez
            // de uma decisao congelada que ninguem conseguia mudar.
            dryRun: campanha.dryRun,
            erro: null,
            processedAt: null,
            tentativas: 0,
          },
        });

        if (revividas.count > 0) {
          if (motivoBloqueio) {
            resultado.bloqueadas++;
            resultado.detalhes.push({
              leadId: lead.id, empresa: lead.empresa ?? lead.nomeCompleto,
              resultado: 'BLOQUEADA', motivo: detalhe,
            });
          } else {
            resultado.atualizadas++;
            resultado.detalhes.push({
              leadId: lead.id, empresa: lead.empresa ?? lead.nomeCompleto,
              resultado: 'CRIADA',
              motivo: 'Reenfileirada: texto, horario e modo de envio atualizados',
            });
          }
          continue;
        }

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
