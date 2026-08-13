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
        cliente.on('message', (m: any) => handler(traduzirMensagem(m)));
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
  };
}
