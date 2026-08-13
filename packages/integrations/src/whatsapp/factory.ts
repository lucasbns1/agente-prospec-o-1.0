/**
 * Escolhe qual adapter usar.
 *
 * ============================================================
 * CONECTAR E ENVIAR SAO COISAS DIFERENTES
 * ============================================================
 * Duas chaves independentes, de proposito:
 *
 *   WHATSAPP_CANAL  decide se o sistema CONECTA de verdade
 *   WHATSAPP_MODE   decide se o sistema ENVIA de verdade
 *
 * A Fase 6A existe justamente na combinacao
 * `WHATSAPP_CANAL=whatsapp-web` + `WHATSAPP_MODE=dry-run`: conexao real,
 * recebimento real, envio nenhum. Se as duas coisas fossem a mesma
 * chave, provar a integracao exigiria destravar o envio junto — que e
 * exatamente o que nao pode acontecer nesta fase.
 *
 * Acima das duas ainda existe a guarda de fase
 * (`guarda-envio.ts`), que nao depende de configuracao alguma.
 *
 * PADRAO SEGURO: qualquer valor inesperado cai no adapter simulado, que
 * nao abre navegador nem conecta em lugar nenhum.
 */
import type { WhatsAppMode } from '@prospector/shared';
import type { WhatsAppAdapter } from './adapter.js';
import { FakeWhatsAppAdapter } from './fake-adapter.js';
import { WhatsAppWebAdapter } from './whatsapp-web-adapter.js';
import type { ProvedorWhatsApp } from './provedor.js';

export type CanalWhatsApp = 'simulado' | 'whatsapp-web';

export interface WhatsAppFactoryOptions {
  modo?: string;
  canal?: string;
  sessionPath?: string;
  chromePath?: string;
  logger?: (mensagem: string, dados?: Record<string, unknown>) => void;
  /**
   * Provedor pronto, para teste. Quando presente, a biblioteca real nao
   * e carregada — e assim que o adapter inteiro fica testavel sem
   * navegador e sem celular pareado.
   */
  provedor?: ProvedorWhatsApp;
}

export function resolverModo(valor: string | undefined): WhatsAppMode {
  return valor?.trim().toLowerCase() === 'live' ? 'live' : 'dry-run';
}

export function resolverCanal(valor: string | undefined): CanalWhatsApp {
  return valor?.trim().toLowerCase() === 'whatsapp-web' ? 'whatsapp-web' : 'simulado';
}

export async function criarWhatsAppAdapter(
  options: WhatsAppFactoryOptions = {}
): Promise<WhatsAppAdapter> {
  const modo = resolverModo(options.modo ?? process.env.WHATSAPP_MODE);
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
        ...(options.logger ? { logger: options.logger } : {}),
      });
    })());

  return new WhatsAppWebAdapter({
    provedor,
    modo,
    ...(options.logger ? { logger: options.logger } : {}),
  });
}
