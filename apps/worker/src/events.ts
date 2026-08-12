/**
 * Publicacao de eventos do worker para a API.
 *
 * O worker roda em um processo separado e nao consegue escrever direto
 * nas conexoes SSE da API. A ponte e um canal pub/sub do Redis — que ja
 * existe no projeto por causa do BullMQ, entao nao adiciona nenhuma
 * dependencia nova.
 *
 *   worker --publish--> Redis --subscribe--> API --SSE--> navegador
 */
import type { AppEvent, EventType } from '@prospector/shared';
import { getPublicador } from './redis.js';

export const CANAL_EVENTOS = 'prospector:eventos';

export async function publicarEvento<T>(tipo: EventType, dados?: T): Promise<void> {
  const evento: AppEvent<T> = {
    tipo,
    em: new Date().toISOString(),
    ...(dados !== undefined ? { dados } : {}),
  };
  await getPublicador().publish(CANAL_EVENTOS, JSON.stringify(evento));
}
