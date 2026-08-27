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
  fichaDoDia,
} from '../services/semana-service.js';
import { lerMensagensDoDia } from '../services/leitura-do-dia-service.js';

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

  /**
   * GET /api/dias/:data/ficha
   *
   * A ficha do dia por nicho — "o dia que eu mandei". O recorte e a
   * turma de quem recebeu alguma coisa naquele dia; tudo o mais e sobre
   * essas pessoas, em qualquer data.
   */
  app.get<{ Params: { data: string } }>(
    '/api/dias/:data/ficha',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { data } = z.object({ data: z.string().min(4) }).parse(request.params);

      const quando = new Date(data);
      if (Number.isNaN(quando.getTime())) {
        throw new AppError(`"${data}" não é uma data válida`, 422, 'DATA_INVALIDA');
      }

      return fichaDoDia(quando);
    }
  );

  /**
   * POST /api/dias/:data/ler
   *
   * Pede ao Gemini para LER as respostas daquele dia e extrair dois
   * sinais que o dicionario nao da: quem pediu previa, e qual foi a
   * objecao.
   *
   * NAO decide nada — nao enfileira, nao pausa, nao muda status. Por
   * isso pode rodar sobre historico antigo, e por isso cobre tambem as
   * conversas que voce tocou na mao.
   *
   * POST porque gasta: cada mensagem e uma chamada paga ao modelo.
   */
  app.post<{ Params: { data: string } }>(
    '/api/dias/:data/ler',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { data } = z.object({ data: z.string().min(4) }).parse(request.params);
      const { forcar } = z
        .object({ forcar: z.boolean().default(false) })
        .parse(request.body ?? {});

      const quando = new Date(data);
      if (Number.isNaN(quando.getTime())) {
        throw new AppError(`"${data}" não é uma data válida`, 422, 'DATA_INVALIDA');
      }

      return lerMensagensDoDia({ quando, forcar });
    }
  );
}
