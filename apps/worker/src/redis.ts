import { Redis } from 'ioredis';

/**
 * Conexao Redis do worker.
 *
 * `maxRetriesPerRequest: null` e obrigatorio para o BullMQ — ele usa
 * comandos bloqueantes que o ioredis abortaria com o padrao.
 *
 * `enableReadyCheck: false` evita um erro de boot quando o Redis ainda
 * esta subindo junto com o worker (comum no `docker compose up` seguido
 * de `pnpm dev`).
 */
export function opcoesRedis() {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

let publicador: Redis | null = null;

/** Conexao usada para publicar eventos que a API repassa por SSE. */
export function getPublicador(): Redis {
  if (!publicador) publicador = new Redis(opcoesRedis());
  return publicador;
}

export async function fecharPublicador(): Promise<void> {
  await publicador?.quit();
  publicador = null;
}
