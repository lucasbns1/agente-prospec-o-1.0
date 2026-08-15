/**
 * Conversao entre o que voce DIGITA (minutos) e o que o banco GUARDA
 * (segundos).
 *
 * ============================================================
 * POR QUE O BANCO CONTINUA EM SEGUNDOS
 * ============================================================
 * O agendamento, o despachante e os testes todos falam em segundos.
 * Trocar a unidade no fundo significaria mexer em todos eles para
 * ganhar nada — o problema nunca foi o armazenamento.
 *
 * O problema era a UNIDADE QUE VOCE DIGITA. Ninguem pensa "quero 180
 * segundos entre as mensagens"; pensa "quero 3 minutos". Digitar 180
 * querendo 3 minutos e um erro por um fator de 60 — e errar para menos
 * aqui significa disparar rapido demais, que e exatamente o padrao que
 * um antispam reconhece.
 *
 * ============================================================
 * O ARREDONDAMENTO E O RISCO REAL
 * ============================================================
 * 90 segundos sao 1,5 minutos. Se o campo so aceitasse inteiros, abrir
 * a tela e salvar sem tocar em nada transformaria 90 em 60 ou 120 — uma
 * configuracao alterada sem ninguem pedir, e sem ninguem perceber.
 *
 * Por isso a ida e volta preserva o valor: `paraSegundos(paraMinutos(x))`
 * devolve `x` para qualquer inteiro de segundos multiplo de 30, e o
 * campo aceita passo de 0,5.
 *
 * Isto e uma funcao pura, em arquivo `.ts` separado do componente, para
 * poder ser testada sem montar React.
 */

/** Segundos -> minutos, para exibir no campo. */
export function paraMinutos(segundos: number): number {
  return segundos / 60;
}

/**
 * Minutos -> segundos, para gravar.
 *
 * `Math.round` e nao `Math.floor`: 0,99 min e claramente uma tentativa
 * de escrever 1 minuto, e truncar daria 59 segundos.
 *
 * Entrada nao-finita vira 0 em vez de `NaN`. Um campo apagado no meio
 * da digitacao nao pode gravar lixo no banco — e `NaN` no delay faria o
 * agendamento produzir uma data invalida.
 */
export function paraSegundos(minutos: number): number {
  if (!Number.isFinite(minutos) || minutos < 0) return 0;
  return Math.round(minutos * 60);
}

/**
 * Traduz o valor para linguagem de gente.
 *
 * Existe porque "0,5 min" e mais dificil de conferir de relance que
 * "30 segundos" — e conferir de relance e exatamente o que voce faz
 * antes de mandar mensagem para gente de verdade.
 */
export function descrever(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos <= 0) return 'sem espera';

  const inteiro = Math.round(segundos);
  if (inteiro < 60) return `${inteiro} segundos`;

  const m = Math.floor(inteiro / 60);
  const s = inteiro % 60;

  if (s === 0) return m === 1 ? '1 minuto' : `${m} minutos`;
  return `${m} min ${s} s`;
}
