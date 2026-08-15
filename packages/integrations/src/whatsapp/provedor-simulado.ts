/**
 * Provedor simulado — o WhatsApp Web sem WhatsApp e sem navegador.
 *
 * ============================================================
 * PARA QUE SERVE
 * ============================================================
 * Emite exatamente os mesmos eventos que o `whatsapp-web.js`, na mesma
 * ordem, com os mesmos formatos. Isso torna testavel tudo que so
 * aconteceria com um celular pareado: QR expirando, autenticacao
 * falhando, sessao caindo, mensagem duplicada chegando duas vezes,
 * reconexao depois de queda.
 *
 * NAO e um mock de teste no sentido de "objeto vazio que finge". Ele
 * roda a mesma maquina de estados do provedor real. Se o adapter estiver
 * errado, ele quebra aqui.
 *
 * ============================================================
 * ELE NUNCA ENVIA NADA
 * ============================================================
 * `enviar()` registra e devolve um id falso. Nao existe caminho por onde
 * este arquivo alcance a rede.
 */
import type {
  ProvedorWhatsApp,
  EventoProvedor,
  InfoConta,
  MensagemProvedor,
} from './provedor.js';

type Handler = (...args: unknown[]) => void;

export interface OpcoesProvedorSimulado {
  telefone?: string;
  nome?: string;
  /** Simula falha na autenticacao em vez de ficar pronto. */
  falharAutenticacao?: boolean;
  /** Simula falha ao inicializar (Chromium ausente, por exemplo). */
  falharInicializacao?: string;
  /** Pula o QR, como acontece quando ja existe sessao salva. */
  sessaoExistente?: boolean;
}

export class ProvedorSimulado implements ProvedorWhatsApp {
  private handlers = new Map<EventoProvedor, Handler[]>();
  private info: InfoConta | null = null;
  private destruido = false;

  /** Tudo que "teria sido enviado". Serve de prova nos testes. */
  readonly enviadas: Array<{ chatId: string; texto: string; em: Date }> = [];

  constructor(private readonly opcoes: OpcoesProvedorSimulado = {}) {}

  on(evento: EventoProvedor, handler: Handler): void {
    const atuais = this.handlers.get(evento) ?? [];
    atuais.push(handler);
    this.handlers.set(evento, atuais);
  }

  private emitir(evento: EventoProvedor, ...args: unknown[]): void {
    for (const h of this.handlers.get(evento) ?? []) h(...args);
  }

  async initialize(): Promise<void> {
    if (this.opcoes.falharInicializacao) {
      throw new Error(this.opcoes.falharInicializacao);
    }

    // Sessão salva: o provedor real pula direto para authenticated.
    if (!this.opcoes.sessaoExistente) {
      this.emitir('qr', '2@FakeQrCodeParaTeste');
    }

    if (this.opcoes.falharAutenticacao) {
      this.emitir('auth_failure', 'Sessão inválida (simulado)');
      return;
    }

    this.emitir('authenticated');
    this.info = {
      telefone: this.opcoes.telefone ?? '5519999990000',
      nome: this.opcoes.nome ?? 'Conta de teste',
      plataforma: 'simulado',
    };
    this.emitir('ready');
  }

  async destroy(): Promise<void> {
    this.destruido = true;
    this.info = null;
  }

  getInfo(): InfoConta | null {
    return this.info;
  }

  async enviar(chatId: string, texto: string): Promise<{ id: string }> {
    this.enviadas.push({ chatId, texto, em: new Date() });
    return { id: `simulado-${this.enviadas.length}` };
  }

  async numeroExiste(): Promise<boolean> {
    return true;
  }

  /**
   * O provedor simulado nao tem conversas para reler.
   *
   * Vazio e a resposta honesta. Devolver mensagens fabricadas faria os
   * testes de recuperacao passarem sem exercitar o caminho real.
   */
  async mensagensDesde(): Promise<MensagemProvedor[]> {
    return [];
  }

  /**
   * O simulado nunca trava, entao nunca precisa ser conferido.
   * `null` = "nao achei", que e a verdade.
   */
  async procurarEnviada(): Promise<string | null> {
    return null;
  }

  // ------------------------------------------------------------- controle
  //
  // Os metodos abaixo nao existem no provedor real: sao a alavanca que o
  // teste usa para provocar as situacoes que, na vida real, dependem do
  // WhatsApp e de um celular.

  /** Simula a chegada de uma mensagem. */
  receber(parcial: Partial<MensagemProvedor> & { body: string; from: string }): void {
    const m: MensagemProvedor = {
      id: parcial.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from: parcial.from,
      to: parcial.to ?? '5519999990000@c.us',
      body: parcial.body,
      timestamp: parcial.timestamp ?? Math.floor(Date.now() / 1000),
      fromMe: parcial.fromMe ?? false,
      type: parcial.type ?? 'chat',
      hasMedia: parcial.hasMedia ?? false,
      notifyName: parcial.notifyName ?? null,
      // Repassados como vieram: quando o teste nao informa, o adapter
      // exercita o mesmo caminho de fallback do provedor real.
      telefone: parcial.telefone,
      fonteTelefone: parcial.fonteTelefone,
    };
    this.emitir('message', m);
  }

  /** Simula a queda da conexão. */
  derrubar(motivo = 'NAVIGATION'): void {
    this.info = null;
    this.emitir('disconnected', motivo);
  }

  /** Simula um QR novo (o anterior expirou). */
  novoQr(qr = '2@OutroQrCode'): void {
    this.emitir('qr', qr);
  }

  /** Simula a confirmação de entrega de uma mensagem. */
  confirmar(providerMessageId: string, ack: number): void {
    this.emitir(
      'message_ack',
      { id: providerMessageId, from: '', to: '', body: '', timestamp: 0, fromMe: true, type: 'chat', hasMedia: false },
      ack
    );
  }

  get foiDestruido(): boolean {
    return this.destruido;
  }
}
