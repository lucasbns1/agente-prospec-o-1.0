/**
 * O UNICO arquivo do projeto que importa `whatsapp-web.js`.
 *
 * ============================================================
 * REGRA ARQUITETURAL
 * ============================================================
 * Nenhum outro arquivo — nem API, nem worker, nem domain, nem frontend —
 * conhece esta biblioteca. Ela e nao-oficial e automatiza o WhatsApp Web
 * por baixo dos panos; atualizacoes do WhatsApp quebram ela
 * periodicamente. Quando isso acontecer, o conserto precisa caber neste
 * arquivo.
 *
 * O import e DINAMICO e acontece dentro da funcao, nao no topo. Assim o
 * pacote (que arrasta o Puppeteer inteiro) so e carregado quando alguem
 * realmente pede uma conexao real — testes, API e worker em dry-run nem
 * tocam nele.
 */
import type {
  ProvedorWhatsApp,
  OpcoesProvedor,
  EventoProvedor,
  InfoConta,
  MensagemProvedor,
} from './provedor.js';
import { exigirPermissaoDeEnvioReal } from './guarda-envio.js';
import { resolverTelefoneDaMensagem } from './telefone-da-mensagem.js';
import { acharEnviada, type ConversaVarrida } from './procurar-enviada.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * `getChats()` com tentativas.
 *
 * ============================================================
 * POR QUE ISTO PRECISA EXISTIR
 * ============================================================
 * O evento `ready` significa "a sessao autenticou", nao "a pagina
 * terminou de carregar". Nos primeiros segundos depois dele,
 * `getChats()` estoura dentro do Chromium com um erro opaco — literal:
 *
 *   ERROR (worker): Falha na varredura de mensagens perdidas
 *     message: "r"
 *     at Client.getChats (whatsapp-web.js/src/Client.js:1669)
 *
 * Um erro chamado "r", porque o codigo da pagina esta minificado.
 *
 * Isso derrubava a varredura de mensagens perdidas na conexao. Pior:
 * `confirmarEnvio` usa a MESMA chamada, e uma falha dela no momento do
 * envio faria o sistema concluir "nao achei a mensagem" e marcar FALHOU
 * um envio que deu certo — exatamente o defeito que a confirmacao
 * existe para evitar.
 *
 * Tentar de novo resolve porque a causa e transitoria: a pagina termina
 * de carregar. A questao e QUANTO esperar.
 *
 * ============================================================
 * POR QUE O ORCAMENTO CRESCEU
 * ============================================================
 * A primeira versao tentava 3 vezes com 2s, 4s e 8s — catorze segundos
 * de paciencia. Numa maquina real, com uma conta de WhatsApp cheia de
 * conversas, isso nao bastou: a varredura da conexao falhou DUAS vezes
 * seguidas, sempre no mesmo ponto, sempre com o mesmo "r".
 *
 * O custo de esperar demais e nenhum: esta funcao roda num caminho
 * assincrono que nao segura mais nada. O custo de esperar de menos e a
 * varredura da conexao morrer e o sistema so se acertar cinco minutos
 * depois, na periodica — ou, no caminho de `confirmarEnvio`, marcar
 * FALHOU um envio que deu certo.
 *
 * Entao a escala e outra: SEIS tentativas, com o passo limitado a 30s
 * (5s, 10s, 20s, 30s, 30s = ate ~1min35). O teto existe porque dobrar
 * indefinidamente chegaria a esperas de minutos entre tentativas sem
 * ganhar nada — a pagina do WhatsApp carrega em segundos ou nao carrega.
 */
export const ESPERA_MAXIMA_MS = 30_000;

