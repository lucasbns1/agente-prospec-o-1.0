/**
 * Testes da validacao de ambiente.
 *
 * O objetivo aqui e garantir que o processo NAO SOBE com configuracao
 * invalida. Descobrir que o SESSION_SECRET estava vazio no meio de uma
 * campanha seria muito pior do que falhar no boot.
 */
import { describe, expect, it } from 'vitest';
import { carregarEnv, modoDryRun } from '../packages/config/src/index.js';

const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SESSION_SECRET: 'a'.repeat(48),
};

describe('carregarEnv', () => {
  it('aceita a configuracao minima e aplica os padroes', () => {
    const env = carregarEnv(BASE as NodeJS.ProcessEnv);

    expect(env.API_PORT).toBe(3333);
    expect(env.REDIS_PORT).toBe(6379);
    expect(env.WHATSAPP_MODE).toBe('dry-run');
    expect(env.NODE_ENV).toBe('development');
  });

  it('exige DATABASE_URL', () => {
    expect(() =>
      carregarEnv({ SESSION_SECRET: 'a'.repeat(48) } as NodeJS.ProcessEnv)
    ).toThrow(/DATABASE_URL/);
  });

  it('recusa SESSION_SECRET curto e explica como gerar um', () => {
    expect(() =>
      carregarEnv({ ...BASE, SESSION_SECRET: 'curto' } as NodeJS.ProcessEnv)
    ).toThrow(/32 caracteres/);
  });

  it('converte portas de string para numero', () => {
    const env = carregarEnv({ ...BASE, API_PORT: '4000' } as NodeJS.ProcessEnv);
    expect(env.API_PORT).toBe(4000);
  });
});

describe('modoDryRun', () => {
  it('so desliga a simulacao com exatamente "live"', () => {
    expect(modoDryRun(carregarEnv({ ...BASE, WHATSAPP_MODE: 'live' } as NodeJS.ProcessEnv))).toBe(
      false
    );

    for (const v of ['dry-run', 'liv', 'LIVEE', 'true', '']) {
      expect(
        modoDryRun(carregarEnv({ ...BASE, WHATSAPP_MODE: v } as NodeJS.ProcessEnv))
      ).toBe(true);
    }
  });
});
