/**
 * O relatorio semanal.
 *
 * Duas rotas: a lista de semanas que tiveram envio (o calendario), e o
 * relatorio de uma delas.
 *
 * Separadas porque servem a dois momentos: a lista carrega junto com a
 * tela e e barata; o relatorio so e montado quando voce clica numa
 * semana, e varre todas as respostas dos leads abordados.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigirAutenticacao } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';
import {
  semanasComAtividade,
  relatorioDaSemana,
} from '../services/semana-service.js';

export async function rotasSemanas(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/semanas',
    { preHandler: exigirAutenticacao },
    async () => ({ semanas: await semanasComAtividade() })
  );

  /**
   * GET /api/semanas/:inicio
   *
   * `inicio` e uma data ISO. Nao precisa ser exatamente o domingo —
   * qualquer dia da semana serve, e o dominio normaliza. Isso evita que
   * uma hora de diferenca de fuso na tela puxe a semana errada.
   */
  app.get<{ Params: { inicio: string } }>(
    '/api/semanas/:inicio',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { inicio } = z
        .object({ inicio: z.string().min(4) })
        .parse(request.params);

      const quando = new Date(inicio);
      if (Number.isNaN(quando.getTime())) {
        throw new AppError(
          `"${inicio}" não é uma data válida`,
          422,
          'DATA_INVALIDA'
        );
      }

      return relatorioDaSemana(quando);
    }
  );
}
