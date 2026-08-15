/**
 * O campo de ritmo passou a ser digitado em minutos.
 *
 * O risco desta mudança não é o rótulo — é o arredondamento. Uma
 * conversão que não preserva a ida e volta transformaria "abrir a tela e
 * salvar sem tocar em nada" numa alteração silenciosa do intervalo de
 * envio. E errar o intervalo para MENOS é disparar rápido demais, que é
 * o padrão que um antispam reconhece.
 */
import { describe, expect, it } from 'vitest';
import { paraMinutos, paraSegundos, descrever } from './duracao.js';

describe('ida e volta', () => {
  it('preserva o valor para múltiplos de 30 segundos', () => {
    for (const s of [0, 30, 60, 90, 120, 180, 240, 300, 600, 3600]) {
      expect(paraSegundos(paraMinutos(s))).toBe(s);
    }
  });

  it('90 segundos não viram 60 nem 120', () => {
    // O caso concreto: abrir a tela com 1,5 min gravado e salvar sem
    // editar não pode mudar a configuração.
    expect(paraMinutos(90)).toBe(1.5);
    expect(paraSegundos(1.5)).toBe(90);
  });
});

describe('paraSegundos', () => {
  it('converte minutos inteiros', () => {
    expect(paraSegundos(1)).toBe(60);
    expect(paraSegundos(3)).toBe(180);
  });

  it('aceita meio minuto', () => {
    expect(paraSegundos(0.5)).toBe(30);
  });

  it('arredonda em vez de truncar', () => {
    // 0,99 é claramente uma tentativa de escrever 1 minuto. Truncar
    // daria 59 segundos.
    expect(paraSegundos(0.99)).toBe(59);
    expect(paraSegundos(1.999)).toBe(120);
  });

  it('campo vazio ou inválido vira 0, nunca NaN', () => {
    // `NaN` no delay faria o agendamento produzir uma data inválida.
    expect(paraSegundos(Number.NaN)).toBe(0);
    expect(paraSegundos(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('negativo vira 0 — não existe espera para trás', () => {
    expect(paraSegundos(-5)).toBe(0);
  });
});

describe('descrever', () => {
  it('abaixo de um minuto fala em segundos', () => {
    // "0,1 min" é ilegível de relance; "6 segundos" não é.
    expect(descrever(6)).toBe('6 segundos');
    expect(descrever(30)).toBe('30 segundos');
  });

  it('minuto no singular', () => {
    expect(descrever(60)).toBe('1 minuto');
  });

  it('minutos exatos no plural', () => {
    expect(descrever(180)).toBe('3 minutos');
  });

  it('mistura minutos e segundos quando não é exato', () => {
    expect(descrever(90)).toBe('1 min 30 s');
    expect(descrever(215)).toBe('3 min 35 s');
  });

  it('zero é "sem espera", não "0 segundos"', () => {
    expect(descrever(0)).toBe('sem espera');
    expect(descrever(-1)).toBe('sem espera');
  });
});
