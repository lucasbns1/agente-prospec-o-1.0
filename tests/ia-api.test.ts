/**
 * As rotas da IA respondem — e exigem sessao.
 *
 * Typecheck prova que elas compilam; so uma chamada de verdade prova que
 * respondem. A FORMA tambem e conferida aqui: a tela le exatamente estes
 * campos, e um `select` que mude no Prisma nao quebraria o TypeScript do
 * lado do React — quebraria a tela, em producao.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { FastifyInstance } from 'fastify';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });
process.env.LOG_LEVEL = 'silent';

let app: FastifyInstance;
let cookie: string;

beforeAll(async () => {
  const { criarApp } = await import('../apps/api/src/app.js');
  ({ app } = await criarApp());
  await app.ready();
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login',
    payload: {
      email: process.env.SEED_USER_EMAIL ?? 'admin@local',
      senha: process.env.SEED_USER_PASSWORD ?? 'prospector123',
    },
  });
  cookie = login.headers['set-cookie'] as string;
}, 60_000);

afterAll(async () => { await app?.close(); });

describe('rotas da IA', () => {
  it.each(['/api/ia/resumo', '/api/ia/decisoes', '/api/ia/reconciliacao'])(
    '%s responde 200 e exige sessao',
    async (url) => {
      const semSessao = await app.inject({ method: 'GET', url });
      expect(semSessao.statusCode).toBe(401);

      const r = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(r.statusCode).toBe(200);
      expect(() => r.json()).not.toThrow();
    }
  );

  it('o resumo tem a forma que a tela espera', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/ia/resumo', headers: { cookie } });
    const b = r.json();
    for (const campo of ['total', 'divergencias', 'fallbacks', 'porAcao', 'rejeicoes']) {
      expect(b, `faltou ${campo}`).toHaveProperty(campo);
    }
  });

  it('a reconciliacao devolve resumo e achados', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/ia/reconciliacao', headers: { cookie } });
    const b = r.json();
    expect(b.resumo).toHaveProperty('CRITICA');
    expect(Array.isArray(b.achados)).toBe(true);
  });
});
