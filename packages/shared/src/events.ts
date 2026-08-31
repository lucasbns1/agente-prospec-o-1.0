/**
 * Eventos de tempo real transmitidos por SSE (Server-Sent Events).
 *
 * POR QUE SSE E NAO WEBSOCKET:
 * O trafego e praticamente todo no sentido servidor -> cliente (chegou
 * resposta, lead esquentou, tarefa criada). SSE e HTTP puro, reconecta
 * sozinho por comportamento nativo do navegador e nao exige biblioteca
 * nenhuma dos dois lados. WebSocket so se justificaria com trafego
 * bidirecional intenso, que este sistema nao tem.
 *
 * O cliente escuta um unico endpoint (`GET /api/events`) e usa o campo
 * `tipo` para decidir quais queries do TanStack Query invalidar.
 */

export const EVENT_TYPES = [
  'lead.criado',
  'lead.atualizado',
  'lead.temperatura_alterada',
  'lead.status_alterado',
  /// O evento de MAIOR prioridade do sistema: uma resposta nao foi
  /// reconhecida e a automacao parou esperando voce.
  'lead.intervencao_necessaria',
  'lead.opt_out',
  'mensagem.enviada',
  'mensagem.simulada',
  'mensagem.recebida',
  'mensagem.falhou',
  'campanha.iniciada',
  'campanha.pausada',
  'campanha.concluida',
  'tarefa.criada',
  'tarefa.concluida',
  'notificacao.criada',
  'importacao.progresso',
  'importacao.concluida',
  'whatsapp.status',
  /**
   * Uma varredura do WhatsApp terminou.
   *
   * Carrega o relatorio dela (`ResultadoRecuperacao` sem as datas), e e
   * o que faz a faixa "WhatsApp sincronizado ha X min" se atualizar
   * sozinha. Sem ele a tela so descobriria a varredura no proximo
   * intervalo de sondagem — e "buscar o que faltou" pareceria nao ter
   * feito nada por meio minuto.
   */
  'sincronizacao.atualizada',
  'dashboard.atualizar',
  'heartbeat',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface AppEvent<T = unknown> {
  tipo: EventType;
  /** ISO 8601 */
  em: string;
  dados?: T;
}

export interface LeadTemperaturaEvent {
  leadId: string;
  nome: string | null;
  de: string;
  para: string;
  motivo?: string;
}

export interface WhatsAppStatusEvent {
  status: string;
  detalhe?: string;
  /** Data URL do QR Code, quando status === AGUARDANDO_QR. */
  qr?: string;
}

export interface NotificacaoEvent {
  id: string;
  tipo: string;
  nivel: string;
  titulo: string;
  mensagem: string;
  link?: string | null;
  prioridade: number;
}

/**
 * Emitido quando o motor de regras NAO reconhece uma resposta.
 *
 * A automacao para nesse ponto. O sistema nao tenta adivinhar, nao envia
 * a proxima mensagem e nao responde nada — apenas avisa voce.
 */
export interface IntervencaoEvent {
  leadId: string;
  nome: string | null;
  /// A mensagem do lead que o sistema nao soube classificar.
  textoRecebido: string;
  etapaAtual: string | null;
  campanha: string | null;
  em: string;
}