/** Exportada para o teste: o orcamento de espera e o ponto todo dela. */
export async function getChatsComTentativas(
  cliente: any,
  log: (m: string, d?: Record<string, unknown>) => void,
  tentativas = 6
): Promise<any[]> {
  let ultimoErro: unknown;

  for (let i = 0; i < tentativas; i += 1) {
    try {
      return await cliente.getChats();
    } catch (err) {
      ultimoErro = err;
      const esperar = Math.min(5000 * 2 ** i, ESPERA_MAXIMA_MS);
      log('getChats falhou; a pagina do WhatsApp pode ainda estar carregando', {
        tentativa: i + 1,
        de: tentativas,
        // Zero na ultima: ela nao espera por nada, so desiste.
        proximaEmMs: i < tentativas - 1 ? esperar : 0,
      });
      if (i < tentativas - 1) {
        await new Promise((r) => setTimeout(r, esperar));
      }
    }
  }

  throw ultimoErro;
}

/** Converte a mensagem da biblioteca para o formato do sistema. */
function traduzirMensagem(m: any): MensagemProvedor {
  return {
    id: String(m?.id?._serialized ?? m?.id ?? ''),
    from: String(m?.from ?? ''),
    to: String(m?.to ?? ''),
    body: String(m?.body ?? ''),
    timestamp: Number(m?.timestamp ?? Math.floor(Date.now() / 1000)),
    fromMe: Boolean(m?.fromMe),
    type: String(m?.type ?? 'chat'),
    hasMedia: Boolean(m?.hasMedia),
    notifyName: m?._data?.notifyName ?? null,
  };
}

