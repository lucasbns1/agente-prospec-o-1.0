/**
 * Onde o lead vai parar no quadro quando VOCE assume a conversa.
 *
 * ============================================================
 * O PROBLEMA
 * ============================================================
 * Voce respondia o lead pelo celular, na mao, e o dashboard continuava
 * mostrando ele como "aguardando resposta", frio, na mesma coluna de
 * quem nunca falou com voce. O quadro mentia sobre onde a prospeccao
 * estava — justamente nos leads mais avancados, que sao os que voce
 * achou que valiam o seu tempo.
 *
 * Uma conversa que voce esta tocando na mao e o estado mais quente que
 * existe aqui: alguem respondeu, e voce entrou. `EM_CONVERSA` e
 * `QUENTE` dizem exatamente isso.
 *
 * ============================================================
 * POR QUE ISTO NAO E UM UPDATE DIRETO
 * ============================================================
 * Escrever `EM_CONVERSA` sem olhar o estado atual REBAIXA gente:
 *
 *   - OPT_OUT e terminal e irreversivel. Se o lead pediu para parar e
 *     voce responde "desculpa, ja tirei da lista", essa mensagem NAO
 *     pode ressuscitar o lead — e a mesma barreira que impede o resto do
 *     sistema de voltar a falar com ele.
 *
 *   - OPORTUNIDADE e CLIENTE estao ADIANTE de EM_CONVERSA. Mandar um
 *     "bom dia" para um cliente fechado nao pode empurrar ele de volta
 *     para o meio do funil, ou os numeros de fechamento derretem sozinhos
 *     toda vez que voce conversa com quem ja comprou.
 *
 * Funcao pura: recebe o status atual, devolve o que gravar. Sem I/O,
 * para o desenho poder ser conferido sem subir banco.
 */

/**
 * Estados que NAO se mexem quando voce manda uma mensagem na mao.
 *
 * OPT_OUT por barreira; os outros dois por ja estarem adiante.
 */
const NAO_REBAIXAR = new Set(['OPT_OUT', 'OPORTUNIDADE', 'CLIENTE']);

export interface EstadoAoAssumir {
  /** `null` quando o status atual nao deve ser tocado. */
  status: 'EM_CONVERSA' | null;
  /** `null` quando a temperatura nao deve ser tocada. */
  temperatura: 'QUENTE' | null;
  /** `null` quando nao ha o que escrever em `proximaAcao`. */
  proximaAcao: string | null;
}

export const PROXIMA_ACAO_ASSUMIDA = 'Você está conduzindo esta conversa';

export function estadoAoAssumirConversa(statusAtual: string): EstadoAoAssumir {
  if (NAO_REBAIXAR.has(statusAtual)) {
    return { status: null, temperatura: null, proximaAcao: null };
  }

  return {
    status: 'EM_CONVERSA',
    temperatura: 'QUENTE',
    proximaAcao: PROXIMA_ACAO_ASSUMIDA,
  };
}
