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
  /** O que o usuario precisa fazer. Ex: "CRIAR PREVIEW" */
  acaoNecessaria: string;
  ultimaMensagem: string | null;
  etapaAtual: string | null;
  em: string;
}

export interface FunilEtapa {
  rotulo: string;
  total: number;
}

export interface DashboardResponse {
  metricas: DashboardMetricas;
  atencao: ItemAtencao[];
  funil: FunilEtapa[];
  campanhaAtiva: CampanhaAtivaResumo | null;
  whatsapp: {
    status: string;
    modo: string;
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
};
