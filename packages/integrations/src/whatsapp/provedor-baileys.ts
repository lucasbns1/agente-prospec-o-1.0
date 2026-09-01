/**
 * O provedor que fala o protocolo do WhatsApp direto, sem navegador.
 *
 * ============================================================
 * POR QUE ELE EXISTE
 * ============================================================
 * O `whatsapp-web.js` automatiza a PAGINA do WhatsApp Web: ele abre um
 * Chromium e injeta codigo que depende da estrutura interna dela. Quando
 * o WhatsApp publica uma versao nova, essa estrutura muda e a injecao
 * para de achar o que procura.
 *
 * O sintoma nao denuncia a causa. Em uso real:
 *
 *   - mensagem recebida continuava chegando (os EVENTOS funcionavam)
 *   - `getChats()` falhou as seis tentativas, em dois minutos
 *   - `getChatById()` falhou nas 84 conversas, com o mesmo erro opaco
 *     `message: "r"` — uma letra, porque o codigo da pagina esta
 *     minificado
 *
 * A biblioteca ja estava na ultima versao publicada. Fixar uma versao
 * antiga do WhatsApp Web tambem nao resolveu: o HTML antigo carrega os
 * pacotes dos servidores do WhatsApp, e eles entregam os atuais.
 *
 * O Baileys nao tem pagina. Ele fala o protocolo multi-dispositivo por
 * WebSocket — nao ha injecao para quebrar desse jeito.
 *
 * ============================================================
 * E ELE ENTREGA O QUE O OUTRO NUNCA TEVE
 * ============================================================
 * No pareamento, o WhatsApp EMPURRA um pacote de historico
 * (`messaging-history.set`). Nao e uma consulta que pode falhar: e o
 * protocolo entregando o que aconteceu. E dai que sai a varredura de
 * mensagens perdidas.
 *
 * Em troca, ele nao guarda nada — quem arquiva somos nos, em
 * `ArquivoDeMensagens`. Isso e memoria e some no reinicio, e tudo bem: o
 * que importa ja foi para o Postgres pelo mesmo caminho de sempre.
 *
 * ============================================================
 * A GUARDA DE ENVIO VALE AQUI TAMBEM
 * ============================================================
 * `enviar` passa por `exigirPermissaoDeEnvioReal` como o outro provedor.
 * Trocar de biblioteca nao pode abrir uma porta lateral para o envio.
 */
import type {
  ProvedorWhatsApp,
  OpcoesProvedor,
  EventoProvedor,
  InfoConta,
  MensagemProvedor,
} from './provedor.js';
import { exigirPermissaoDeEnvioReal } from './guarda-envio.js';
import { ArquivoDeMensagens, traduzir } from './baileys-traducao.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Quantas mensagens guardar por conversa.
 *
 * Sessenta cobre com folga uma cadencia de cinco etapas com respostas.
 * O pacote de historico pode trazer dezenas de milhares de uma vez, e
 * guardar tudo estouraria a memoria do worker.
 */
const MAX_POR_CONVERSA = 60;

/**
 * Codigos de desconexao em que reconectar NAO adianta.
 *
 * `401` e a sessao invalidada — o celular desconectou o aparelho, ou a
 * credencial expirou. Reconectar em laco produziria um ciclo infinito
 * de falha, e o certo e pedir o QR de novo.
 */
const NAO_ADIANTA_RECONECTAR = new Set([401, 403]);

