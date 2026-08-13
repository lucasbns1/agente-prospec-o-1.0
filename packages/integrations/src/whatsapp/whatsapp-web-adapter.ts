/**
 * WhatsAppWebAdapter — a maquina de estados da conexao.
 *
 * Traduz os eventos do provedor para o vocabulario do sistema e mantem o
 * estado da conexao. E aqui que "qr" vira AGUARDANDO_QR e "disconnected"
 * vira RECONECTANDO ou FALHOU.
 *
 * ============================================================
 * NESTA FASE ELE NAO ENVIA
 * ============================================================
 * `sendMessage()` esta implementado por inteiro, mas passa pela guarda
 * de fase antes de tocar o provedor. Com `FASE_PERMITE_ENVIO_REAL =
 * false`, o metodo devolve um resultado simulado e registra o que TERIA
 * sido enviado. Nao existe caminho por onde ele alcance a rede.
 */
import type { WhatsAppMode, WhatsAppStatus } from '@prospector/shared';
import type {
  WhatsAppAdapter,
  StatusConexao,
  ResultadoEnvio,
  MensagemRecebida,
  ContatoWhatsApp,
} from './adapter.js';
import { telefoneParaChatId, chatIdParaTelefone } from './adapter.js';
import type { ProvedorWhatsApp, MensagemProvedor } from './provedor.js';
import { BarramentoCanal, type MensagemEntrada, type EventoCanal } from './eventos-canal.js';
import { avaliarGuardaEnvio, FASE_PERMITE_ENVIO_REAL } from './guarda-envio.js';

export interface OpcoesWhatsAppWebAdapter {
  provedor: ProvedorWhatsApp;
  modo: WhatsAppMode;
  logger?: (mensagem: string, dados?: Record<string, unknown>) => void;
  /** Tentativas de reconexao antes de desistir. Padrao 5. */
  maxTentativasReconexao?: number;
  /** Injetavel para o teste nao esperar de verdade. */
  aguardar?: (ms: number) => Promise<void>;
}

