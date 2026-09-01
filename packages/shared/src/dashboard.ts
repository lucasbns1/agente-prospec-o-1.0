/**
 * Contrato do dashboard — usado pela API e pelo frontend.
 *
 * Na Fase 1 a API responde com tudo zerado. A logica de agregacao real
 * entra na Fase 9, mas o formato ja esta congelado aqui para o frontend
 * nao precisar mudar depois.
 */

/** Metricas dos cards do dashboard (requisito 17). */
export interface DashboardMetricas {
  totalLeads: number;
  totalImportados: number;
  totalProspectados: number;
  semSite: number;
  comSite: number;
  aguardandoResposta: number;
  emConversa: number;
  intervencoesPendentes: number;
  interessados: number;
  negativos: number;
  mensagensEnviadas: number;
  mensagensRecebidas: number;
  errosEnvio: number;
  frios: number;
  mornos: number;
  quentes: number;
  optOuts: number;
  clientes: number;
  tarefasPendentes: number;
  agendados: number;
  leadsHoje: number;
}

export interface CampanhaAtivaResumo {
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

/** Motivo pelo qual um item aparece em "PRECISA DA SUA ATENCAO". */
export type MotivoAtencao =
  | 'INTERVENCAO_NECESSARIA'
  | 'LEAD_QUENTE'
  | 'PEDIDO_PREVIEW'
  | 'PEDIDO_PRECO'
  | 'TAREFA_ATRASADA'
  | 'ERRO_ENVIO';

/**
 * Ordem de exibicao da secao "PRECISA DA SUA ATENCAO".
 * Menor numero = aparece primeiro.
 *
 * INTERVENCAO_NECESSARIA e o numero 1 por decisao de produto (requisito
 * 16): uma conversa parada porque o sistema nao entendeu a resposta e a
 * unica situacao em que o lead esta esperando e ninguem esta respondendo.
 */
export const PRIORIDADE_ATENCAO: Record<MotivoAtencao, number> = {
  INTERVENCAO_NECESSARIA: 1,
  LEAD_QUENTE: 2,
  PEDIDO_PREVIEW: 3,
  PEDIDO_PRECO: 4,
  TAREFA_ATRASADA: 5,
  ERRO_ENVIO: 6,
};

/** Mesma escala usada em `Notification.prioridade`. */
export const PRIORIDADE_NOTIFICACAO: Record<string, number> = {
  INTERVENCAO_NECESSARIA: 1,
  LEAD_QUENTE: 2,
  PEDIDO_PREVIEW: 3,
  PEDIDO_PRECO: 4,
  OPT_OUT: 10,
  ENVIO_FALHOU: 10,
  RESPOSTA_RECEBIDA: 20,
  WHATSAPP_DESCONECTADO: 20,
  LIMITE_DIARIO_ATINGIDO: 30,
  SISTEMA: 50,
};

export interface ItemAtencao {
  leadId: string;
  nome: string | null;
  categoria: string | null;
  bairro: string | null;
  cidade: string | null;
  temperatura: string;
  status: string;
  motivo: MotivoAtencao;
  /** O que o usuario precisa fazer. Ex: "Criar o preview" */
  acaoNecessaria: string;
  ultimaMensagem: string | null;
  etapaAtual: string | null;
  em: string;
  /**
   * Quantos motivos este lead acumula.
   *
   * Ele aparece UMA vez, com o motivo mais urgente. Este contador evita
   * que os outros motivos sumam sem deixar rastro.
   */
  totalMotivos: number;
}

export interface FunilEtapa {
  rotulo: string;
  total: number;
}

/**
 * Quantos leads pararam em cada etapa da cadencia.
 *
 * Pedido: "coloque também: clientes etapa tal / clientes etapa tal".
 *
 * "Esta na etapa N" e a MAIOR etapa que saiu para aquele lead — a mesma
 * regra de "nao responderam" e do relatorio semanal. Tres telas contando
 * a mesma coisa de tres jeitos seria pior do que nao ter as tres.
 */
export interface EtapaComLeads {
  ordem: number;
  /** Nome da etapa, ou "Mensagem N" quando ela nao tem um. */
  rotulo: string;
  leads: number;
}

/**
 * A prospeccao separada por nicho.
 *
 * Pedido: "quero que tenha um total — todos os nichos mandados — e as
 * informacoes de quantos mandaram e etc de cada nicho tambem".
 *
 * O nicho existia no banco desde a importacao e nao aparecia em tela
 * nenhuma. Todo numero do painel era a soma de tudo, e a soma de tudo
 * esconde a decisao que a semana seguinte pede: qual lista continuar.
 */
export interface ResumoDoNicho {
  nicho: string;
  /** Leads que existem neste nicho, abordados ou nao. */
  leads: number;
  /** Destes, quantos receberam ao menos uma mensagem. */
  abordados: number;
  /** Ainda nao abordados. */
  naFila: number;
  /** Mensagens que sairam. Um lead com 3 etapas conta 3. */
  enviadas: number;
  responderam: number;
  semResposta: number;
  /** 0 a 100. `null` quando ninguem foi abordado. */
  taxaResposta: number | null;
  quentes: number;
  clientes: number;
  optOuts: number;
}

export interface ResumoPorNicho {
  /** Todos os leads de uma vez — calculado por fora, nao somando. */
  total: ResumoDoNicho;
  /** Do maior volume de envios para o menor. */
  nichos: ResumoDoNicho[];
}

export interface DashboardResponse {
  metricas: DashboardMetricas;
  atencao: ItemAtencao[];
  funil: FunilEtapa[];
  /** Em ordem crescente de etapa. Etapas vazias nao aparecem. */
  porEtapa: EtapaComLeads[];
  campanhaAtiva: CampanhaAtivaResumo | null;
  whatsapp: {
    status: string;
  };
}

export const METRICAS_ZERADAS: DashboardMetricas = {
  totalLeads: 0,
  totalImportados: 0,
  totalProspectados: 0,
  semSite: 0,
  comSite: 0,
  aguardandoResposta: 0,
  emConversa: 0,
  intervencoesPendentes: 0,
  interessados: 0,
  negativos: 0,
  mensagensEnviadas: 0,
  mensagensRecebidas: 0,
  errosEnvio: 0,
  frios: 0,
  mornos: 0,
  quentes: 0,
  optOuts: 0,
  clientes: 0,
  tarefasPendentes: 0,
  agendados: 0,
  leadsHoje: 0,
};


// ---------------------------------------------------------------------------
// QUEM RECEBEU E NAO RESPONDEU
//
// O contrato mora aqui, e nao no dominio, porque o frontend precisa
// dele: `apps/web` depende de `shared` e nao de `domain`. Mesmo arranjo
// do `ItemAtencao`.
// ---------------------------------------------------------------------------

export interface LeadSemResposta {
  leadId: string;
  nome: string | null;
  categoria: string | null;
  bairro: string | null;
  cidade: string | null;
  temperatura: string;
  status: string;
  /** A ultima etapa que chegou nele. */
  ordem: number;
  etapaNome: string | null;
  /** Quando aquela etapa saiu — ha quanto tempo ele esta calado. */
  desde: Date;
}

export interface GrupoSemResposta {
  ordem: number;
  /** Nome da etapa, ou "Mensagem N" quando ela nao tem um. */
  rotulo: string;
  /**
   * O total de VERDADE, mesmo quando `leads` vem cortado. Um contador
   * que encolhe junto com a pagina mente sobre o tamanho do problema.
   */
  total: number;
  leads: LeadSemResposta[];
}


// ---------------------------------------------------------------------------
// O RELATORIO DA SEMANA
//
// Mesmo arranjo do `ItemAtencao`: o contrato mora aqui porque a tela
// precisa dele. A CONTA mora em `@prospector/domain`, em
// `montarRelatorioSemana`, que e pura e testavel sem banco.
// ---------------------------------------------------------------------------

export interface DiaDaSemana {
  /** ISO da meia-noite daquele dia. */
  dia: string;
  enviadas: number;
}

export interface FunilSemana {
  /** Leads distintos que receberam ao menos uma mensagem na semana. */
  abordados: number;
  /** Destes, quantos nao disseram nada ate agora. */
  semResposta: number;
  /** Destes, quantos responderam qualquer coisa. */
  responderam: number;
  /** Disseram nao, sem interesse, ou pediram para parar. */
  negativos: number;
  /** Demonstraram interesse ou aceitaram. */
  interessados: number;
  /** Perguntaram preco. */
  perguntaramPreco: number;
  /** Receberam a etapa da previa — ou seja, voce chegou a mandar. */
  receberamPrevia: number;
  /** Viraram cliente. */
  fecharam: number;
  /**
   * Responderam algo que o sistema NAO entendeu. Nao e uma categoria de
   * interesse: e a medida de quanto o dicionario esta cego, e o alvo da
   * releitura pela IA.
   */
  naoEntendidas: number;
}

export interface TravaEtapa {
  ordem: number;
  rotulo: string;
  /** Leads cuja conversa parou nesta etapa. */
  leads: number;
}

export interface ResumoNicho {
  nicho: string;
  enviadas: number;
  funil: FunilSemana;
}

export interface RelatorioSemana {
  /** ISO do domingo 00:00 em que a semana comeca. */
  inicio: string;
  /** ISO do domingo 00:00 seguinte, exclusivo. */
  fim: string;
  enviadas: number;
  porDia: DiaDaSemana[];
  funil: FunilSemana;
  porNicho: ResumoNicho[];
  travou: TravaEtapa[];
}


// ---------------------------------------------------------------------------
// O RESUMO DE UM DIA
//
// A semana responde "a abordagem funciona?". O dia responde "o que saiu
// na terca, e o que voltou?" — a pergunta que voce faz quando um numero
// da semana parece errado.
//
// NAO ha "taxa de resposta do dia" aqui, de proposito: a resposta que
// chega hoje quase sempre e sobre uma mensagem de ontem, entao
// respostas-de-hoje / envios-de-hoje seria um numero sem significado.
// ---------------------------------------------------------------------------

/** Uma mensagem que saiu naquele dia. */
export interface EnvioDoDia {
  leadId: string;
  nome: string | null;
  nicho: string | null;
  ordem: number;
  etapaNome: string | null;
  quando: Date;
}

/** Uma resposta que chegou naquele dia. */
export interface RespostaDoDia {
  leadId: string;
  nome: string | null;
  texto: string;
  /** `null` quando a confianca ficou abaixo do piso. */
  categoria: string | null;
  confianca: number;
  quando: Date;
}

export interface ResumoDoDia {
  /** ISO da meia-noite local daquele dia. */
  dia: string;
  /** Mensagens que sairam. Um lead com 2 etapas no dia conta 2. */
  enviadas: number;
  /** Pessoas distintas que receberam alguma coisa. */
  pessoasAbordadas: number;
  /** Respostas que chegaram — de qualquer abordagem, nao so a de hoje. */
  respostas: number;
  porNicho: { nicho: string; enviadas: number }[];
  porEtapa: { ordem: number; rotulo: string; enviadas: number }[];
  /** A linha do tempo do dia, mais antigo primeiro. */
  envios: EnvioDoDia[];
  listaRespostas: RespostaDoDia[];
}


// ---------------------------------------------------------------------------
// A FICHA DO DIA, POR NICHO
//
// O pedido, literal:
//   DIA / NICHO / Mandei / Responderam: abordagem / follow up 1 /
//   follow up 2 / Pediram previa / Perguntaram preco / Fecharam /
//   Objecao mais comum.
//
// O dia aqui e O DIA EM QUE VOCE MANDOU: o recorte e a turma de quem
// recebeu alguma coisa naquele dia, e tudo o mais e sobre essas pessoas
// em qualquer data posterior.
// ---------------------------------------------------------------------------

export interface RespostaPorEtapa {
  ordem: number;
  /** "Abordagem", "Follow up 1"… ou o nome que a etapa tiver. */
  rotulo: string;
  /** PESSOAS, e nao mensagens. */
  leads: number;
}

/**
 * Quantas pessoas ANDARAM alem de uma etapa.
 *
 * ============================================================
 * NAO E A MESMA COISA QUE "RESPONDERAM"
 * ============================================================
 * Responder a MSG 2 e um ato do lead. Passar da MSG 2 e um fato da
 * sequencia: aquela pessoa recebeu a MSG 3, entao a 2 nao foi o fim da
 * linha para ela.
 *
 * Os dois numeros divergem nos dois sentidos, e e por isso que ambos
 * existem. Uma etapa que anda pelo relogio faz gente PASSAR sem ter
 * RESPONDIDO; uma etapa que espera resposta faz gente RESPONDER e ainda
 * assim nao passar, porque voce assumiu a conversa antes.
 */
export interface PassouDaEtapa {
  ordem: number;
  /** "MSG 1", "MSG 2"… ou o nome que a etapa tiver. */
  rotulo: string;
  /** PESSOAS que receberam alguma etapa POSTERIOR a esta. */
  leads: number;
}

export interface FichaDoNicho {
  nicho: string;
  /**
   * Pais dos leads deste cartao, quando todos concordam.
   *
   * `null` quando o cartao mistura paises — dizer "Brasil" para um
   * grupo que tem portugueses dentro seria pior do que nao dizer nada.
   */
  pais: string | null;
  /** Mensagens que sairam naquele dia. */
  mandei: number;
  /** Pessoas distintas que receberam alguma coisa. */
  pessoas: number;
  /** Destas, quantas responderam qualquer coisa. */
  responderam: number;
  /** A qual etapa cada uma respondeu. */
  responderamPorEtapa: RespostaPorEtapa[];
  /** Quantas andaram alem de cada etapa. Ver `PassouDaEtapa`. */
  passaramDaEtapa: PassouDaEtapa[];
  /**
   * Quantas PEDIRAM a previa.
   *
   * ATENCAO ao rotulo na tela: isto e quem pediu, e NAO quem abriu. O
   * sistema nao tem como saber se o site foi visto — para isso a
   * mensagem precisaria levar um link rastreado, que ainda nao existe.
   * Chamar isto de "viram o site" seria inventar um numero.
   *
   * So a IA produz este sinal — fica em zero com o Gemini desligado.
   */
  pediramPrevia: number;
  perguntaramPreco: number;
  fecharam: number;
  /** A objecao mais repetida, ou `null` quando nao ha nenhuma. */
  objecaoMaisComum: { texto: string; vezes: number } | null;
  /** Todas as objecoes, da mais comum para a menos. */
  objecoes: { texto: string; vezes: number }[];
}

export interface FichaDoDia {
  /** ISO da meia-noite local. */
  dia: string;
  /** Todos os leads de uma vez — calculado por fora, nao somando. */
  total: FichaDoNicho;
  /** Do maior volume enviado para o menor. */
  nichos: FichaDoNicho[];
}
