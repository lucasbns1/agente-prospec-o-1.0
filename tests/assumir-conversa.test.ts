/**
 * Onde o lead vai parar quando VOCÊ assume a conversa.
 *
 * ============================================================
 * A DECISÃO QUE ESTES TESTES TRAVAM
 * ============================================================
 * A versão óbvia deste código é um `update` direto escrevendo
 * `EM_CONVERSA` e `QUENTE`. Ela está errada de duas maneiras que só
 * aparecem em produção, semanas depois, como números que encolhem
 * sozinhos:
 *
 *   - ressuscita um OPT_OUT;
 *   - rebaixa um CLIENTE para o meio do funil.
 *
 * É por isso que a decisão mora numa função pura, e não dentro do
 * `update`.
 */
import { describe, expect, it } from 'vitest';
import {
  estadoAoAssumirConversa,
  PROXIMA_ACAO_ASSUMIDA,
} from '../packages/domain/src/index.js';

describe('o caso normal', () => {
  it('quem estava esperando resposta vira EM_CONVERSA e QUENTE', () => {
    const e = estadoAoAssumirConversa('AGUARDANDO_RESPOSTA');

    expect(e.status).toBe('EM_CONVERSA');
    expect(e.temperatura).toBe('QUENTE');
    expect(e.proximaAcao).toBe(PROXIMA_ACAO_ASSUMIDA);
  });

  it('quem estava travado esperando por você também sai do limbo', () => {
    // AGUARDANDO_INTERVENCAO é exatamente "precisa de você". Você
    // respondeu: ele não precisa mais.
    expect(estadoAoAssumirConversa('AGUARDANDO_INTERVENCAO').status).toBe(
      'EM_CONVERSA'
    );
  });

  it('um lead frio esquentar é o ponto', () => {
    const e = estadoAoAssumirConversa('EM_CAMPANHA');
    expect(e.temperatura).toBe('QUENTE');
  });
});

describe('quem não se mexe', () => {
  it('OPT_OUT é terminal', () => {
    // Responder "desculpa, já te tirei da lista" não pode devolver o
    // lead ao funil. É a mesma barreira que impede o resto do sistema
    // de voltar a falar com ele.
    const e = estadoAoAssumirConversa('OPT_OUT');

    expect(e.status).toBeNull();
    expect(e.temperatura).toBeNull();
    expect(e.proximaAcao).toBeNull();
  });

  it('CLIENTE não volta para o meio do funil', () => {
    // Se voltasse, o número de fechamentos derreteria sozinho toda vez
    // que você conversa com quem já comprou.
    expect(estadoAoAssumirConversa('CLIENTE').status).toBeNull();
  });

  it('OPORTUNIDADE está adiante de EM_CONVERSA', () => {
    expect(estadoAoAssumirConversa('OPORTUNIDADE').status).toBeNull();
  });
});

describe('borda', () => {
  it('status desconhecido cai no caso normal, e não quebra', () => {
    // Um lead sem status legível não pode fazer a mensagem manual
    // falhar — o pior aceitável é ele virar EM_CONVERSA.
    expect(estadoAoAssumirConversa('').status).toBe('EM_CONVERSA');
    expect(estadoAoAssumirConversa('QUALQUER_COISA').status).toBe('EM_CONVERSA');
  });
});
