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
import { prisma, Prisma } from '@prospector/database';
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
      //
      // Tenta RESERVAR a chave antes de fazer qualquer coisa. Se ela ja
      // existe, este job e um retry (ou uma corrida com outro worker) e
      // precisa abortar sem repetir o efeito.
      //
      // ATENCAO — POR QUE NAO E UM `findUnique` SEGUIDO DE `create`:
      // esse par nao e atomico. Com dois workers (ou dois processos apos
      // um restart mal feito), ambos podem ler "nao existe" e tentar
      // criar. A constraint UNIQUE impede a linha duplicada, mas o
      // segundo `create` lanca P2002 — e um job que ESTOURA e reenfileirado
      // pelo BullMQ, o que na Fase 7 significaria tentar reenviar uma
      // mensagem que ja saiu.
      //
      // A forma correta e tentar o INSERT direto e tratar a colisao como
      // "ja processado". A decisao fica com o banco, que e o unico ponto
      // onde a operacao e realmente atomica.
      let registro;
      try {
        registro = await prisma.job.create({
          data: {
            fila: QUEUES.CREATE_NOTIFICATION,
            bullJobId: job.id ?? null,
            idempotencyKey,
            status: 'EXECUTANDO',
            payload: { mensagem },
            iniciadoEm: new Date(),
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          log.warn(
            { idempotencyKey, jobId: job.id },
            'Chave de idempotencia ja reservada — ignorando retry, nada sera reexecutado'
          );
          return { ignorado: true, motivo: 'ja_executado' };
        }
        throw err;
      }

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
