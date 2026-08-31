/**
 * Sincronizacao entre o banco e o WhatsApp.
 *
 * Duas rotas: uma diz QUANDO foi a ultima varredura, a outra PEDE uma
 * varredura agora.
 *
 * ============================================================
 * A API NAO VARRE
 * ============================================================
 * Quem tem a sessao do WhatsApp e o worker. A API so enfileira o pedido
 * — mesmo arranjo de `pedirOrquestracao`, pelo mesmo motivo: o worker
 * carrega um Chromium inteiro, e a API nao pode arrastar isso junto nem
 * morrer quando ele travar.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigirAutenticacao } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';
import { estadoDaSincronizacao } from '../services/sincronizacao-service.js';
import { pedirReconciliacao } from '../lib/pedir-reconciliacao.js';

export async function rotasSincronizacao(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/sincronizacao
   *
   * "Os numeros que estou vendo sao de quando?" Barata — le duas linhas
   * de `settings`.
   */
  app.get(
    '/api/sincronizacao',
    { preHandler: exigirAutenticacao },
    async () => estadoDaSincronizacao()
  );

  /**
   * POST /api/sincronizacao/buscar
   *
   * "Busca o que faltou." Enfileira e volta na hora — a varredura leva
   * segundos e nao pode segurar a resposta de um clique.
   *
   * `dia` opcional: sem ele, usa a janela normal; com ele, olha desde a
   * meia-noite daquele dia. Nao ha limite superior de proposito — ler
   * alem do dia pedido e barato, e a idempotencia descarta o repetido.
   */
  app.post(
    '/api/sincronizacao/buscar',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { dia } = z
        .object({ dia: z.string().min(4).optional() })
        .parse(request.body ?? {});

      let desde: Date | undefined;
      if (dia) {
        const d = new Date(dia);
        if (Number.isNaN(d.getTime())) {
          throw new AppError(`"${dia}" não é uma data válida`, 422, 'DATA_INVALIDA');
        }
        d.setHours(0, 0, 0, 0);
        desde = d;
      }

      const pedido = await pedirReconciliacao({ desde, log: request.log });

      return {
        pedido: pedido.enfileirado,
        motivo: pedido.motivo,
        // O estado de ANTES da varredura. A tela reconsulta depois — o
        // trabalho e assincrono, e devolver um estado "pos-varredura"
        // aqui seria mentira.
        antes: await estadoDaSincronizacao(),
      };
    }
  );
}
