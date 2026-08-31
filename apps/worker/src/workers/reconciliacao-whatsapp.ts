/**
 * O consumidor de "busca o que faltou".
 *
 * ============================================================
 * POR QUE UMA FILA, E NAO UMA CHAMADA DIRETA
 * ============================================================
 * O pedido nasce na API — voce clicando um botao. Mas quem tem a sessao
 * do WhatsApp na mao e o worker, e os dois sao processos separados de
 * proposito: o worker carrega um Chromium inteiro, e a API nao pode
 * arrastar isso junto nem morrer quando ele travar.
 *
 * Mesmo arranjo de `pedirOrquestracao`. A diferenca e o assunto: la o
 * pedido e sobre um LEAD; aqui e sobre o CANAL.
 *
 * ============================================================
 * ELE NAO PROCESSA MENSAGEM
 * ============================================================
 * Este arquivo so chama `varrerAgora`, que chama a funcao de
 * recuperacao que ja existia. Nao ha um segundo pipeline: toda mensagem
 * recuperada passa pelo mesmo `processarMensagemRecebida` das que
 * chegam ao vivo — e e essa identidade que faz a idempotencia por
 * `provider_message_id` valer para as duas.
 */
import { Worker, type Job } from 'bullmq';
import { QUEUES } from '@prospector/shared';
import type { WhatsAppAdapter } from '@prospector/integrations';
import type { Logger } from 'pino';
import { opcoesRedis } from '../redis.js';
import { varrerAgora } from '../services/varredura-periodica.js';

export interface DadosReconciliacao {
  /**
   * ISO de onde comecar. Ausente = usa a janela normal.
   *
   * Quem passa e a tela de um dia especifico: "reconcilie a terca" vira
   * `desde: <terca 00:00>`. Nao ha limite superior de proposito — ler
   * alem do dia pedido e barato e a idempotencia descarta o repetido.
   */
  desde?: string;
  /** Janela em horas, quando `desde` nao vem. */
  janelaHoras: number;
}

export function criarWorkerReconciliacaoWhatsApp(
  adapter: WhatsAppAdapter,
  log: Logger
): Worker {
  return new Worker<DadosReconciliacao>(
    QUEUES.RECONCILE_WHATSAPP,
    async (job: Job<DadosReconciliacao>) => {
      const { desde, janelaHoras } = job.data;

      // Um `desde` explicito vira uma janela equivalente em horas: a
      // funcao de recuperacao raciocina em janela, e converter aqui evita
      // dar a ela um segundo jeito de ser chamada.
      const horas = desde
        ? Math.max(
            1,
            Math.ceil((Date.now() - new Date(desde).getTime()) / 3600_000)
          )
        : janelaHoras;

      const r = await varrerAgora({
        adapter,
        log,
        janelaHoras: horas,
        origem: 'manual',
      });

      return r;
    },
    {
      connection: opcoesRedis(),
      // Uma por vez. `varrerAgora` ja recusa varreduras sobrepostas, mas
      // deixar o BullMQ enfileirar em vez de descartar e melhor: o
      // pedido espera a anterior terminar em vez de sumir.
      concurrency: 1,
    }
  );
}
