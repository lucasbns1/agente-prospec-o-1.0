/**
 * Health check — nao exige autenticacao de proposito, para servir de
 * primeiro diagnostico quando algo nao sobe.
 */
import type { FastifyInstance } from 'fastify';
import { checkDatabaseConnection } from '@prospector/database';
import { getRedis } from '../lib/redis.js';
import { FASE_PERMITE_ENVIO_REAL } from '@prospector/integrations';

export async function rotasHealth(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (_request, reply) => {
    const banco = await checkDatabaseConnection();

    let redis = false;
    try {
      const r = getRedis();
      redis = (await r.ping()) === 'PONG';
    } catch {
      redis = false;
    }

    const tudoOk = banco && redis;

    return reply.status(tudoOk ? 200 : 503).send({
      ok: tudoOk,
      versao: '0.1.0',
      fase: 1,
      servicos: {
        api: true,
        banco,
        redis,
      },
      whatsapp: {
        // O modo global saiu. O que resta de trava global e a guarda de
        // fase, no codigo. Simulacao por campanha nao aparece aqui —
        // ela e por campanha, e este endpoint e do sistema.
        envioRealPermitido: FASE_PERMITE_ENVIO_REAL,
      },
      em: new Date().toISOString(),
    });
  });
}
