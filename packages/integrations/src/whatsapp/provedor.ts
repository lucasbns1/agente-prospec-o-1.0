/**
 * A superficie minima que o adapter precisa de um provedor de WhatsApp.
 *
 * ============================================================
 * POR QUE ESTA COSTURA EXISTE
 * ============================================================
 * O `whatsapp-web.js` so funciona com um Chromium de verdade aberto e um
 * celular pareado. Sem esta interface, NENHUM teste do adapter seria
 * possivel — nem "o QR expirou", nem "a sessao caiu", nem "chegou a
 * mesma mensagem duas vezes". Ficariam todos dependendo de alguem
 * escanear um QR na mao.
 *
 * Com ela, o adapter e testado inteiro contra um provedor falso que
 * emite exatamente os mesmos eventos, e a biblioteca real fica atras de
 * uma implementacao so.
 *
 * ============================================================
 * ESTA INTERFACE NAO E O ChannelAdapter
 * ============================================================
 * `WhatsAppAdapter` (em adapter.ts) e o contrato que o SISTEMA consome.
 * `ProvedorWhatsApp` e o contrato que o ADAPTER consome. O sistema nunca
 * ve esta interface — ela fala em termos de "cliente do WhatsApp Web",
 * nao em termos de negocio.
 */

export type EventoProvedor =
  | 'qr'
  | 'authenticated'
  | 'auth_failure'
  | 'ready'
  | 'disconnected'
  | 'message'
  | 'message_ack'
  | 'loading_screen'
  | 'change_state';

/** Mensagem crua, no formato que a biblioteca entrega. */
export interface MensagemProvedor {
  id: string;
  /**
   * Endereco da conversa: `...@c.us` (numero) ou `...@lid` (identificador
   * de privacidade). Serve para RESPONDER — nao e telefone.
   */
  from: string;
  /**
   * Telefone de quem enviou, so digitos. `null` quando o provedor nao
   * expos o numero. NUNCA contem o LID: melhor ficar sem numero do que
   * ter um valor que nao e telefone e nao casa com lead nenhum.
   */
  telefone?: string | null;
  /** De qual campo o telefone saiu. Diagnostico, so para o log. */
  fonteTelefone?: string;
  to: string;
  body: string;
  /** Segundos desde a epoca — o formato do whatsapp-web.js. */
  timestamp: number;
  fromMe: boolean;
  type: string;
  hasMedia: boolean;
  notifyName?: string | null;
}

export interface InfoConta {
  /** E.164 sem "+". */
  telefone: string | null;
  nome: string | null;
  plataforma: string | null;
}

export interface ProvedorWhatsApp {
  on(evento: EventoProvedor, handler: (...args: unknown[]) => void): void;
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  /** Dados da conta conectada. `null` antes de ficar pronto. */
  getInfo(): InfoConta | null;
  /**
   * Envia de verdade.
   *
   * O adapter so chega aqui depois de passar pela guarda de fase. Nesta
   * fase, esse caminho e inalcancavel.
   */
  enviar(chatId: string, texto: string): Promise<{ id: string }>;
  numeroExiste(telefone: string): Promise<boolean>;
}

export interface OpcoesProvedor {
  sessionPath: string;
  chromePath?: string;
  logger?: (mensagem: string, dados?: Record<string, unknown>) => void;
}
