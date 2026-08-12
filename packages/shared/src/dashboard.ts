/**
 * Contrato do dashboard — usado pela API e pelo frontend.
 *
 * Na Fase 1 a API responde com tudo zerado. A logica de agregacao real
 * entra na Fase 9, mas o formato ja esta congelado aqui para o frontend
 * nao precisar mudar depois.
 */

/** As 12 metricas dos cards. */
export interface DashboardMetricas {
  totalLeads: number;
  totalImportados: number;
  totalProspectados: number;
  semSite: number;
  aguardandoResposta: number;
  mensagensEnviadas: number;
  respostasRecebidas: number;
  frios: number;
  mornos: number;
  quentes: number;
  optOuts: number;
  clientes: number;
  tarefasPendentes: number;
}

/** Motivo pelo qual um item aparece em "PRECISA DA SUA ATENCAO". */
export type MotivoAtencao =
  | 'LEAD_QUENTE'
  | 'RESPOSTA_DESCONHECIDA'
  | 'PEDIDO_PREVIEW'
  | 'PEDIDO_PRECO'
  | 'AGUARDANDO_INTERVENCAO'
  | 'TAREFA_ATRASADA';

/**
 * Ordem de exibicao da secao "PRECISA DA SUA ATENCAO".
 * Menor numero = aparece primeiro.
 */
export const PRIORIDADE_ATENCAO: Record<MotivoAtencao, number> = {
  LEAD_QUENTE: 1,
  RESPOSTA_DESCONHECIDA: 2,
  PEDIDO_PREVIEW: 3,
  PEDIDO_PRECO: 4,
  AGUARDANDO_INTERVENCAO: 5,
  TAREFA_ATRASADA: 6,
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
  aguardandoResposta: 0,
  mensagensEnviadas: 0,
  respostasRecebidas: 0,
  frios: 0,
  mornos: 0,
  quentes: 0,
  optOuts: 0,
  clientes: 0,
  tarefasPendentes: 0,
};
