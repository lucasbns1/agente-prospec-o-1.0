/**
 * WhatsAppAdapter — a fronteira entre o sistema e o WhatsApp.
 *
 * REGRA ARQUITETURAL CENTRAL: `whatsapp-web.js` so pode ser importado
 * dentro de `whatsapp-web-adapter.ts`. Nenhum outro arquivo do projeto —
 * nem API, nem worker, nem domain — conhece essa biblioteca.
 *
 * POR QUE ISSO IMPORTA AQUI ESPECIFICAMENTE:
 * O whatsapp-web.js e uma biblioteca nao-oficial que automatiza o
 * WhatsApp Web por baixo dos panos. Atualizacoes do WhatsApp quebram ela
 * periodicamente. Quando isso acontecer, o conserto precisa caber em um
 * arquivo — e nao virar uma caca a chamadas espalhadas pelo sistema
 * inteiro. O mesmo isolamento permite trocar por outra tecnologia depois
 * sem reescrever CRM, campanhas e regras.
 */
import type { WhatsAppStatus, WhatsAppMode } from '@prospector/shared';

export interface MensagemRecebida {
  /** ID unico da mensagem no WhatsApp. Usado para nao processar 2x. */
  id: string;
  /** Chat de origem, ex: "5519999998888@c.us". */
  chatId: string;
  /** Telefone em E.164 sem "+", extraido do chatId. */
  telefone: string;
  texto: string;
  /** Nome que o contato usa no WhatsApp, quando disponivel. */
  nomeContato: string | null;
  timestamp: Date;
  /** true quando a mensagem foi enviada por nos (eco do proprio envio). */
  deMim: boolean;
}

export interface ResultadoEnvio {
  sucesso: boolean;
  /** ID atribuido pelo WhatsApp. Null em dry-run ou em falha. */
  whatsappMessageId: string | null;
  /** true quando o envio foi apenas simulado (dry-run). */
  simulado: boolean;
  erro?: string;
}

export interface StatusConexao {
  status: WhatsAppStatus;
  modo: WhatsAppMode;
  /** Data URL do QR Code, presente apenas em AGUARDANDO_QR. */
  qr?: string;
  /** Telefone da conta conectada. */
  telefone?: string;
  detalhe?: string;
}

export interface ContatoWhatsApp {
  id: string;
  telefone: string;
  nome: string | null;
}

export interface WhatsAppAdapterEvents {
  onReady: (handler: (status: StatusConexao) => void) => void;
  onQr: (handler: (qrDataUrl: string) => void) => void;
  onMessage: (handler: (msg: MensagemRecebida) => void | Promise<void>) => void;
  onDisconnected: (handler: (motivo: string) => void) => void;
  onStatusChange: (handler: (status: StatusConexao) => void) => void;
}

export interface WhatsAppAdapter extends WhatsAppAdapterEvents {
  readonly modo: WhatsAppMode;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): StatusConexao;

  /**
   * Envia uma mensagem.
   *
   * IMPORTANTE: este metodo NAO faz controle de idempotencia. Quem chama
   * (o worker) e responsavel por gravar a `idempotencyKey` no banco ANTES
   * de chamar aqui. O adapter so transporta.
   *
   * @param telefone E.164 sem "+", ex: "5519999998888"
   */
  sendMessage(telefone: string, texto: string): Promise<ResultadoEnvio>;

  /** Verifica se o numero existe no WhatsApp antes de tentar enviar. */
  isRegistered(telefone: string): Promise<boolean>;

  getContacts(): Promise<ContatoWhatsApp[]>;
}

/** Converte "5519999998888" -> "5519999998888@c.us". */
export function telefoneParaChatId(telefone: string): string {
  const limpo = telefone.replace(/\D/g, '');
  return `${limpo}@c.us`;
}

/** Converte "5519999998888@c.us" -> "5519999998888". */
export function chatIdParaTelefone(chatId: string): string {
  return chatId.split('@')[0]?.replace(/\D/g, '') ?? '';
}
