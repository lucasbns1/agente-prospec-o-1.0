/**
 * O que fazer quando a conexao cai, por codigo.
 *
 * ============================================================
 * O PINGUE-PONGUE QUE ISTO ACABA
 * ============================================================
 * `440` e `connectionReplaced`: outra sessao assumiu o mesmo numero.
 * Tratado como queda comum, o provedor reconectava — e a reconexao
 * derruba a outra sessao, que reconecta e derruba esta, sem fim.
 *
 * Em uso real: conectava uma copia da ferramenta e a outra caia;
 * conectava a outra e a primeira caia. Parecia conflito ENTRE as
 * copias, e o que havia era o mesmo numero em duas sessoes.
 */
import { describe, expect, it } from 'vitest';
import {
  explicacaoDaQueda,
  reacaoAQueda,
} from './reacao-a-queda.js';

describe('reacaoAQueda', () => {
  /** ESTE e o teste do pingue-pongue. */
  it('440 PARA, em vez de reconectar e derrubar a outra sessao', () => {
    expect(reacaoAQueda(440)).toBe('parar-sessao-assumida');
  });

  /**
   * E nao apaga nada: a credencial do 440 continua valida. Apaga-la
   * jogaria fora uma sessao boa e obrigaria um QR sem motivo.
   */
  it('440 nao e tratado como credencial morta', () => {
    expect(reacaoAQueda(440)).not.toBe('descartar-credencial');
  });

  it('401 e 403 descartam a credencial', () => {
    expect(reacaoAQueda(401)).toBe('descartar-credencial');
    expect(reacaoAQueda(403)).toBe('descartar-credencial');
  });

  it('queda comum continua reconectando', () => {
    // 428 (conexao fechada), 408 (timeout), 515 (restart) e qualquer
    // codigo novo: reconectar e a reacao certa.
    for (const c of [428, 408, 515, 500, 999, null, undefined]) {
      expect(reacaoAQueda(c), `errou em ${String(c)}`).toBe('reconectar');
    }
  });
});

describe('explicacaoDaQueda', () => {
  it('o 440 explica que o numero esta em dois lugares', () => {
    const texto = explicacaoDaQueda(440) ?? '';
    expect(texto).toMatch(/outra sessão assumiu/i);
    expect(texto).toMatch(/número diferente em cada cópia/i);
  });

  it('o 403 diz que parear nao resolve', () => {
    expect(explicacaoDaQueda(403) ?? '').toMatch(/não resolve/i);
  });

  it('o 401 manda ler o QR', () => {
    expect(explicacaoDaQueda(401) ?? '').toMatch(/QR/);
  });

  it('queda comum nao gera explicacao — nao ha nada a fazer', () => {
    expect(explicacaoDaQueda(428)).toBeNull();
  });
});
