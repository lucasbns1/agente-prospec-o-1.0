/**
 * A ponte da API para a varredura do WhatsApp.
 *
 * ============================================================
 * MESMO ARRANJO DE `pedirOrquestracao`
 * ============================================================
 * O pedido nasce aqui — voce clicando "buscar o que faltou". Mas quem
 * tem a sessao do WhatsApp na mao e o worker, e os dois sao processos
 * separados de proposito: o worker carrega um Chromium inteiro, e a API
 * nao pode arrastar isso junto nem morrer quando ele travar.
 *
 * ============================================================
 * O QUE ELA NAO GARANTE
 * ============================================================
 * Que a varredura va acontecer. Redis fora, ou worker parado, e o pedido
 * se perde — e isso e aceitavel: a varredura periodica roda de qualquer
 * forma. O botao e o caminho RAPIDO, nao o unico.
 *
 * Por isso ela nunca lanca. Uma falha aqui vira `enfileirado: false` com
 * o motivo, e a tela mostra isso em vez de um erro.
 */
import { Queue } from 'bullmq';
import { QUEUES } from '@prospector/shared';
import { carregarEnv } from '@prospector/config';
import { getRedis } from './redis.js';

let fila: Queue | null = null;

function getFila(): Queue {
  if (!fila) {
    fila = new Queue(QUEUES.RECONCILE_WHATSAPP, {
      connection: getRedis(),
      defaultJobOptions: {
        // Uma tentativa. Repetir uma varredura que falhou nao ajuda: se
        // o WhatsApp esta fora, ele vai continuar fora daqui a tres
        // segundos, e a periodica tenta de novo sozinha.
        attempts: 1,
        removeOnComplete: { age: 3600, count: 50 },
        removeOnFail: { age: 24 * 3600 },
      },
    });
  }
  return fila;
}

export interface ResultadoPedido {
  enfileirado: boolean;
  motivo?: string;
}

export async function pedirReconciliacao(p: {
  /** Ausente = janela normal. */
  desde?: Date;
  log?: { error: (obj: unknown, msg: string) => void };
}): Promise<ResultadoPedido> {
  try {
    const env = carregarEnv();

    await getFila().add(
      'reconciliar',
      {
        ...(p.desde ? { desde: p.desde.toISOString() } : {}),
        janelaHoras: env.WHATSAPP_RECONCILIATION_WINDOW_HOURS,
      },
      {
        // `jobId` por MINUTO, e nao por clique: um duplo-clique, ou dois
        // cliques seguidos por impaciencia, produzem um job so. Varrer
        // duas vezes no mesmo minuto nao acha nada de novo e ainda
        // disputa a mesma pagina do Chromium.
        jobId: `rec-${p.desde ? p.desde.toISOString().slice(0, 10) : 'janela'}-${
          new Date().toISOString().slice(0, 16)
        }`.replace(/:/g, '-'),
      }
    );

    return { enfileirado: true };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    const aviso =
      'Nao foi possivel pedir a varredura; a periodica cobre na proxima volta';
    if (p.log) p.log.error({ err }, aviso);
    return { enfileirado: false, motivo };
  }
}

export async function fecharFilaReconciliacao(): Promise<void> {
  await fila?.close();
  fila = null;
}
