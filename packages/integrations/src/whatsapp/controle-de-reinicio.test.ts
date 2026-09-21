/**
 * Enquanto a credencial esta sendo trocada, queda nao e queda.
 *
 * ============================================================
 * O CASO REAL
 * ============================================================
 * Log da maquina do usuario, com codigo 401 e a credencial apagada:
 *
 *     Credencial invalida removida   arquivos: 899
 *     "node":{"username":"55119...","msg":"logging in..."}
 *
 * Apagou novecentos arquivos e, em seguida, entrou logando com a MESMA
 * conta — em vez de pedir QR. A reconexao que ganhou a corrida foi a do
 * tratamento de queda, que nao rele o disco e reusa a credencial que
 * ainda esta em memoria: a morta. Daí 401 de novo, e o ciclo fechava
 * sem nunca chegar ao QR.
 */
import { describe, expect, it } from 'vitest';
import { criarControleDeReinicio } from './controle-de-reinicio.js';

describe('criarControleDeReinicio', () => {
  it('fora de uma troca, queda e queda: o tratamento age', () => {
    const c = criarControleDeReinicio();
    expect(c.devoTratarQueda()).toBe(true);
    expect(c.reiniciando).toBe(false);
  });

  /**
   * ESTE e o teste do defeito. O encerramento do socket antigo e PARTE
   * da troca — tratá-lo como queda agenda a reconexao que reusa a
   * credencial morta, e ela chega antes da nossa.
   */
  it('durante a troca, a queda provocada por nos e ignorada', () => {
    const c = criarControleDeReinicio();

    c.comecar();

    expect(c.reiniciando).toBe(true);
    expect(c.devoTratarQueda()).toBe(false);
    // Varias quedas no intervalo — o `end` pode emitir mais de uma.
    expect(c.devoTratarQueda()).toBe(false);
  });

  /**
   * Liberar cedo devolveria a corrida. So depois que a conexao nova
   * esta de pe (ou falhou de vez) as quedas voltam a valer.
   */
  it('depois da troca, o tratamento volta a valer', () => {
    const c = criarControleDeReinicio();

    c.comecar();
    c.terminar();

    expect(c.reiniciando).toBe(false);
    expect(c.devoTratarQueda()).toBe(true);
  });

  it('terminar sem ter comecado nao quebra nada', () => {
    const c = criarControleDeReinicio();
    c.terminar();
    expect(c.devoTratarQueda()).toBe(true);
  });
});
