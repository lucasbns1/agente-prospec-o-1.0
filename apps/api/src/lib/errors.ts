/**
 * Erros da aplicacao e o handler global.
 *
 * REGRA 47 DO BRIEFING: nunca deixar erro silencioso. Todo erro e logado
 * e devolvido ao cliente em um formato previsivel — mas detalhes internos
 * (stack, SQL) nunca vazam para o navegador.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
    readonly codigo: string = 'ERRO_APLICACAO',
    readonly detalhes?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NaoAutenticadoError extends AppError {
  constructor(mensagem = 'Voce precisa entrar para acessar este recurso') {
    super(mensagem, 401, 'NAO_AUTENTICADO');
  }
}

export class NaoEncontradoError extends AppError {
  constructor(recurso = 'Recurso') {
    super(`${recurso} nao encontrado`, 404, 'NAO_ENCONTRADO');
  }
}

export class ValidacaoError extends AppError {
  constructor(mensagem: string, detalhes?: unknown) {
    super(mensagem, 422, 'VALIDACAO', detalhes);
  }
}

export interface RespostaErro {
  erro: {
    codigo: string;
    mensagem: string;
    detalhes?: unknown;
  };
}

export function registrarErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((erro, request: FastifyRequest, reply: FastifyReply) => {
    // Erro de validacao Zod -> 422 com o campo problematico
    if (erro instanceof ZodError) {
      request.log.warn({ issues: erro.issues, url: request.url }, 'Validacao falhou');
      return reply.status(422).send({
        erro: {
          codigo: 'VALIDACAO',
          mensagem: 'Os dados enviados sao invalidos',
          detalhes: erro.issues.map((i) => ({
            campo: i.path.join('.'),
            mensagem: i.message,
          })),
        },
      } satisfies RespostaErro);
    }

    if (erro instanceof AppError) {
      const nivel = erro.statusCode >= 500 ? 'error' : 'warn';
      request.log[nivel]({ err: erro, url: request.url }, erro.message);
      return reply.status(erro.statusCode).send({
        erro: {
          codigo: erro.codigo,
          mensagem: erro.message,
          detalhes: erro.detalhes,
        },
      } satisfies RespostaErro);
    }

    // Qualquer outra coisa e bug nosso: loga completo, responde generico.
    request.log.error({ err: erro, url: request.url }, 'Erro nao tratado');
    return reply.status(500).send({
      erro: {
        codigo: 'ERRO_INTERNO',
        mensagem: 'Erro interno do servidor. Verifique os logs da API.',
      },
    } satisfies RespostaErro);
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      erro: {
        codigo: 'ROTA_NAO_ENCONTRADA',
        mensagem: `Rota ${request.method} ${request.url} nao existe`,
      },
    } satisfies RespostaErro);
  });
}
