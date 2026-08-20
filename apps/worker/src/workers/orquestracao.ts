/**
 * Consome os pedidos de orquestracao que vem da API.
 *
 * ============================================================
 * A OUTRA PONTA DA PONTE
 * ============================================================
 * Quando voce libera uma intervencao, quem recebe o clique e a API — e
 * ela nao pode chamar o orquestrador, que vive neste processo. Ela
 * enfileira; este worker consome.
 *
 * A fila `advance_campaign` existia desde a Fase 1 sem nenhum consumidor.
 * O nome sempre descreveu isto.
 *
 * ============================================================
 * POR QUE A IA E CHAMADA DE NOVO EM VEZ DE SO RETOMAR
 * ============================================================
 * Retomar direto seria mandar a proxima mensagem da sequencia. Mas entre
 * a intervencao ter sido criada e voce te-la liberado, o mundo pode ter
 * mudado: o lead respondeu de novo, pediu para parar, a campanha foi
 * pausada, outra etapa saiu.
 *
 * Liberar significa "pode continuar", nao "mande a mensagem 3". Quem
 * decide o que continuar significa agora e o orquestrador, olhando o
 * estado atual — e a guarda continua entre a decisao e o envio.
 */
import { Worker, type Job } from 'bullmq';
import { QUEUES, type GatilhoOrquestracao } from '@prospector/shared';
import type { Logger } from 'pino';
import { opcoesRedis } from '../redis.js';
import { dispararGatilho } from '../services/gatilhos-ia.js';

interface DadosOrquestracao {
  leadId: string;
  campaignId: string;
  gatilho: GatilhoOrquestracao;
}

export function criarWorkerOrquestracao(log: Logger): Worker {
  return new Worker<DadosOrquestracao>(
    QUEUES.ADVANCE_CAMPAIGN,
    async (job: Job<DadosOrquestracao>) => {
      const { leadId, campaignId, gatilho } = job.data;

      log.info({ leadId, campaignId, gatilho }, 'Pedido de orquestracao recebido');

      // `dispararGatilho` engole os proprios erros e nao faz nada com a
      // IA desligada. Nesse caso o job termina sem efeito — e correto: o
      // destravamento em si ja aconteceu no banco, pela API, e o
      // despachante encontra o lead livre na proxima varredura.
      await dispararGatilho({ leadId, campaignId, gatilho });

      return { ok: true };
    },
    {
      connection: opcoesRedis(),
      // Um por vez: a orquestracao le e escreve o estado de um lead, e
      // duas passadas simultaneas sobre o mesmo lead disputariam as
      // mesmas linhas. Nao ha volume aqui que justifique paralelismo —
      // sao cliques seus, nao trafego.
      concurrency: 1,
    }
  );
}
