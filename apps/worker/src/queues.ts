/**
 * Registro das filas BullMQ.
 *
 * As 8 filas sao criadas ja na Fase 1 mesmo sem processadores reais.
 * Motivo: criar a fila e barato, e ter os nomes centralizados aqui desde
 * o inicio impede que cada fase invente um nome ligeiramente diferente
 * ("send-message" vs "send_message") e acabe com jobs orfaos no Redis.
 *
 * POLITICA DE RETRY (aplicada a todas):
 *  - 3 tentativas, backoff exponencial a partir de 5s;
 *  - jobs concluidos sao mantidos por 24h (auditoria no BullBoard);
 *  - jobs falhos sao mantidos por 7 dias — precisamos poder investigar.
 *
 * IDEMPOTENCIA: o retry so e seguro porque cada unidade de trabalho grava
 * uma `idempotencyKey` UNIQUE no Postgres antes de agir. O BullMQ sozinho
 * NAO garante execucao unica; a garantia vem da constraint do banco.
 */
import { Queue, type JobsOptions } from 'bullmq';
import { QUEUES, type QueueName } from '@prospector/shared';
import { opcoesRedis } from './redis.js';

export const OPCOES_JOB_PADRAO: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

const filas = new Map<QueueName, Queue>();

export function getFila(nome: QueueName): Queue {
  let fila = filas.get(nome);
  if (!fila) {
    fila = new Queue(nome, {
      connection: opcoesRedis(),
      defaultJobOptions: OPCOES_JOB_PADRAO,
    });
    filas.set(nome, fila);
  }
  return fila;
}

export const TODAS_AS_FILAS: QueueName[] = Object.values(QUEUES);

export function inicializarFilas(): Queue[] {
  return TODAS_AS_FILAS.map(getFila);
}

export async function fecharFilas(): Promise<void> {
  await Promise.allSettled([...filas.values()].map((f) => f.close()));
  filas.clear();
}
