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
import type { WhatsAppStatus } from '@prospector/shared';
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

/**
 * Tipos que o WhatsApp usa para eventos internos, nao para conversa.
 *
 * Lista FECHADA de propósito: filtrar por "tudo que nao for `chat`"
 * descartaria audio, imagem e documento — que sao respostas de verdade.
 * Um tipo novo e desconhecido passa e vira mensagem, que e o erro barato:
 * aparece na tela para voce decidir, em vez de sumir.
 */
const TIPOS_DE_SISTEMA = new Set([
  'e2e_notification',
  'notification',
  'notification_template',
  'gp2',
  'protocol',
  'ciphertext',
  'revoked',
  'call_log',
  'broadcast_notification',
]);

export interface OpcoesWhatsAppWebAdapter {
  provedor: ProvedorWhatsApp;
  logger?: (mensagem: string, dados?: Record<string, unknown>) => void;
  /** Tentativas de reconexao antes de desistir. Padrao 5. */
  maxTentativasReconexao?: number;
  /** Injetavel para o teste nao esperar de verdade. */
  aguardar?: (ms: number) => Promise<void>;
  /**
   * Qual canal este adapter esta servindo — `baileys`, `whatsapp-web`
   * ou `simulado`.
   *
   * Serve para a tela de diagnostico nao mentir quando NAO ha conexao:
   * sem isto, o fallback era o literal 'whatsapp-web', e a tela dizia
   * "Provedor: whatsapp-web" com o Baileys rodando. Numa tela de
   * diagnostico, um rotulo errado manda quem esta depurando para o lado
   * errado — foi o que aconteceu.
   */
  canal?: string;
}

