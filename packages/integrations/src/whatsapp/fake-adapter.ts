/**
 * FakeWhatsAppAdapter — modo DRY-RUN.
 *
 * Implementa a interface inteira sem enviar absolutamente nada. Serve
 * para exercitar o fluxo completo do sistema — campanhas, delays, filas,
 * regras, notificacoes — com o telefone desligado.
 *
 * Este e o adapter PADRAO. O sistema nasce em dry-run de proposito: e
 * preciso um ato deliberado (WHATSAPP_MODE=live no .env) para que
 * qualquer mensagem real saia.
 */
import type { WhatsAppMode } from '@prospector/shared';
import {
  type WhatsAppAdapter,
  type MensagemRecebida,
  type ResultadoEnvio,
  type StatusConexao,
  type ContatoWhatsApp,
} from './adapter.js';
import type { MensagemEntrada } from './eventos-canal.js';

export interface FakeAdapterOptions {
  /** Recebe cada linha de log. Por padrao, console.log. */
  logger?: (mensagem: string, dados?: Record<string, unknown>) => void;
  /** Simula latencia de rede, em ms. */
  latenciaMs?: number;
}

export class FakeWhatsAppAdapter implements WhatsAppAdapter {
  readonly modo: WhatsAppMode = 'dry-run';

  private status: StatusConexao = { status: 'DESCONECTADO', modo: 'dry-run' };
  private readonly log: (m: string, d?: Record<string, unknown>) => void;
  private readonly latenciaMs: number;

  private readyHandlers: Array<(s: StatusConexao) => void> = [];
  private qrHandlers: Array<(qr: string) => void> = [];
  private messageHandlers: Array<(m: MensagemRecebida) => void | Promise<void>> = [];
  private disconnectedHandlers: Array<(motivo: string) => void> = [];
  private statusHandlers: Array<(s: StatusConexao) => void> = [];

  /** Tudo que "seria enviado". Usado pelos testes e pela tela de simulacao. */
  readonly enviadas: Array<{ telefone: string; texto: string; em: Date }> = [];

  constructor(options: FakeAdapterOptions = {}) {
    this.log =
      options.logger ??
      ((m, d) => console.log(d ? `${m} ${JSON.stringify(d)}` : m));
    this.latenciaMs = options.latenciaMs ?? 0;
  }

  async connect(): Promise<void> {
    this.setStatus({
      status: 'CONECTADO',
      modo: 'dry-run',
      detalhe: 'Modo simulacao — nenhuma mensagem real sera enviada',
    });
    this.log('[DRY-RUN] WhatsApp "conectado" em modo simulacao.');
    for (const h of this.readyHandlers) h(this.status);
  }

  async disconnect(): Promise<void> {
    this.setStatus({ status: 'DESCONECTADO', modo: 'dry-run' });
    for (const h of this.disconnectedHandlers) h('Desconectado manualmente');
  }

  getStatus(): StatusConexao {
    return this.status;
  }

  async sendMessage(telefone: string, texto: string): Promise<ResultadoEnvio> {
    if (this.latenciaMs > 0) {
      await new Promise((r) => setTimeout(r, this.latenciaMs));
    }

    this.enviadas.push({ telefone, texto, em: new Date() });

    const previa = texto.length > 120 ? `${texto.slice(0, 120)}...` : texto;
    this.log(`SIMULACAO — mensagem seria enviada para ${telefone}`, {
      telefone,
      texto: previa,
      caracteres: texto.length,
    });

    return {
      sucesso: true,
      whatsappMessageId: null,
      simulado: true,
    };
  }

  async isRegistered(_telefone: string): Promise<boolean> {
    // Em simulacao assumimos que todo numero existe. A verificacao real
    // so acontece no modo live.
    return true;
  }

  async getContacts(): Promise<ContatoWhatsApp[]> {
    return [];
  }

  /**
   * Nao ha conversas para varrer numa simulacao.
   *
   * Devolver vazio e a resposta honesta: o fake nao guarda historico de
   * entrada. Inventar mensagens aqui faria os testes de recuperacao
   * passarem sem que o caminho real fosse exercitado.
   */
  async mensagensPerdidas(): Promise<MensagemEntrada[]> {
    return [];
  }

  /**
   * A simulacao nunca trava, entao nunca precisa ser conferida.
   * `null` = "nao achei", que e a verdade aqui.
   */
  async confirmarEnvio(): Promise<string | null> {
    return null;
  }

  // --- Eventos ---
  onReady(h: (s: StatusConexao) => void): void {
    this.readyHandlers.push(h);
  }
  onQr(h: (qr: string) => void): void {
    this.qrHandlers.push(h);
  }
  onMessage(h: (m: MensagemRecebida) => void | Promise<void>): void {
    this.messageHandlers.push(h);
  }
  onDisconnected(h: (motivo: string) => void): void {
    this.disconnectedHandlers.push(h);
  }
  onStatusChange(h: (s: StatusConexao) => void): void {
    this.statusHandlers.push(h);
  }

  /**
   * Injeta uma resposta ficticia, como se o lead tivesse respondido.
   * E assim que da para testar o motor de regras e o avanco de campanha
   * ponta a ponta sem nenhum telefone envolvido.
   */
  async simularRespostaRecebida(
    telefone: string,
    texto: string,
    nomeContato: string | null = null
  ): Promise<void> {
    const msg: MensagemRecebida = {
      id: `fake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      chatId: `${telefone}@c.us`,
      telefone,
      texto,
      nomeContato,
      timestamp: new Date(),
      deMim: false,
    };
    this.log(`[DRY-RUN] Simulando resposta de ${telefone}: "${texto}"`);
    for (const h of this.messageHandlers) await h(msg);
  }

  private setStatus(s: StatusConexao): void {
    this.status = s;
    for (const h of this.statusHandlers) h(s);
  }
}