export async function criarProvedorBaileys(
  opcoes: OpcoesProvedor
): Promise<ProvedorWhatsApp> {
  const log = opcoes.logger ?? ((): void => {});

  // Import dinamico, como no outro provedor: mantem a biblioteca fora do
  // processo enquanto ninguem pedir uma conexao real.
  const baileys: any = await import('@whiskeysockets/baileys');
  const makeWASocket = baileys.default ?? baileys.makeWASocket;
  const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } =
    baileys;

  const arquivo = new ArquivoDeMensagens(MAX_POR_CONVERSA);

  // Os handlers que o adapter registrou, por evento. Guardados aqui
  // porque o socket e RECRIADO a cada reconexao — e sem isto os
  // ouvintes se perderiam na primeira queda.
  const ouvintes = new Map<EventoProvedor, Array<(...args: unknown[]) => void>>();
  const emitir = (evento: EventoProvedor, ...args: unknown[]): void => {
    for (const h of ouvintes.get(evento) ?? []) {
      try {
        h(...args);
      } catch (err) {
        // Uma excecao escapando de um ouvinte nao pode derrubar o
        // socket — mesma regra do outro provedor.
        log('Falha em um ouvinte do canal (ignorada)', { evento, err: String(err) });
      }
    }
  };

  let sock: any = null;
  let info: InfoConta | null = null;
  let encerrando = false;

  const { state, saveCreds } = await useMultiFileAuthState(opcoes.sessionPath);

  async function conectar(): Promise<void> {
    // A versao do protocolo vem do proprio Baileys, e nao de um arquivo
    // fixado por nos. Aqui isso funciona porque nao ha pagina para
    // casar: e o protocolo, e ele muda devagar.
    let versao: unknown;
    try {
      const r = await fetchLatestBaileysVersion();
      versao = r?.version;
      log('Versao do protocolo do WhatsApp', { versao: JSON.stringify(versao) });
    } catch {
      // Sem versao, o Baileys usa a que ele traz embutida. Nao e motivo
      // para nao conectar.
    }

    sock = makeWASocket({
      auth: state,
      ...(versao ? { version: versao } : {}),
      // O QR vai para a TELA do CRM, e nao para o terminal: e la que a
      // pessoa esta olhando quando conecta.
      printQRInTerminal: false,
      // Marcar tudo como lido apagaria os "nao lidas" do celular do
      // usuario — dado dele, nao nosso.
      markOnlineOnConnect: false,
      syncFullHistory: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u: any) => {
      const { connection, lastDisconnect, qr } = u ?? {};

      if (qr) {
        log('QR Code recebido');
        emitir('qr', qr);
      }

      if (connection === 'open') {
        const eu = sock?.user;
        info = {
          telefone: String(eu?.id ?? '').split(':')[0]?.split('@')[0] ?? null,
          nome: eu?.name ?? null,
          plataforma: 'baileys',
        };
        log('WhatsApp conectado', { nome: info.nome });
        emitir('authenticated');
        emitir('ready');
        return;
      }

      if (connection === 'close') {
        const codigo =
          lastDisconnect?.error?.output?.statusCode ??
          lastDisconnect?.error?.status ??
          null;
        const motivo = String(lastDisconnect?.error?.message ?? 'desconhecido');

        // Encerramento pedido por nos nao e queda.
        if (encerrando) return;

        const deslogado =
          codigo === DisconnectReason?.loggedOut ||
          (typeof codigo === 'number' && NAO_ADIANTA_RECONECTAR.has(codigo));

        if (deslogado) {
          log('Sessao invalidada — sera preciso ler o QR de novo', { codigo, motivo });
          emitir('auth_failure', motivo);
          emitir('disconnected', motivo);
          return;
        }

        log('Conexao caiu; reconectando', { codigo, motivo });
        emitir('change_state', 'RECONECTANDO');
        // Sem `await`: este handler nao pode segurar o socket antigo.
        // Um segundo de folga evita martelar o servidor numa queda em
        // sequencia.
        setTimeout(() => {
          void conectar().catch((err) => {
            log('Falha ao reconectar', { err: String(err) });
            emitir('disconnected', String(err));
          });
        }, 1_000);
      }
    });

    // ============================================================
    // O PACOTE DE HISTORICO
    // ============================================================
    // Isto e o que o outro provedor nunca teve. O WhatsApp EMPURRA o que
    // aconteceu, em pedacos, logo depois do pareamento. Nao ha consulta
    // nenhuma para falhar.
    //
    // Ele NAO e reemitido para o adapter como mensagem ao vivo, de
    // proposito: sao mensagens antigas, e trata-las como "chegou agora"
    // pausaria campanhas por causa de conversas de dias atras. Elas
    // entram no arquivo, e a varredura as le de la — que e onde a marca
    // `historica` e aplicada.
    sock.ev.on('messaging-history.set', (h: any) => {
      const traduzidas: MensagemProvedor[] = [];
      for (const m of h?.messages ?? []) {
        const t = traduzir(m);
        if (t) traduzidas.push(t);
      }
      const novas = arquivo.guardarVarias(traduzidas);

      log('Historico recebido do WhatsApp', {
        mensagensNoPacote: h?.messages?.length ?? 0,
        aproveitadas: traduzidas.length,
        novasNoArquivo: novas,
        conversasNoArquivo: arquivo.conversas,
        ultimoPedaco: h?.isLatest === true,
      });
    });

    // ============================================================
    // AS MENSAGENS AO VIVO
    // ============================================================
    // `type: 'notify'` e o que chegou AGORA. Os outros tipos sao
    // reentregas e sincronizacoes: entram no arquivo, mas nao viram
    // evento — reemiti-las faria o sistema reagir de novo a uma
    // conversa que ja aconteceu.
    sock.ev.on('messages.upsert', (u: any) => {
      const aoVivo = u?.type === 'notify';

      for (const bruta of u?.messages ?? []) {
        const m = traduzir(bruta);
        if (!m) continue;

        arquivo.guardar(m);
        if (!aoVivo) continue;

        // O adapter separa "minha" de "do lead" pelo `fromMe`, como no
        // outro provedor. Os dois sentidos passam por aqui: e isso que
        // faz o que voce digita no celular chegar ao CRM.
        emitir('message', m);
      }
    });

    // Confirmacoes de entrega. O Baileys as entrega como atualizacao da
    // mensagem, com `status` numerico.
    sock.ev.on('messages.update', (atualizacoes: any[]) => {
      for (const a of atualizacoes ?? []) {
        const id = a?.key?.id;
        const status = a?.update?.status;
        if (!id || typeof status !== 'number') continue;
        emitir('message_ack', { id, ack: status });
      }
    });
  }

  return {
    on(evento: EventoProvedor, handler: (...args: unknown[]) => void): void {
      ouvintes.set(evento, [...(ouvintes.get(evento) ?? []), handler]);
    },

    async initialize(): Promise<void> {
      log('Inicializando o cliente do WhatsApp (Baileys, sem navegador)');
      await conectar();
    },

    async destroy(): Promise<void> {
      encerrando = true;
      try {
        // `end` e nao `logout`: logout APAGA a sessao e obrigaria a ler
        // o QR de novo no proximo start. Encerrar o worker nao pode
        // custar isso.
        sock?.end?.(undefined);
      } catch (err) {
        log('Falha ao encerrar o socket (ignorada)', { err: String(err) });
      }
    },

    getInfo(): InfoConta | null {
      return info;
    },

    async enviar(chatId: string, texto: string): Promise<{ id: string }> {
      // A MESMA guarda do outro provedor. Trocar de biblioteca nao pode
      // abrir uma porta lateral para o envio real.
      exigirPermissaoDeEnvioReal('provedor-baileys.enviar');

      if (!sock) throw new Error('WhatsApp nao conectado');

      const r = await sock.sendMessage(chatId, { text: texto });
      const id = r?.key?.id;
      if (!id) throw new Error('O WhatsApp nao devolveu o id da mensagem enviada');

      // No arquivo tambem: e ele que responde "o envio saiu?" quando a
      // promessa nao volta numa proxima vez.
      const traduzida = traduzir(r);
      if (traduzida) arquivo.guardar(traduzida);

      return { id: String(id) };
    },

    async numeroExiste(telefone: string): Promise<boolean> {
      if (!sock) return false;
      try {
        const r = await sock.onWhatsApp(telefone);
        return Array.isArray(r) && r.length > 0 && r[0]?.exists === true;
      } catch (err) {
        // Na duvida, NAO afirmar que o numero nao existe: isso
        // descartaria um lead valido. Quem chama trata `false` como
        // "nao consegui confirmar".
        log('Falha ao consultar se o numero existe', { err: String(err) });
        return false;
      }
    },

    async mensagensDesde(
      desde: Date,
      _maxPorConversa?: number,
      chatIdsConhecidos?: string[]
    ): Promise<MensagemProvedor[]> {
      // Sem ida a rede: o arquivo ja tem o que o WhatsApp empurrou no
      // pareamento e tudo o que passou ao vivo desde entao. E por isso
      // que aqui nao ha nada que possa falhar com um erro opaco.
      const r = arquivo.desde(desde, chatIdsConhecidos);

      log('Varredura lida do arquivo em memoria', {
        desde: desde.toISOString(),
        encontradas: r.length,
        conversasNoArquivo: arquivo.conversas,
        mensagensNoArquivo: arquivo.total,
      });

      return r;
    },

    async procurarEnviada(
      chatId: string,
      texto: string,
      desde: Date
    ): Promise<string | null> {
      return arquivo.procurarEnviada(chatId, texto, desde);
    },
  };
}
