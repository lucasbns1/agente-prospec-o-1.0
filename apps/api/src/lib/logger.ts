/**
 * Logger Pino compartilhado pela API.
 *
 * Em desenvolvimento sai colorido e legivel; em producao sai JSON, que e
 * o formato util para inspecionar depois.
 *
 * `redact` existe para o log nunca vazar senha, cookie ou token — mesmo
 * que alguem logue o objeto de request inteiro por engano.
 */
import pino from 'pino';

export function criarLogger(nivel: string, desenvolvimento: boolean) {
  return pino({
    level: nivel,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'senha',
        '*.senha',
        'senhaHash',
        '*.senhaHash',
        'SESSION_SECRET',
        'DATABASE_URL',
      ],
      censor: '[REMOVIDO]',
    },
    ...(desenvolvimento
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              // `SYS:` = fuso da maquina. Sem o prefixo o pino-pretty
              // imprime em UTC, e o log deixa de bater com a tela.
              translateTime: 'SYS:HH:MM:ss',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  });
}

export type Logger = ReturnType<typeof criarLogger>;
