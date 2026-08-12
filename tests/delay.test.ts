/**
 * Testes do calculo de delay.
 *
 * O `rng` e injetado para os testes serem deterministicos — sem isso,
 * testar aleatoriedade viraria uma aposta.
 */
import { describe, expect, it } from 'vitest';
import {
  sortearDelaySegundos,
  sortearDelayMs,
  calcularProximoEnvio,
  resolverIntervalo,
  DELAY_PADRAO_MENSAGENS,
  DELAY_PADRAO_ENTRE_LEADS,
} from '../packages/domain/src/delay.js';

describe('sortearDelaySegundos', () => {
  it('devolve o minimo quando o sorteio da 0', () => {
    expect(sortearDelaySegundos({ minSegundos: 180, maxSegundos: 240 }, () => 0)).toBe(180);
  });

  it('devolve o maximo quando o sorteio da quase 1', () => {
    expect(
      sortearDelaySegundos({ minSegundos: 180, maxSegundos: 240 }, () => 0.9999)
    ).toBe(240);
  });

  it('devolve um valor intermediario', () => {
    expect(sortearDelaySegundos({ minSegundos: 180, maxSegundos: 240 }, () => 0.5)).toBe(210);
  });

  it('nunca sai do intervalo, em 2000 sorteios reais', () => {
    for (let i = 0; i < 2000; i++) {
      const v = sortearDelaySegundos(DELAY_PADRAO_MENSAGENS);
      expect(v).toBeGreaterThanOrEqual(180);
      expect(v).toBeLessThanOrEqual(240);
    }
  });

  it('NAO e um valor fixo — um delay constante seria um padrao obvio de automacao', () => {
    const valores = new Set(
      Array.from({ length: 200 }, () => sortearDelaySegundos(DELAY_PADRAO_MENSAGENS))
    );
    // Com 61 valores possiveis, 200 sorteios devem produzir muitos distintos.
    expect(valores.size).toBeGreaterThan(20);
  });

  it('aceita intervalo degenerado (min === max)', () => {
    expect(sortearDelaySegundos({ minSegundos: 100, maxSegundos: 100 })).toBe(100);
  });

  it('rejeita max menor que min em vez de enviar sem espacamento', () => {
    expect(() => sortearDelaySegundos({ minSegundos: 240, maxSegundos: 180 })).toThrow(
      /menor que min/
    );
  });

  it('rejeita valores negativos', () => {
    expect(() => sortearDelaySegundos({ minSegundos: -1, maxSegundos: 10 })).toThrow(
      /negativos/
    );
  });

  it('rejeita valores nao finitos', () => {
    expect(() =>
      sortearDelaySegundos({ minSegundos: Number.NaN, maxSegundos: 10 })
    ).toThrow(/finitos/);
  });
});

describe('sortearDelayMs', () => {
  it('converte para milissegundos (formato que o BullMQ espera)', () => {
    expect(sortearDelayMs({ minSegundos: 180, maxSegundos: 180 })).toBe(180_000);
  });
});

describe('calcularProximoEnvio', () => {
  it('soma o delay ao instante informado', () => {
    const agora = new Date('2026-01-01T10:00:00.000Z');
    const proximo = calcularProximoEnvio(
      { minSegundos: 180, maxSegundos: 240 },
      agora,
      () => 0
    );
    expect(proximo.toISOString()).toBe('2026-01-01T10:03:00.000Z');
  });
});

describe('resolverIntervalo', () => {
  const campanha = { minSegundos: 180, maxSegundos: 240 };

  it('usa o da campanha quando a etapa nao sobrescreve', () => {
    expect(resolverIntervalo(campanha, null)).toEqual(campanha);
    expect(resolverIntervalo(campanha, { minSegundos: null, maxSegundos: null })).toEqual(
      campanha
    );
  });

  it('deixa a etapa sobrescrever', () => {
    expect(resolverIntervalo(campanha, { minSegundos: 600, maxSegundos: 900 })).toEqual({
      minSegundos: 600,
      maxSegundos: 900,
    });
  });

  it('permite sobrescrever apenas um dos lados', () => {
    expect(resolverIntervalo(campanha, { minSegundos: 300, maxSegundos: null })).toEqual({
      minSegundos: 300,
      maxSegundos: 240,
    });
  });
});

describe('valores padrao', () => {
  it('mensagens: 3 a 4 minutos', () => {
    expect(DELAY_PADRAO_MENSAGENS).toEqual({ minSegundos: 180, maxSegundos: 240 });
  });

  it('entre leads: 60 a 180 segundos', () => {
    expect(DELAY_PADRAO_ENTRE_LEADS).toEqual({ minSegundos: 60, maxSegundos: 180 });
  });
});
