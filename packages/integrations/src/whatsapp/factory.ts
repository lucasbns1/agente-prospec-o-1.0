/**
 * Escolhe qual adapter usar.
 *
 * PADRAO SEGURO: qualquer valor diferente de exatamente "live" resulta em
 * dry-run. Um typo no .env (WHATSAPP_MODE=liv, =true, vazio) nao pode
 * fazer o sistema comecar a disparar mensagens reais por acidente.
 */
import type { WhatsAppMode } from '@prospector/shared';
import type { WhatsAppAdapter } from './adapter.js';
import { FakeWhatsAppAdapter } from './fake-adapter.js';

export interface WhatsAppFactoryOptions {
  modo?: string;
  sessionPath?: string;
  chromePath?: string;
  logger?: (mensagem: string, dados?: Record<string, unknown>) => void;
}

export function resolverModo(valor: string | undefined): WhatsAppMode {
  return valor?.trim().toLowerCase() === 'live' ? 'live' : 'dry-run';
}

export async function criarWhatsAppAdapter(
  options: WhatsAppFactoryOptions = {}
): Promise<WhatsAppAdapter> {
  const modo = resolverModo(options.modo ?? process.env.WHATSAPP_MODE);

  if (modo === 'dry-run') {
    return new FakeWhatsAppAdapter({ logger: options.logger });
  }

  // O adapter real chega na FASE 8. Ate la, pedir modo `live` e um erro
  // explicito — melhor do que cair silenciosamente em simulacao e o
  // usuario achar que enviou mensagens que nunca sairam.
  throw new Error(
    'WHATSAPP_MODE=live ainda nao esta disponivel. ' +
      'A integracao real com whatsapp-web.js entra na Fase 8. ' +
      'Use WHATSAPP_MODE=dry-run.'
  );
}
