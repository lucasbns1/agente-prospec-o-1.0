/**
 * Escolhe qual adapter usar.
 *
 * ============================================================
 * CONECTAR E ENVIAR SAO COISAS DIFERENTES
 * ============================================================
 * `WHATSAPP_CANAL` decide se o sistema CONECTA de verdade — e so isso.
 *
 * Havia aqui um segundo eixo, `WHATSAPP_MODE`, que decidia se o sistema
 * ENVIA de verdade. Ele foi removido: travava tudo por variavel de
 * ambiente, sem aparecer em lugar nenhum da interface, e fazia uma
 * campanha corretamente configurada parecer quebrada.
 *
 * Quem decide envio agora e a campanha (`dryRun`), mais a guarda de fase
 * em `guarda-envio.ts`, que nao depende de configuracao alguma.
 *
 * PADRAO SEGURO: qualquer valor inesperado cai no adapter simulado, que
 * nao abre navegador nem conecta em lugar nenhum.
 */
import type { WhatsAppAdapter } from './adapter.js';
import { FakeWhatsAppAdapter } from './fake-adapter.js';
import { WhatsAppWebAdapter } from './whatsapp-web-adapter.js';
import type { ProvedorWhatsApp } from './provedor.js';

export type CanalWhatsApp = 'simulado' | 'whatsapp-web';

export interface WhatsAppFactoryOptions {
  canal?: string;
  sessionPath?: string;
  chromePath?: string;
  /** Fixa a versao do WhatsApp Web. Ver `OpcoesProvedor.webVersion`. */
  webVersion?: string;
  /** De onde baixar o build fixado. `{version}` e substituido. */
  webVersionUrl?: string;
  logger?: (mensagem: string, dados?: Record<string, unknown>) => void;
  /**
   * Provedor pronto, para teste. Quando presente, a biblioteca real nao
   * e carregada — e assim que o adapter inteiro fica testavel sem
   * navegador e sem celular pareado.
   */
  provedor?: ProvedorWhatsApp;
}

export function resolverCanal(valor: string | undefined): CanalWhatsApp {
  return valor?.trim().toLowerCase() === 'whatsapp-web' ? 'whatsapp-web' : 'simulado';
}

export async function criarWhatsAppAdapter(
  options: WhatsAppFactoryOptions = {}
): Promise<WhatsAppAdapter> {
  const canal = resolverCanal(options.canal ?? process.env.WHATSAPP_CANAL);

  if (canal === 'simulado' && !options.provedor) {
    return new FakeWhatsAppAdapter({ logger: options.logger });
  }

  const provedor =
    options.provedor ??
    (await (async () => {
      // Import dinamico: mantem o Puppeteer fora do processo enquanto
      // ninguem pedir uma conexao real.
      const { criarProvedorWhatsAppWeb } = await import('./provedor-whatsapp-web.js');
      return criarProvedorWhatsAppWeb({
        sessionPath: options.sessionPath ?? './data/whatsapp',
        ...(options.chromePath ? { chromePath: options.chromePath } : {}),
        ...(options.webVersion ? { webVersion: options.webVersion } : {}),
        ...(options.webVersionUrl ? { webVersionUrl: options.webVersionUrl } : {}),
        ...(options.logger ? { logger: options.logger } : {}),
      });
    })());

  return new WhatsAppWebAdapter({
    provedor,
    ...(options.logger ? { logger: options.logger } : {}),
  });
}
