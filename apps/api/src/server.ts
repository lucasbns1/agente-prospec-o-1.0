/**
 * Ponto de entrada da API.
 *
 * O shutdown e explicito: fechar o Fastify, o Redis e o Prisma em ordem.
 * Sem isso, um Ctrl+C durante o desenvolvimento deixa conexoes penduradas
 * no Postgres ate estourar o limite do pool.
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { disconnectPrisma } from '@prospector/database';
import { criarApp } from './app.js';
import { fecharRedis } from './lib/redis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../../.env') });

async function main(): Promise<void> {
  const { app, env } = await criarApp();

  const encerrar = async (sinal: string): Promise<void> => {
    app.log.info({ sinal }, 'Encerrando a API...');
    try {
      await app.close();
      await fecharRedis();
      await disconnectPrisma();
      app.log.info('API encerrada com sucesso.');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Erro ao encerrar');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void encerrar('SIGINT'));
  process.on('SIGTERM', () => void encerrar('SIGTERM'));

  process.on('unhandledRejection', (err) => {
    app.log.error({ err }, 'Promise rejeitada sem tratamento');
  });

  try {
    await app.listen({ port: env.API_PORT, host: env.API_HOST });

    const dryRun = env.WHATSAPP_MODE.trim().toLowerCase() !== 'live';
    app.log.info(
      `API ouvindo em http://${env.API_HOST}:${env.API_PORT}  |  WhatsApp: ${
        dryRun ? 'DRY-RUN (nada e enviado de verdade)' : 'LIVE'
      }`
    );
  } catch (err) {
    app.log.error({ err }, 'Falha ao subir a API');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[FALHA FATAL NA API]', err);
  process.exit(1);
});
