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

/* eslint-disable @typescript-eslint/no-explicit-any */

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

  const cliente = new Client({
    authStrategy: new LocalAuth({ dataPath: opcoes.sessionPath }),
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
        const chat: any = await cliente.getChatById(chatId);
        const msgs: any[] = await chat.fetchMessages({ limit: 15 });

        for (const m of msgs) {
          if (!m?.fromMe) continue;
          if (Number(m?.timestamp ?? 0) < corte) continue;
          if (String(m?.body ?? '') !== texto) continue;
          return String(m?.id?._serialized ?? m?.id ?? '');
        }
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
      maxPorConversa = 20
    ): Promise<MensagemProvedor[]> {
      const corte = Math.floor(desde.getTime() / 1000);
      const encontradas: MensagemProvedor[] = [];

      const chats: any[] = await cliente.getChats();
      for (const chat of chats) {
        if (chat?.isGroup) continue;

        // `timestamp` do chat e o da ultima mensagem. Conversa parada
        // antes do corte nao tem nada novo — e `fetchMessages` e caro.
        if (Number(chat?.timestamp ?? 0) < corte) continue;

        try {
          const msgs: any[] = await chat.fetchMessages({ limit: maxPorConversa });
          for (const m of msgs) {
            if (m?.fromMe) continue;
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
