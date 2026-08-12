/**
 * Autenticacao local por sessao em cookie.
 *
 * DECISOES E POR QUE:
 *
 * 1. Argon2id para a senha. E o algoritmo recomendado atualmente e o
 *    unico do projeto que precisa ser lento de proposito.
 *
 * 2. O cookie guarda um token aleatorio de 32 bytes; o banco guarda
 *    apenas o SHA-256 desse token. Se alguem ler a tabela `sessions`,
 *    nao consegue montar um cookie valido.
 *
 * 3. httpOnly + sameSite=lax + path=/ . `secure` fica desligado porque o
 *    sistema roda em http://localhost — um cookie `secure` simplesmente
 *    nao seria enviado e o login nunca funcionaria.
 *
 * 4. Nada de JWT: com sessao em banco, deslogar e apagar uma linha. Com
 *    JWT seria preciso manter uma blacklist — mais complexidade, zero
 *    beneficio para um sistema local monousuario.
 */
import crypto from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@prospector/database';
import { NaoAutenticadoError } from '../lib/errors.js';

export const COOKIE_SESSAO = 'prospector_session';

declare module 'fastify' {
  interface FastifyRequest {
    usuario?: { id: string; email: string; nome: string };
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function verificarSenha(hash: string, senha: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, senha);
  } catch {
    return false;
  }
}

export async function gerarHashSenha(senha: string): Promise<string> {
  return argon2.hash(senha, { type: argon2.argon2id });
}

export async function criarSessao(
  userId: string,
  ttlDias: number,
  meta: { userAgent?: string; ip?: string }
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlDias * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    },
  });

  return { token, expiresAt };
}

export async function destruirSessao(token: string): Promise<void> {
  await prisma.session
    .delete({ where: { tokenHash: hashToken(token) } })
    .catch(() => undefined); // ja apagada — nao e erro
}

/** Remove sessoes expiradas. Chamado no boot da API. */
export async function limparSessoesExpiradas(): Promise<number> {
  const r = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return r.count;
}

/**
 * Hook de autenticacao. Use com `preHandler` nas rotas protegidas.
 * NUNCA confia em nada vindo do cliente alem do cookie assinado.
 */
export async function exigirAutenticacao(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const token = request.cookies[COOKIE_SESSAO];
  if (!token) throw new NaoAutenticadoError();

  const sessao = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!sessao) throw new NaoAutenticadoError('Sessao invalida');

  if (sessao.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: sessao.id } }).catch(() => undefined);
    throw new NaoAutenticadoError('Sessao expirada. Entre novamente.');
  }

  if (!sessao.user.ativo) throw new NaoAutenticadoError('Usuario desativado');

  request.usuario = {
    id: sessao.user.id,
    email: sessao.user.email,
    nome: sessao.user.nome,
  };
}

export function opcoesCookie(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // Desligado de proposito: o sistema roda em http://localhost.
    // Se algum dia for exposto por HTTPS, ligar aqui.
    secure: false,
    path: '/',
    expires: expiresAt,
  };
}

export async function registrarAuth(_app: FastifyInstance): Promise<void> {
  const removidas = await limparSessoesExpiradas();
  if (removidas > 0) {
    _app.log.info({ removidas }, 'Sessoes expiradas removidas');
  }
}
