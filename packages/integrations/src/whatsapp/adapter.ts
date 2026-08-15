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
import type { MensagemEntrada } from './eventos-canal.js';

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

  /**
   * Respostas recebidas desde `desde`, lidas das conversas.
   *
   * ============================================================
   * POR QUE O `onMessage` NAO BASTA
   * ============================================================
   * O evento so existe AO VIVO. Worker fora do ar no instante em que o
   * lead responde — reinicio, queda do Chromium, computador dormindo — e
   * aquele evento nunca e reentregue.
   *
   * Aconteceu na validacao real: a mensagem 1 saiu 01:18:48, o lead
   * respondeu 01:18, o worker estava reiniciando naquele instante. A
   * resposta apareceu no WhatsApp e NUNCA entrou no sistema — nem como
   * contato desconhecido. A sequencia morreu ali, sem erro em lugar
   * nenhum.
   *
   * Devolve no MESMO formato do `onMessage`, com o telefone ja
   * resolvido, para quem chama nao precisar saber por onde a mensagem
   * chegou. A idempotencia por `provider_message_id` torna o replay
   * seguro.
   */
  mensagensPerdidas(desde: Date): Promise<MensagemEntrada[]>;

  /**
   * O envio saiu mesmo? Confere na conversa.
   *
   * ============================================================
   * POR QUE PERGUNTAR EM VEZ DE SUPOR
   * ============================================================
   * `sendMessage` as vezes entrega a mensagem e nunca resolve a
   * promessa. Ate agora a unica saida era supor, e o sistema escolhia o
   * caminho conservador: marcar FALHOU dizendo "PODE ter saido".
   *
   * So que ela tinha saido — sempre. Visto em uso real tres vezes
   * seguidas: mensagem entregue no celular do lead as 12:47, fila
   * marcando "Falhou". A sequencia parava numa falha que nao existia, e
   * a etapa seguinte nunca era agendada.
   *
   * O WhatsApp sabe a resposta: a mensagem esta la na conversa.
   *
   * `null` significa "nao achei OU nao consegui conferir" — nunca "com
   * certeza nao saiu". Quem chama trata isso como incerteza.
   */
  confirmarEnvio(telefone: string, texto: string, desde: Date): Promise<string | null>;
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
