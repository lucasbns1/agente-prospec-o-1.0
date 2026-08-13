/**
 * Ponto de entrada do worker.
 *
 * POR QUE UM PROCESSO SEPARADO DA API:
 * A partir da Fase 8 este processo carrega um Chromium inteiro (o
 * whatsapp-web.js roda sobre o WhatsApp Web). Se ele travar ou vazar
 * memoria, nao pode levar junto a API e o Dashboard. Separando, o CRM
 * continua utilizavel mesmo com o WhatsApp fora do ar.
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarEnv } from '@prospector/config';
import { criarWhatsAppAdapter, resolverModo } from '@prospector/integrations';
import { disconnectPrisma, checkDatabaseConnection } from '@prospector/database';
import pino from 'pino';
import { inicializarFilas, fecharFilas, TODAS_AS_FILAS } from './queues.js';
import { criarWorkerHealth } from './workers/health.js';
import { criarWorkerOutbound } from './workers/outbound.js';
import { fecharPublicador } from './redis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../../.env') });

async function main(): Promise<void> {
  const env = carregarEnv();
  const desenvolvimento = env.NODE_ENV === 'development';

  const log = pino({
    level: env.LOG_LEVEL,
    name: 'worker',
    ...(desenvolvimento
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });

  log.info('Iniciando worker...');

  const bancoOk = await checkDatabaseConnection();
  if (!bancoOk) {
    log.error(
      'Nao foi possivel conectar ao banco. O Docker esta rodando? Tente: docker compose up -d'
    );
    process.exit(1);
  }

  inicializarFilas();
  log.info({ filas: TODAS_AS_FILAS }, `${TODAS_AS_FILAS.length} filas registradas`);

  // --- WhatsApp ---
  const modo = resolverModo(env.WHATSAPP_MODE);
  const adapter = await criarWhatsAppAdapter({
    modo,
    sessionPath: env.WHATSAPP_SESSION_PATH,
    chromePath: env.CHROME_PATH,
    logger: (m, d) => log.info(d ?? {}, m),
  });

  adapter.onStatusChange((s) => log.info({ status: s.status }, 'Status do WhatsApp mudou'));
  await adapter.connect();

  if (modo === 'dry-run') {
    log.warn(
      '=========================================================\n' +
        '  MODO DRY-RUN ATIVO\n' +
        '  Nenhuma mensagem real sera enviada.\n' +
        '  Para enviar de verdade: WHATSAPP_MODE=live no .env (Fase 8).\n' +
        '========================================================='
    );
  }

  // --- Workers ---
  const workers = [criarWorkerHealth(log), criarWorkerOutbound(log, adapter)];

  for (const w of workers) {
    w.on('failed', (job, err) => {
      log.error({ jobId: job?.id, fila: w.name, err }, 'Job falhou');
    });
    w.on('completed', (job) => {
      log.debug({ jobId: job.id, fila: w.name }, 'Job concluido');
    });
  }

  log.info('Worker pronto. Aguardando jobs.');

  // --- Shutdown ---
  let encerrando = false;
  const encerrar = async (sinal: string): Promise<void> => {
    if (encerrando) return;
    encerrando = true;
    log.info({ sinal }, 'Encerrando worker...');
    try {
      // Fecha os workers primeiro: eles terminam o job em andamento antes
      // de parar, para nao deixar trabalho pela metade.
      await Promise.allSettled(workers.map((w) => w.close()));
      await fecharFilas();
      await adapter.disconnect();
      await fecharPublicador();
      await disconnectPrisma();
      log.info('Worker encerrado com sucesso.');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'Erro ao encerrar o worker');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void encerrar('SIGINT'));
  process.on('SIGTERM', () => void encerrar('SIGTERM'));
  process.on('unhandledRejection', (err) => {
    log.error({ err }, 'Promise rejeitada sem tratamento');
  });
}

main().catch((err) => {
  console.error('[FALHA FATAL NO WORKER]', err);
  process.exit(1);
});