const espera = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export class WhatsAppWebAdapter implements WhatsAppAdapter {
  private provedor: ProvedorWhatsApp;
  private readonly canal: string | null;
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
    this.log = opcoes.logger ?? ((): void => {});
    this.maxTentativas = opcoes.maxTentativasReconexao ?? 5;
    this.canal = opcoes.canal ?? null;
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
      // ============================================================
      // UM QR ZERA A CONTAGEM DE FRACASSOS
      // ============================================================
      // `auth_failure` empurra as tentativas para o teto de proposito:
      // reconectar com credencial recusada so repete a recusa. So que o
      // teto ficava la DEPOIS, e o provedor, que nesse caso apaga a
      // credencial e reconecta justamente para pedir um QR novo, caia
      // num beco: qualquer oscilacao da conexao seguinte batia em
      // "tentativas esgotadas" e parava em FALHOU para sempre — com
      // tentativas: 5 na tela e nenhum QR.
      //
      // Um QR significa o contrario de fracasso: ha conexao viva com o
      // WhatsApp e ele esta esperando uma pessoa. O ciclo e novo, e a
      // contagem do ciclo velho nao vale mais.
      this.tentativas = 0;

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

      // ============================================================
      // O QUE SAI DO SEU NUMERO TAMBEM IMPORTA
      // ============================================================
      // Isto era um `return`: mensagem sua era descartada e o sistema
      // nunca sabia que voce tinha respondido na mao. A conversa na tela
      // ficava so com o lado do lead, a IA decidia sem saber o que voce
      // ja tinha dito, e a cadencia podia mandar a proxima etapa por cima
      // de uma negociacao em andamento.
      //
      // Agora ela passa, marcada com `deMim`. Quem trata a diferenca e o
      // pipeline: mensagem sua NAO e classificada como resposta do lead —
      // ela e registrada, entra no contexto da IA, e pausa a automacao
      // daquele lead.
      //
      // O eco dos envios do PROPRIO sistema tambem chega aqui, com o
      // mesmo `fromMe`. Ele e descartado no pipeline pelo
      // `whatsappMessageId`, que ja foi gravado no envio — e a mesma
      // chave UNIQUE que impede historico duplicado.

      // Eventos internos do WhatsApp — troca de chave, aviso de grupo,
      // registro de chamada. Nao sao alguem falando com voce.
      //
      // Um destes criou um "contato desconhecido" com texto vazio na
      // validacao real: um fantasma na tela, pedindo uma decisao sobre
      // uma mensagem que nunca existiu.
      if (TIPOS_DE_SISTEMA.has(m.type)) {
        this.log('Evento de sistema ignorado', { tipo: m.type });
        return;
      }

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
        deMim: Boolean(m.fromMe),
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
          deMim: entrada.deMim,
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

  /**
   * Pede o codigo de pareamento — conectar digitando, sem camera.
   *
   * O QR falha de formas que nao se explicam: codigo vencido entre a
   * tela e a camera, brilho, camera ruim, aparelhos conectados no
   * limite. Quando ele nao fecha, nao ha o que depurar. O codigo e o
   * mesmo pareamento por outro caminho, e o erro dele e uma frase.
   */
  async solicitarCodigoDePareamento(telefone: string): Promise<string> {
    if (!this.provedor.solicitarCodigo) {
      throw new Error(
        'Este canal não oferece pareamento por código. Use o QR Code.'
      );
    }
    return this.provedor.solicitarCodigo(telefone);
  }

  /**
   * Troca a conexao por baixo, mantendo ESTE adapter.
   *
   * ============================================================
   * POR QUE O ADAPTER NAO PODE SER SUBSTITUIDO
   * ============================================================
   * O worker de envio, o de reconciliacao, a varredura periodica e a
   * publicacao de estado guardam, cada um, uma referencia a este objeto,
   * pegas na inicializacao. Criar um adapter novo para o segundo numero
   * deixaria todos eles falando com a conexao ANTIGA — morta. O sintoma
   * seria o pior possivel: a tela mostrando o numero novo conectado
   * enquanto nenhuma mensagem sai e nenhuma resposta chega.
   *
   * Entao o que troca e a peca de baixo. Quem esta em volta nem fica
   * sabendo.
   *
   * ============================================================
   * O ANTIGO MORRE ANTES DE O NOVO NASCER
   * ============================================================
   * Duas sessoes vivas do WhatsApp ao mesmo tempo derrubam as duas. Por
   * isso `destroy()` vem primeiro, e `encerrando` fica ligado durante a
   * troca: ele e a trava que impede a reconexao automatica de
   * ressuscitar o numero que voce acabou de deixar.
   *
   * Se o antigo falhar ao morrer, a troca CONTINUA — uma sessao que nao
   * responde nem ao destroy ja esta perdida, e travar aqui deixaria voce
   * sem numero nenhum.
   */
  /**
   * Mata a conexao atual, faz algo com o disco, e SO ENTAO abre a nova.
   *
   * ============================================================
   * A ORDEM E O CONSERTO — DE NOVO
   * ============================================================
   * Apagar a credencial com o socket antigo VIVO nao apaga nada: ele
   * ainda emite `creds.update`, e o ouvinte grava de volta em disco o
   * estado que esta em memoria. Ja aconteceu uma vez, dentro do
   * provedor, e voltou a acontecer pelo caminho novo — o botao "abrir
   * nova sessao", em que quem apaga os arquivos e o worker, de fora.
   *
   * O sintoma e cruel porque a tela diz a verdade pela metade: "a
   * credencial foi descartada" aparece, e logo em seguida o canal cai em
   * `401 Connection Failure` sem nunca mostrar QR. A credencial voltou
   * antes de a conexao nova nascer, e a conexao nova nasceu com ela.
   *
   * Por isso a sequencia vive AQUI, e nao em quem chama: primeiro o
   * antigo morre, depois `entreUmEOutro` mexe no disco, e so no fim o
   * provedor novo e criado — ja lendo o que sobrou.
   */
  async reiniciarSessao(
    entreUmEOutro: () => void | Promise<void>,
    criarNovo: () => Promise<ProvedorWhatsApp>
  ): Promise<void> {
    // `encerrando` antes de tudo: sem ele, a morte do socket antigo
    // dispara a reconexao automatica, que abre outra conexao com a
    // credencial que estamos prestes a apagar.
    this.encerrando = true;
    try {
      await this.provedor.destroy();
    } catch (err) {
      this.log('Conexão antiga não encerrou limpo; seguindo', { erro: String(err) });
    }

    await entreUmEOutro();

    await this.trocarProvedor(await criarNovo());
  }

  async trocarProvedor(novo: ProvedorWhatsApp): Promise<void> {
    this.encerrando = true;

    try {
      await this.provedor.destroy();
    } catch (err) {
      this.log('Conexão antiga não encerrou limpo; seguindo com a troca', {
        erro: String(err),
      });
    }

    this.provedor = novo;
    this.telefoneConta = null;
    this.conectadoDesde = null;
    this.qrAtual = null;
    // A contagem de tentativas e do numero antigo: mante-la faria a
    // primeira instabilidade do numero novo esgotar o orcamento de
    // reconexao dele.
    this.tentativas = 0;
    this.registrarEventos();

    await this.mudarStatus('DESCONECTADO', {
      qr: null,
      detalhe: 'Trocando de número',
    });

    await this.connect();
  }

  getStatus(): StatusConexao {
    return {
      status: this.status,
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
      // Quem esta conectado, e nao um nome fixo. Com dois provedores
      // reais, um rotulo cravado faz a tela de diagnostico dizer
      // "whatsapp-web" enquanto quem responde e o Baileys — e a tela de
      // diagnostico e justamente onde a mentira custa mais caro.
      // Conectado: o que o proprio provedor diz. Desconectado: o canal
      // configurado. Nunca um literal — ver `canal` nas opcoes.
      provider:
        this.provedor.getInfo()?.plataforma ?? this.canal ?? 'desconhecido',
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
      // O adapter não conhece campanha nem mensagem; quem decide isso é
      // o worker, que já avaliou antes de chegar aqui. Do ponto de vista
      // do adapter, o que resta é a trava de fase.
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

  /**
   * Lê das conversas o que o evento ao vivo não entregou.
   *
   * Aplica os MESMOS filtros do `onMessage` — eco do próprio número e
   * eventos de sistema. Filtros diferentes fariam a varredura trazer
   * fantasmas que o caminho ao vivo descarta, e o comportamento do
   * sistema passaria a depender de o worker estar no ar ou não no
   * segundo em que a mensagem chegou.
   */
  async mensagensPerdidas(
    desde: Date,
    chatIdsConhecidos?: string[]
  ): Promise<MensagemEntrada[]> {
    const brutas = await this.provedor.mensagensDesde(
      desde,
      undefined,
      chatIdsConhecidos
    );

    return brutas
      .filter((m) => !m.fromMe && !TIPOS_DE_SISTEMA.has(m.type))
      .map((m) => ({
        providerMessageId: m.id,
        chatId: m.from,
        telefone:
          m.telefone ??
          (m.from.endsWith('@lid') ? '' : chatIdParaTelefone(m.from)),
        texto: m.body ?? '',
        nomeContato: m.notifyName ?? null,
        recebidaEm: new Date(m.timestamp * 1000),
        deMim: false,
        tipo: m.type,
        temMidia: m.hasMedia,
      }));
  }

  /**
   * Confere na conversa se a mensagem saiu.
   *
   * Usa o MESMO `telefoneParaChatId` do envio: procurar noutro chat
   * daria "nao achei" para uma mensagem que esta la.
   */
  async confirmarEnvio(
    telefone: string,
    texto: string,
    desde: Date
  ): Promise<string | null> {
    return this.provedor.procurarEnviada(telefoneParaChatId(telefone), texto, desde);
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
