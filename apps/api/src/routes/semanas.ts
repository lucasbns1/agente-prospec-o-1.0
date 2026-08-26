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
  diasComAtividade,
  relatorioDaSemana,
  resumoDoDia,
} from '../services/semana-service.js';

export async function rotasSemanas(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/semanas',
    { preHandler: exigirAutenticacao },
    async () => {
      // As duas listas juntas: o calendario precisa das duas para
      // desenhar uma tela so, e sao duas varreduras da mesma tabela.
      const [semanas, dias] = await Promise.all([
        semanasComAtividade(),
        diasComAtividade(),
      ]);
      return { semanas, dias };
    }
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

  /**
   * GET /api/dias/:data
   *
   * O resumo de um dia. A semana responde "a abordagem funciona?"; o dia
   * responde "o que saiu na terca, e o que voltou?" — a pergunta que
   * voce faz quando um numero da semana parece estranho.
   */
  app.get<{ Params: { data: string } }>(
    '/api/dias/:data',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { data } = z
        .object({ data: z.string().min(4) })
        .parse(request.params);

      const quando = new Date(data);
      if (Number.isNaN(quando.getTime())) {
        throw new AppError(`"${data}" não é uma data válida`, 422, 'DATA_INVALIDA');
      }

      return resumoDoDia(quando);
    }
  );
}
