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
    // ============================================================
    // DUAS COPIAS DA FERRAMENTA NAO PODEM DIVIDIR A FILA
    // ============================================================
    // Rodar uma copia para o Brasil e outra para Portugal so e seguro
    // se NADA for compartilhado. O banco se separa pela DATABASE_URL, a
    // sessao pela pasta — e o Redis por aqui.
    //
    // Sem isto, os dois workers consomem a MESMA fila do BullMQ: a
    // mensagem enfileirada pela copia de Portugal pode sair pelo numero
    // do Brasil, e a mesma mensagem pode sair duas vezes. O estado do
    // canal tambem colide, e cada tela passa a mostrar a conexao da
    // outra.
    //
    // O numero do banco do Redis (0 a 15) isola tudo de uma vez:
    // filas, estado, QR, comandos e trava — sem prefixo em chave
    // nenhuma, e sem um segundo Redis instalado.
    db: Number(process.env.REDIS_DB ?? 0),
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
