/**
 * Conexao Redis da API.
 *
 * A API usa Redis para dois fins: publicar jobs nas filas do BullMQ e
 * escutar os eventos que o worker emite (pub/sub), para repassar por SSE.
 * O consumo dos jobs e responsabilidade exclusiva do worker.
 */
import { Redis } from 'ioredis';

let cliente: Redis | null = null;
let assinante: Redis | null = null;

function opcoes() {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    // Exigido pelo BullMQ: sem isso os comandos bloqueantes falham.
    maxRetriesPerRequest: null,
  };
}

export function getRedis(): Redis {
  if (!cliente) cliente = new Redis(opcoes());
  return cliente;
}

/**
 * Conexao separada para pub/sub. O Redis nao permite comandos normais em
 * uma conexao inscrita em canais — por isso duas instancias.
 */
export function getRedisSubscriber(): Redis {
  if (!assinante) assinante = new Redis(opcoes());
  return assinante;
}

export async function fecharRedis(): Promise<void> {
  await Promise.allSettled([cliente?.quit(), assinante?.quit()]);
  cliente = null;
  assinante = null;
}
