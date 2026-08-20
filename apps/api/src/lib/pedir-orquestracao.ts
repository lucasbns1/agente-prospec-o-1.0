/**
 * A ponte da API para o orquestrador.
 *
 * ============================================================
 * POR QUE UMA FILA, E NAO UMA CHAMADA DIRETA
 * ============================================================
 * A liberacao de uma intervencao acontece na API — e voce clicando um
 * botao. Mas o orquestrador vive no worker, e os dois sao processos
 * separados de proposito: o worker carrega um Chromium inteiro, e a API
 * nao pode arrastar isso junto nem morrer quando ele travar.
 *
 * Sem esta ponte, o gatilho OPERADOR_LIBEROU simplesmente nao existia na
 * pratica: estava definido no tipo, documentado, e nunca era disparado.
 * Liberar uma intervencao devolvia o lead para a fila sem ninguem
 * reavaliar o contexto — que e justamente o contrario do que a
 * intervencao existe para fazer.
 *
 * ============================================================
 * A FILA E `advance_campaign`
 * ============================================================
 * Ela ja estava registrada desde a Fase 1 e nunca teve consumidor. O
 * nome descreve exatamente isto, e criar uma decima fila para o mesmo
 * proposito so aumentaria a chance de alguem procurar no lugar errado.
 *
 * ============================================================
 * O QUE ESTA FUNCAO NAO GARANTE
 * ============================================================
 * Que a orquestracao va acontecer. Se o Redis estiver fora, ou o worker
 * parado, o pedido se perde — e isso e aceitavel: liberar a intervencao
 * ja mudou o banco, e a proxima varredura do despachante encontra o lead
 * destravado de qualquer forma. O gatilho e o caminho RAPIDO, nao o
 * unico.
 *
 * Por isso ela nunca lanca: uma falha aqui nao pode derrubar a resposta
 * de um clique que ja funcionou.
 */
import { Queue } from 'bullmq';
import { QUEUES } from '@prospector/shared';
import { getRedis } from './redis.js';

let fila: Queue | null = null;

function getFila(): Queue {
  if (!fila) {
    fila = new Queue(QUEUES.ADVANCE_CAMPAIGN, {
      connection: getRedis(),
      defaultJobOptions: {
        // Duas tentativas, nao tres: o custo de nao orquestrar e um
        // atraso ate a proxima varredura, nao a perda do lead.
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 24 * 3600 },
      },
    });
  }
  return fila;
}

export interface PedidoOrquestracao {
  leadId: string;
  campaignId: string;
  /** Hoje so `OPERADOR_LIBEROU` vem da API. */
  gatilho: 'OPERADOR_LIBEROU';
  /** Identifica o acontecimento, para o mesmo clique nao virar dois jobs. */
  referencia: string;
  /**
   * O logger da requisicao. Opcional porque a falha aqui e inofensiva —
   * mas quando ha um, o registro sai no mesmo lugar que o resto do
   * pedido, e nao solto no stdout.
   */
  log?: { error: (obj: unknown, msg: string) => void };
}

export async function pedirOrquestracao(p: PedidoOrquestracao): Promise<void> {
  try {
    await getFila().add(
      'orquestrar',
      { leadId: p.leadId, campaignId: p.campaignId, gatilho: p.gatilho },
      {
        // `jobId` deterministico: dois cliques no mesmo botao, ou um
        // duplo-clique, produzem UM job. O BullMQ descarta o segundo.
        //
        // Dois-pontos nao entram em id customizado — o BullMQ usa ":"
        // nas proprias chaves do Redis.
        jobId: `orq-${p.gatilho}-${p.referencia}`.replace(/:/g, '-'),
      }
    );
  } catch (err) {
    const aviso = 'Nao foi possivel pedir a orquestracao; a varredura periodica cobre';
    if (p.log) p.log.error({ err, leadId: p.leadId, gatilho: p.gatilho }, aviso);
    else console.error('[orquestracao]', aviso, err);
  }
}

export async function fecharFilaOrquestracao(): Promise<void> {
  await fila?.close();
  fila = null;
}
