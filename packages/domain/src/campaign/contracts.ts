/**
 * CONTRATOS DO MOTOR DE CAMPANHA — implementacao na FASE 7.
 *
 * Esta e a peca que decide O QUE FAZER depois de uma resposta. Ela e uma
 * FUNCAO PURA de proposito: recebe o estado atual e a classificacao,
 * devolve uma lista de efeitos. Quem executa os efeitos (gravar no banco,
 * enfileirar job, enviar mensagem) e o worker — nao este package.
 *
 * Isso torna possivel testar "MSG 2 + resposta positiva deve marcar
 * QUENTE, criar tarefa de preview, notificar e parar" sem banco, sem
 * Redis e sem WhatsApp.
 */
import type {
  RespostaCategoria,
  StepAction,
  Temperatura,
  LeadStatus,
  TaskPriority,
  SnoozeUnidade,
} from '@prospector/shared';

export interface EstadoLeadCampanha {
  leadId: string;
  campaignId: string;
  etapaAtualId: string | null;
  etapaAtualOrdem: number | null;
  totalEtapas: number;
  aguardandoLiberacao: boolean;
  optOut: boolean;
  temperaturaAtual: Temperatura;
}

export interface RegraEtapa {
  categoria: RespostaCategoria;
  acao: StepAction;
  proximaEtapaId: string | null;
  novaTemperatura: Temperatura | null;
  novoStatus: LeadStatus | null;
  criarTarefa: boolean;
  tarefaTitulo: string | null;
  tarefaDescricao: string | null;
  tarefaPrioridade: TaskPriority | null;
  notificar: boolean;
  notificacaoTitulo: string | null;
  notificacaoMensagem: string | null;
  registrarOptOut: boolean;
  snoozeUnidade: SnoozeUnidade | null;
  snoozeValor: number | null;
}

/** Efeitos que o worker deve executar, em ordem. */
export type EfeitoCampanha =
  | { tipo: 'ALTERAR_TEMPERATURA'; de: Temperatura; para: Temperatura; motivo: string }
  | { tipo: 'ALTERAR_STATUS'; para: LeadStatus; motivo: string }
  | { tipo: 'AGENDAR_PROXIMA_MENSAGEM'; etapaId: string; enviarEm: Date }
  | { tipo: 'AGUARDAR_LIBERACAO_MANUAL'; etapaId: string; motivo: string }
  | { tipo: 'PARAR_CAMPANHA'; motivo: string }
  | { tipo: 'AGENDAR_SNOOZE'; retomarEm: Date }
  | { tipo: 'REGISTRAR_OPT_OUT' }
  | {
      tipo: 'CRIAR_TAREFA';
      titulo: string;
      descricao: string | null;
      prioridade: TaskPriority;
      tarefaTipo: string;
    }
  | {
      tipo: 'CRIAR_NOTIFICACAO';
      titulo: string;
      mensagem: string;
      notificacaoTipo: string;
      nivel: string;
    }
  | { tipo: 'REGISTRAR_EVENTO'; eventoTipo: string; descricao: string; dados?: unknown };

export interface ResultadoAvanco {
  efeitos: EfeitoCampanha[];
  /** Resumo legivel do que sera feito — vai para o log e para o historico. */
  resumo: string;
}

/**
 * Decide os efeitos a partir de uma resposta classificada.
 *
 * INVARIANTES que a implementacao precisa garantir (e que os testes da
 * Fase 6/7 vao cobrir):
 *
 *  1. Categoria DESCONHECIDO NUNCA gera AGENDAR_PROXIMA_MENSAGEM.
 *     Sempre AGUARDAR_LIBERACAO_MANUAL + CRIAR_TAREFA + CRIAR_NOTIFICACAO.
 *  2. Lead com optOut === true NUNCA gera efeito de envio.
 *  3. AVANCAR na ultima etapa vira PARAR, nao estouro de indice.
 *  4. Toda mudanca de temperatura emite REGISTRAR_EVENTO junto — o
 *     historico e obrigatorio (requisito 11 e 27).
 *  5. A temperatura pode SUBIR ou DESCER. Nada impede QUENTE -> MORNO.
 */
export type DecidirAvanco = (
  estado: EstadoLeadCampanha,
  categoria: RespostaCategoria,
  regra: RegraEtapa | null,
  opcoes: {
    agora: Date;
    delayMinSegundos: number;
    delayMaxSegundos: number;
    acaoPadraoDesconhecido: StepAction;
    proximaEtapaId: string | null;
  }
) => ResultadoAvanco;
