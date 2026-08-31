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
import { pedirReconciliacao } from '../lib/pedir-reconciliacao.js';
import { estadoDaSincronizacao } from '../services/sincronizacao-service.js';

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

  // ============================================================
  // DUAS OPERACOES QUE UM NOME SO ESCONDIA
  // ============================================================
  // "Ler o dia" fazia UMA coisa — extrair sinais das mensagens que ja
  // estavam no banco — e o nome sugeria outra. Se uma resposta nunca
  // chegou pelo evento do WhatsApp, ela nao estava no banco, e o botao
  // nao tinha o que ler. Ele nao abria o WhatsApp, nao buscava conversa,
  // nao comparava nada.
  //
  // Agora sao tres rotas com semantica explicita:
  //
  //   /extrair      — so interpreta o que ja esta aqui (o antigo "ler")
  //   /reconciliar  — busca no WhatsApp o que faltou, E interpreta
  //   /ler          — alias de /reconciliar, para o botao antigo
  //
  // A separacao importa porque as duas custam coisas diferentes:
  // extrair gasta chamadas ao modelo; reconciliar gasta tempo do
  // Chromium. Quem quer so uma nao deveria pagar as duas.

  /** Interpreta o que ja esta no banco. Nao busca nada. */
  const rotaExtrair = async (request: {
    params: unknown;
    body: unknown;
  }): Promise<unknown> => {
    const { data } = z.object({ data: z.string().min(4) }).parse(request.params);
    const { forcar } = z
      .object({ forcar: z.boolean().default(false) })
      .parse(request.body ?? {});

    const quando = new Date(data);
    if (Number.isNaN(quando.getTime())) {
      throw new AppError(`"${data}" não é uma data válida`, 422, 'DATA_INVALIDA');
    }

    return lerMensagensDoDia({ quando, forcar });
  };

  app.post<{ Params: { data: string } }>(
    '/api/dias/:data/extrair',
    { preHandler: exigirAutenticacao },
    rotaExtrair
  );

  /**
   * POST /api/dias/:data/reconciliar
   *
   * As duas metades, na ordem que faz sentido.
   *
   * ============================================================
   * A BUSCA E ASSINCRONA, E A RESPOSTA DIZ ISSO
   * ============================================================
   * Quem tem a sessao do WhatsApp e o worker; a API so enfileira. Entao
   * a extracao desta chamada roda sobre o que JA estava no banco — as
   * mensagens que a varredura trouxer agora entram na proxima passada.
   *
   * A alternativa seria segurar a resposta ate a varredura terminar, o
   * que travaria a tela por dezenas de segundos e ainda dependeria de o
   * worker estar de pe. Prefiro devolver na hora e dizer a verdade
   * sobre o que ficou para depois.
   */
  const rotaReconciliar = async (request: {
    params: unknown;
    body: unknown;
    log?: { error: (obj: unknown, msg: string) => void };
  }): Promise<unknown> => {
    const { data } = z.object({ data: z.string().min(4) }).parse(request.params);

    const quando = new Date(data);
    if (Number.isNaN(quando.getTime())) {
      throw new AppError(`"${data}" não é uma data válida`, 422, 'DATA_INVALIDA');
    }

    // 1. Buscar no WhatsApp o que faltou daquele dia.
    const inicio = new Date(quando);
    inicio.setHours(0, 0, 0, 0);
    const busca = await pedirReconciliacao({ desde: inicio, log: request.log });

    // 2. Interpretar o que ja esta aqui.
    const extracao = await rotaExtrair(request);

    return {
      busca: {
        pedida: busca.enfileirado,
        motivo: busca.motivo,
        detalhe: busca.enfileirado
          ? 'A varredura foi pedida ao worker. As mensagens que ela trouxer entram na próxima extração.'
          : 'Não foi possível pedir a varredura — a periódica cobre na próxima volta.',
      },
      extracao,
      sincronizacao: await estadoDaSincronizacao(),
    };
  };

  app.post<{ Params: { data: string } }>(
    '/api/dias/:data/reconciliar',
    { preHandler: exigirAutenticacao },
    rotaReconciliar
  );

  /**
   * Alias do antigo "ler o dia".
   *
   * Mantido porque a rota ja esta em uso, mas com a semantica NOVA: ele
   * reconcilia. Deixar o endpoint antigo fazendo menos do que o nome
   * promete foi justamente o problema.
   */
  app.post<{ Params: { data: string } }>(
    '/api/dias/:data/ler',
    { preHandler: exigirAutenticacao },
    rotaReconciliar
  );
}
