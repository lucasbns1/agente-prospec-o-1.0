/**
 * Worker de diagnostico.
 *
 * Nao faz nada de negocio: existe para provar, ainda na Fase 1, que a
 * esteira Redis -> BullMQ -> worker -> banco -> evento SSE funciona
 * ponta a ponta. Se este job roda, a infraestrutura de filas esta de pe.
 *
 * Ele tambem demonstra o padrao de idempotencia que TODOS os jobs de
 * envio vao seguir a partir da Fase 7.
 */
import { Worker, type Job } from 'bullmq';
import { QUEUES } from '@prospector/shared';
import { prisma } from '@prospector/database';
import { opcoesRedis } from '../redis.js';
import { publicarEvento } from '../events.js';
import type { Logger } from 'pino';

export interface HealthJobData {
  mensagem: string;
  idempotencyKey: string;
}

export function criarWorkerHealth(log: Logger): Worker<HealthJobData> {
  return new Worker<HealthJobData>(
    QUEUES.CREATE_NOTIFICATION,
    async (job: Job<HealthJobData>) => {
      const { mensagem, idempotencyKey } = job.data;

      // --- Padrao de idempotencia ---
      // Tenta reservar a chave ANTES de fazer qualquer coisa. Se ela ja
      // existe, este job e um retry de algo que ja rodou: aborta em vez
      // de repetir o efeito.
      const existente = await prisma.job.findUnique({
        where: { idempotencyKey },
      });

      if (existente && existente.status === 'CONCLUIDO') {
        log.warn(
          { idempotencyKey, jobId: job.id },
          'Job ja executado anteriormente — ignorando retry'
        );
        return { ignorado: true, motivo: 'ja_executado' };
      }

      const registro =
        existente ??
        (await prisma.job.create({
          data: {
            fila: QUEUES.CREATE_NOTIFICATION,
            bullJobId: job.id ?? null,
            idempotencyKey,
            status: 'EXECUTANDO',
            payload: { mensagem },
            iniciadoEm: new Date(),
          },
        }));

      log.info({ mensagem, jobId: job.id }, 'Health job executado');

      await prisma.job.update({
        where: { id: registro.id },
        data: {
          status: 'CONCLUIDO',
          concluidoEm: new Date(),
          resultado: { ok: true, mensagem },
          tentativas: { increment: 1 },
        },
      });

      await publicarEvento('heartbeat', { origem: 'worker', mensagem });

      return { ok: true };
    },
    {
      connection: opcoesRedis(),
      concurrency: 1,
    }
  );
}