export async function criarProvedorWhatsAppWeb(
  opcoes: OpcoesProvedor
): Promise<ProvedorWhatsApp> {
  const log = opcoes.logger ?? ((): void => {});

  // Import dinamico: mantem o Puppeteer fora do processo em dry-run.
  const mod: any = await import('whatsapp-web.js');
  const { Client, LocalAuth } = mod.default ?? mod;

  // ============================================================
  // QUAL BUILD DO WHATSAPP WEB CARREGAR
  // ============================================================
  // Sem isto, a pagina carrega o que o WhatsApp servir naquele dia — e
  // quando ele publica uma versao nova, a injecao do whatsapp-web.js
  // para de encontrar o que procura.
  //
  // O sintoma nao denuncia a causa: os EVENTOS continuam funcionando
  // (mensagem recebida chega normalmente), mas toda CONSULTA ao store
  // falha com um erro opaco de dentro do Chromium. Em uso real isso
  // levou `getChats()` a falhar seis vezes seguidas e `getChatById()` a
  // falhar nas 84 conversas, com a biblioteca ja na ultima versao
  // publicada — nao havia atualizacao para instalar.
  //
  // `strict: false` de proposito: se o build fixado nao existir mais no
  // acervo, a biblioteca cai no comportamento padrao em vez de recusar
  // conectar. Perder a versao fixada e um problema; perder a conexao do
  // WhatsApp e outro, bem maior.
  const fixarVersao =
    opcoes.webVersion && opcoes.webVersionUrl
      ? {
          webVersion: opcoes.webVersion,
          webVersionCache: {
            type: 'remote' as const,
            remotePath: opcoes.webVersionUrl,
            strict: false,
          },
        }
      : {};

  if (opcoes.webVersion) {
    log('Fixando a versao do WhatsApp Web', { versao: opcoes.webVersion });
  }

  const cliente = new Client({
    authStrategy: new LocalAuth({ dataPath: opcoes.sessionPath }),
    ...fixarVersao,
    puppeteer: {
      headless: true,
      // Sem `executablePath` o Puppeteer procura um Chromium que este
      // projeto NAO baixa de proposito (sao ~300 MB). O usuario ja tem
      // Chrome instalado; CHROME_PATH aponta para ele.
      ...(opcoes.chromePath ? { executablePath: opcoes.chromePath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // O /dev/shm padrao do Docker e pequeno demais para o Chromium e
        // causa crashes silenciosos.
        '--disable-dev-shm-usage',
      ],
    },
  });

  return {
    on(evento: EventoProvedor, handler: (...args: unknown[]) => void): void {
      // A traducao dos nomes acontece no adapter; aqui so repassamos, com
      // a mensagem ja normalizada para nao vazar o objeto da biblioteca.
      if (evento === 'message') {
        // Assincrono porque resolver o telefone pode exigir consultar o
        // contato. O try/catch e obrigatorio: uma excecao escapando de um
        // listener do whatsapp-web.js derruba a sessao inteira.
        cliente.on('message', (m: any) => {
          void (async () => {
            try {
              const { telefone, fonte, ehLid } = await resolverTelefoneDaMensagem(m);

              if (ehLid) {
                // O numero NAO vai para o log — e dado do lead. So a
                // fonte, que e o que se precisa saber quando a
                // biblioteca muda de comportamento.
                log(
                  `Conversa LID — telefone resolvido por: ${fonte}` +
                    (telefone ? '' : ' (nenhum numero disponivel)')
                );
              }

              handler({ ...traduzirMensagem(m), telefone, fonteTelefone: fonte });
            } catch (err) {
              log(`Falha ao tratar mensagem recebida: ${String(err)}`);
            }
          })();
        });

        // ============================================================
        // O QUE VOCE MANDA DO CELULAR
        // ============================================================
        // `message` NAO dispara para as suas proprias mensagens — a
        // biblioteca so avisa do que chega. Quem cobre o outro sentido e
        // `message_create`, que dispara para os DOIS.
        //
        // Sem isto, tudo que voce responde na mao pelo WhatsApp era
        // invisivel para o sistema: nao entrava na conversa, nao entrava
        // no contexto da IA, e o robo podia mandar a proxima etapa por
        // cima de uma conversa que voce ja estava tendo.
        //
        // O filtro `fromMe` e obrigatorio: sem ele toda mensagem
        // RECEBIDA chegaria duas vezes, por este listener e pelo de
        // cima.
        cliente.on('message_create', (m: any) => {
          if (!m?.fromMe) return;
          void (async () => {
            try {
              const { telefone, fonte } = await resolverTelefoneDaMensagem(m);
              handler({ ...traduzirMensagem(m), telefone, fonteTelefone: fonte });
            } catch (err) {
              log(`Falha ao tratar mensagem enviada por voce: ${String(err)}`);
            }
          })();
        });
        return;
      }
      if (evento === 'message_ack') {
        cliente.on('message_ack', (m: any, ack: number) =>
          handler(traduzirMensagem(m), ack)
        );
        return;
      }
      cliente.on(evento, (...args: unknown[]) => handler(...args));
    },

    async initialize(): Promise<void> {
      log('Inicializando o cliente do WhatsApp Web');
      await cliente.initialize();
    },

    async destroy(): Promise<void> {
      try {
        await cliente.destroy();
      } catch (err) {
        // Falhar ao fechar nao pode impedir o worker de encerrar.
        log('Falha ao destruir o cliente (ignorada)', { err: String(err) });
      }
    },

    getInfo(): InfoConta | null {
      const info = cliente.info;
      if (!info) return null;
      return {
        telefone: String(info?.wid?.user ?? '') || null,
        nome: info?.pushname ?? null,
        plataforma: info?.platform ?? null,
      };
    },

    async enviar(chatId: string, texto: string): Promise<{ id: string }> {
      // ÚLTIMA BARREIRA, imediatamente antes de tocar a biblioteca.
      // Mesmo que toda a lógica anterior tenha decidido errado, a
      // chamada morre aqui.
      exigirPermissaoDeEnvioReal(`envio para ${chatId}`);

      const enviada = await cliente.sendMessage(chatId, texto);
      return { id: String(enviada?.id?._serialized ?? enviada?.id ?? '') };
    },

    async numeroExiste(telefone: string): Promise<boolean> {
      const id = await cliente.getNumberId(telefone);
      return id !== null && id !== undefined;
    },

    /**
     * Procura na conversa uma mensagem NOSSA com este texto.
     *
     * ============================================================
     * POR QUE PERGUNTAR EM VEZ DE SUPOR
     * ============================================================
     * `sendMessage` as vezes entrega a mensagem e nunca resolve a
     * promessa. Ate agora o sistema so podia dizer "PODE ter saido" e
     * marcar FALHOU — e a mensagem tinha saido, sempre. A sequencia
     * parava numa falha que nao existia.
     *
     * O WhatsApp sabe a resposta: a mensagem esta na conversa. Basta
     * olhar.
     *
     * A comparacao e por texto exato + janela de tempo, e nao por id,
     * porque o id e justamente o que nao voltou. Duas mensagens
     * identicas no mesmo minuto sao indistinguiveis — mas isso e o que
     * queremos saber ("saiu alguma?"), nao qual delas.
     */
    async procurarEnviada(
      chatId: string,
      texto: string,
      desde: Date
    ): Promise<string | null> {
      const corte = Math.floor(desde.getTime() / 1000);
      try {
        // A decisao de QUAL mensagem conta e uma funcao pura, testada a
        // parte. Aqui so se traduz o formato da biblioteca.
        //
        // Varre as conversas em vez de abrir pelo id: numa conversa LID
        // o endereco real e `<identificador>@lid`, nao o telefone, e
        // `getChatById(telefone@c.us)` devolveria o chat errado — o
        // mesmo engano que ja custou caro na ENTRADA.
        void chatId;

        const chats: any[] = await getChatsComTentativas(cliente, log);
        const conversas: ConversaVarrida[] = [];

        for (const chat of chats) {
          if (chat?.isGroup) continue;
          if (Number(chat?.timestamp ?? 0) < corte) continue;

          const msgs: any[] = await chat.fetchMessages({ limit: 15 });
          conversas.push({
            isGroup: false,
            timestamp: Number(chat?.timestamp ?? 0),
            mensagens: msgs.map((m: any) => ({
              id: String(m?.id?._serialized ?? m?.id ?? ''),
              timestamp: Number(m?.timestamp ?? 0),
              fromMe: Boolean(m?.fromMe),
              body: String(m?.body ?? ''),
            })),
          });
        }

        return acharEnviada(conversas, texto, corte);
      } catch (err) {
        // Nao conseguir conferir nao e o mesmo que "nao saiu". Quem
        // chama trata `null` como "nao sei" e escolhe o caminho
        // conservador.
        log('Falha ao conferir se a mensagem saiu', {
          erro: err instanceof Error ? err.message : String(err),
        });
      }
      return null;
    },

    /**
     * Le das conversas o que o evento `message` nao entregou.
     *
     * Grupos ficam de fora: prospeccao e conversa de um para um, e
     * varrer grupos traria dezenas de mensagens que nao respondem a nada
     * nosso.
     *
     * Falha numa conversa nao derruba a varredura. Uma conversa com
     * midia corrompida ou historico grande demais nao pode custar as
     * respostas de todas as outras.
     */
    async mensagensDesde(
      desde: Date,
      maxPorConversa = 20,
      chatIdsConhecidos?: string[]
    ): Promise<MensagemProvedor[]> {
      const corte = Math.floor(desde.getTime() / 1000);
      const encontradas: MensagemProvedor[] = [];

      // ============================================================
      // DOIS CAMINHOS PARA CHEGAR NAS CONVERSAS
      // ============================================================
      // O caminho normal e `getChats()`: uma chamada, a lista inteira.
      //
      // Em uso real ele falhou SEIS vezes seguidas, ao longo de dois
      // minutos, sempre com o mesmo erro opaco de dentro do Chromium
      // (`message: "r"`, porque a pagina esta minificada). Nao era
      // lentidao de arranque: a sessao estava viva e os eventos de
      // mensagem chegavam normalmente no mesmo instante. O que quebra e
      // a consulta a lista completa — provavelmente por causa do
      // tamanho do store nessa conta.
      //
      // Entao ha um plano B: o sistema JA SABE com quem falou. Cada
      // lead tem um `chatId`, e `getChatById` busca uma conversa de
      // cada vez, sem nunca pedir a lista toda.
      //
      // Ele e mais lento (uma ida ao Chromium por conversa) e por isso
      // NAO e o padrao. Mas ele funciona onde a listagem quebra, e o
      // que ele deixa de fora e so o que o CRM nao conhece — que a
      // varredura de mensagens perdidas nunca teve como recuperar
      // mesmo, porque ela existe para reencontrar leads, nao para
      // descobrir gente nova.
      let chats: any[];
      try {
        chats = await getChatsComTentativas(cliente, log);
      } catch (err) {
        if (!chatIdsConhecidos?.length) throw err;

        log('getChats falhou de vez; buscando conversa por conversa', {
          conversas: chatIdsConhecidos.length,
          erro: err instanceof Error ? err.message : String(err),
        });

        chats = [];
        let falhas = 0;
        // O PRIMEIRO erro vai para o log, e nao nenhum.
        //
        // A versao anterior engolia todos em silencio. Em uso real isso
        // produziu "84 conversas pedidas, 0 encontradas" sem UMA pista
        // do motivo — que e o pior resultado possivel para um plano B:
        // ele falha e ainda esconde por que.
        //
        // Um so, e nao todos, porque 84 blocos identicos afogariam o log
        // do mesmo jeito que os do Prisma afogavam.
        let primeiroErro: string | null = null;

        for (const id of chatIdsConhecidos) {
          try {
            const chat = await cliente.getChatById(id);
            if (chat) chats.push(chat);
          } catch (e) {
            // Conversa que nao existe mais, numero que nunca teve
            // WhatsApp, id fora do formato. Nenhuma delas pode custar as
            // outras — a ausencia de UMA e informacao, nao erro.
            falhas += 1;
            if (!primeiroErro) {
              primeiroErro = e instanceof Error ? e.message : String(e);
            }
          }
        }

        log('Conversas recuperadas uma a uma', {
          encontradas: chats.length,
          falharam: falhas,
          // A ausencia de TODAS, porem, e outra coisa: significa que nem
          // a consulta por id funciona, e ai o problema nao esta na
          // lista de conversas — esta no acesso ao store da pagina.
          primeiroErro,
          diagnostico:
            chats.length === 0 && falhas > 0
              ? 'NENHUMA conversa respondeu. getChats e getChatById falham os dois, enquanto os eventos de mensagem funcionam: o whatsapp-web.js provavelmente nao consegue ler o store desta versao do WhatsApp Web.'
              : undefined,
        });
      }

      for (const chat of chats) {
        if (chat?.isGroup) continue;

        // `timestamp` do chat e o da ultima mensagem. Conversa parada
        // antes do corte nao tem nada novo — e `fetchMessages` e caro.
        if (Number(chat?.timestamp ?? 0) < corte) continue;

        try {
          const msgs: any[] = await chat.fetchMessages({ limit: maxPorConversa });
          for (const m of msgs) {
            // As SUAS mensagens tambem entram agora.
            //
            // Antes elas eram descartadas aqui, e o efeito era um buraco
            // silencioso: uma conversa que voce tocou na mao enquanto o
            // worker estava fora nunca aparecia no sistema — nem no
            // historico, nem no contexto que a IA le.
            //
            // Quem decide se elas mexem no presente e o inbound, pela
            // marca `historica`. Aqui elas so param de sumir.
            if (Number(m?.timestamp ?? 0) < corte) continue;

            // MESMA resolucao de telefone do caminho ao vivo. Sem ela, a
            // conversa LID entregaria o identificador de privacidade no
            // lugar do numero e toda mensagem recuperada cairia em
            // "contato desconhecido" — trocando um buraco por outro.
            const { telefone, fonte } = await resolverTelefoneDaMensagem(m);
            encontradas.push({
              ...traduzirMensagem(m),
              telefone,
              fonteTelefone: fonte,
            });
          }
        } catch (err) {
          log('Falha ao ler uma conversa na varredura', {
            chat: String(chat?.id?._serialized ?? '?'),
            erro: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Ordem cronologica: o pipeline aplica efeitos na ordem em que
      // recebe, e processar um "pare" antes do "quero" inverteria o
      // resultado final do lead.
      encontradas.sort((a, b) => a.timestamp - b.timestamp);
      return encontradas;
    },
  };
}