const espera = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export class WhatsAppWebAdapter implements WhatsAppAdapter {
  readonly modo: WhatsAppMode;

  private readonly provedor: ProvedorWhatsApp;
  private readonly log: (m: string, d?: Record<string, unknown>) => void;
  private readonly maxTentativas: number;
  private readonly aguardar: (ms: number) => Promise<void>;

  readonly barramento = new BarramentoCanal((erro, evento) => {
    this.log('Ouvinte do canal falhou (conexão preservada)', {
      evento: evento.tipo,
      erro: String(erro),
    });
  });

  private status: WhatsAppStatus = 'DESCONECTADO';
  private qrAtual: string | null = null;
  private telefoneConta: string | null = null;
  private detalhe: string | null = null;
  private ultimoEventoEm: Date | null = null;
  private conectadoDesde: Date | null = null;
  private tentativas = 0;
  private encerrando = false;

  // Handlers do contrato WhatsAppAdapter (compatibilidade com a Fase 1).
  private hReady: Array<(s: StatusConexao) => void> = [];
  private hQr: Array<(qr: string) => void> = [];
  private hMessage: Array<(m: MensagemRecebida) => void | Promise<void>> = [];
  private hDisconnected: Array<(motivo: string) => void> = [];
  private hStatus: Array<(s: StatusConexao) => void> = [];

  constructor(opcoes: OpcoesWhatsAppWebAdapter) {
    this.provedor = opcoes.provedor;
    this.modo = opcoes.modo;
    this.log = opcoes.logger ?? ((): void => {});
    this.maxTentativas = opcoes.maxTentativasReconexao ?? 5;
    this.aguardar = opcoes.aguardar ?? espera;
    this.registrarEventos();
  }

  // ------------------------------------------------------------- estado
  private async mudarStatus(
    novo: WhatsAppStatus,
    extras: { qr?: string | null; detalhe?: string | null } = {}
  ): Promise<void> {
    this.status = novo;
    if (extras.qr !== undefined) this.qrAtual = extras.qr;
    if (extras.detalhe !== undefined) this.detalhe = extras.detalhe;
    this.ultimoEventoEm = new Date();

    const status = this.getStatus();
    for (const h of this.hStatus) h(status);
    await this.barramento.publicar({
      tipo: 'canal.status',
      em: this.ultimoEventoEm,
      status: novo,
      ...(this.qrAtual ? { qr: this.qrAtual } : {}),
      ...(this.telefoneConta ? { telefone: this.telefoneConta } : {}),
      ...(this.detalhe ? { motivo: this.detalhe } : {}),
    });
  }

  // ------------------------------------------------- traducao dos eventos
  private registrarEventos(): void {
    this.provedor.on('qr', (qr) => {
      // O QR e volatil: vale segundos e nunca e persistido.
      void this.mudarStatus('AGUARDANDO_QR', {
        qr: String(qr),
        detalhe: 'Escaneie o QR Code pelo WhatsApp do celular',
      });
      for (const h of this.hQr) h(String(qr));
      void this.barramento.publicar({
        tipo: 'canal.qr',
        em: new Date(),
        qr: String(qr),
      });
    });

    this.provedor.on('authenticated', () => {
      void this.mudarStatus('AUTENTICANDO', {
        qr: null,
        detalhe: 'Sessão autenticada; carregando',
      });
      void this.barramento.publicar({ tipo: 'canal.autenticado', em: new Date() });
    });

    this.provedor.on('auth_failure', (motivo) => {
      this.tentativas = this.maxTentativas; // não adianta reconectar
      void this.mudarStatus('FALHOU', {
        qr: null,
        detalhe: `Falha na autenticação: ${String(motivo)}`,
      });
      void this.barramento.publicar({
        tipo: 'canal.falha_autenticacao',
        em: new Date(),
        motivo: String(motivo),
      });
    });

    this.provedor.on('ready', () => {
      const info = this.provedor.getInfo();
      this.telefoneConta = info?.telefone ?? null;
      this.tentativas = 0;
      this.conectadoDesde = new Date();
      void this.mudarStatus('CONECTADO', { qr: null, detalhe: null });

      const status = this.getStatus();
      for (const h of this.hReady) h(status);
      void this.barramento.publicar({
        tipo: 'canal.pronto',
        em: new Date(),
        status: 'CONECTADO',
        ...(this.telefoneConta ? { telefone: this.telefoneConta } : {}),
      });
    });

    this.provedor.on('disconnected', (motivo) => {
      this.telefoneConta = null;
      this.conectadoDesde = null;
      for (const h of this.hDisconnected) h(String(motivo));
      void this.barramento.publicar({
        tipo: 'canal.desconectado',
        em: new Date(),
        motivo: String(motivo),
      });
      void this.tratarQueda(String(motivo));
    });

    this.provedor.on('message', (bruta) => {
      const m = bruta as MensagemProvedor;

      // O eco do proprio envio nao e uma resposta do lead. Processar
      // como entrada faria o sistema classificar as proprias mensagens.
      if (m.fromMe) return;

      const entrada: MensagemEntrada = {
        providerMessageId: m.id,
        chatId: m.from,
        // Quem resolve o telefone e o provedor — e ele que conhece os
        // campos da biblioteca. Cortar o chatId fica como ultimo recurso,
        // e NUNCA em conversa LID: ali o que vem antes do "@" e um
        // identificador de privacidade, nao um numero. Usa-lo faria toda
        // resposta cair em "contato desconhecido".
        telefone:
          m.telefone ??
          (m.from.endsWith('@lid') ? '' : chatIdParaTelefone(m.from)),
        texto: m.body ?? '',
        nomeContato: m.notifyName ?? null,
        recebidaEm: new Date(m.timestamp * 1000),
        deMim: false,
        tipo: m.type,
        temMidia: m.hasMedia,
      };

      this.ultimoEventoEm = new Date();

      for (const h of this.hMessage) {
        void h({
          id: entrada.providerMessageId,
          chatId: entrada.chatId,
          telefone: entrada.telefone,
          texto: entrada.texto,
          nomeContato: entrada.nomeContato,
          timestamp: entrada.recebidaEm,
          deMim: false,
        });
      }

      void this.barramento.publicar({
        tipo: 'canal.mensagem_recebida',
        em: new Date(),
        mensagem: entrada,
      });
    });

    this.provedor.on('message_ack', (bruta, ack) => {
      const m = bruta as MensagemProvedor;
      void this.barramento.publicar({
        tipo: 'canal.confirmacao_entrega',
        em: new Date(),
        providerMessageId: m.id,
        ack: Number(ack),
      });
    });
  }

  /**
   * Reconexao com recuo exponencial.
   *
   * Reconectar em laco apertado depois de o WhatsApp derrubar a sessao
   * so acelera o proximo bloqueio. O recuo cresce, e depois de
   * `maxTentativas` o adapter para e assume FALHOU — porque a essa
   * altura o problema exige alguem olhando, nao mais uma tentativa.
   */
  private async tratarQueda(motivo: string): Promise<void> {
    if (this.encerrando) {
      await this.mudarStatus('DESCONECTADO', { detalhe: 'Encerrado' });
      return;
    }

    if (this.tentativas >= this.maxTentativas) {
      await this.mudarStatus('FALHOU', {
        detalhe: `Desconectado (${motivo}) e ${this.tentativas} tentativas de reconexão falharam`,
      });
      return;
    }

    this.tentativas += 1;
    const atraso = Math.min(2 ** this.tentativas * 1000, 60_000);

    await this.mudarStatus('RECONECTANDO', {
      detalhe: `Tentativa ${this.tentativas}/${this.maxTentativas} em ${Math.round(atraso / 1000)}s`,
    });

    await this.aguardar(atraso);
    if (this.encerrando) return;

    try {
      await this.provedor.initialize();
    } catch (err) {
      await this.tratarQueda(`falha ao reinicializar: ${String(err)}`);
    }
  }

  // ---------------------------------------------------------- ciclo de vida
  async connect(): Promise<void> {
    this.encerrando = false;
    await this.mudarStatus('INICIALIZANDO', {
      detalhe: 'Abrindo o navegador e carregando a sessão',
    });

    try {
      await this.provedor.initialize();
    } catch (err) {
      await this.mudarStatus('FALHOU', {
        detalhe: `Não foi possível inicializar: ${String(err)}`,
      });
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.encerrando = true;
    await this.provedor.destroy();
    this.telefoneConta = null;
    this.conectadoDesde = null;
    await this.mudarStatus('DESCONECTADO', { qr: null, detalhe: null });
  }

  getStatus(): StatusConexao {
    return {
      status: this.status,
      modo: this.modo,
      ...(this.qrAtual ? { qr: this.qrAtual } : {}),
      ...(this.telefoneConta ? { telefone: this.telefoneConta } : {}),
      ...(this.detalhe ? { detalhe: this.detalhe } : {}),
    };
  }

  /** Diagnóstico do canal, para o endpoint de saúde. */
  saude(): {
    provider: string;
    status: WhatsAppStatus;
    autenticado: boolean;
    conectado: boolean;
    ultimoEventoEm: string | null;
    sessaoDesde: string | null;
    envioRealPermitidoNaFase: boolean;
    tentativasReconexao: number;
  } {
    return {
      provider: 'whatsapp-web',
      status: this.status,
      autenticado: this.telefoneConta !== null,
      conectado: this.status === 'CONECTADO',
      ultimoEventoEm: this.ultimoEventoEm?.toISOString() ?? null,
      sessaoDesde: this.conectadoDesde?.toISOString() ?? null,
      envioRealPermitidoNaFase: FASE_PERMITE_ENVIO_REAL,
      tentativasReconexao: this.tentativas,
    };
  }

  // -------------------------------------------------------------- envio
  async sendMessage(telefone: string, texto: string): Promise<ResultadoEnvio> {
    const guarda = avaliarGuardaEnvio({
      modoGlobal: process.env.WHATSAPP_MODE,
      // O adapter não conhece campanha nem mensagem; quem decide isso é
      // o worker, que já avaliou antes de chegar aqui. Do ponto de vista
      // do adapter, o que resta é a trava de fase e o modo global.
      campanhaDryRun: false,
      mensagemDryRun: false,
    });

    if (guarda.simular) {
      this.log('SIMULAÇÃO — mensagem seria enviada', {
        telefone,
        tamanho: texto.length,
        motivos: guarda.motivos,
      });
      return { sucesso: true, whatsappMessageId: null, simulado: true };
    }

    // Inalcançável nesta fase. Mantido implementado para que ligar o
    // envio real seja uma mudança de uma linha na guarda — e não uma
    // reescrita apressada no dia da ativação.
    const r = await this.provedor.enviar(telefoneParaChatId(telefone), texto);
    return { sucesso: true, whatsappMessageId: r.id, simulado: false };
  }

  async isRegistered(telefone: string): Promise<boolean> {
    if (this.status !== 'CONECTADO') return false;
    return this.provedor.numeroExiste(telefone);
  }

  async getContacts(): Promise<ContatoWhatsApp[]> {
    // Deliberadamente vazio: extrair a agenda não faz parte desta fase e
    // não é necessário para prospecção a partir de dados públicos.
    return [];
  }

  // ------------------------------------------------- contrato de eventos
  onReady(h: (s: StatusConexao) => void): void {
    this.hReady.push(h);
  }
  onQr(h: (qr: string) => void): void {
    this.hQr.push(h);
  }
  onMessage(h: (m: MensagemRecebida) => void | Promise<void>): void {
    this.hMessage.push(h);
  }
  onDisconnected(h: (motivo: string) => void): void {
    this.hDisconnected.push(h);
  }
  onStatusChange(h: (s: StatusConexao) => void): void {
    this.hStatus.push(h);
  }

  /** Escuta os eventos internos já traduzidos. */
  ouvirCanal(ouvinte: (e: EventoCanal) => void | Promise<void>): () => void {
    return this.barramento.ouvir(ouvinte);
  }
}
