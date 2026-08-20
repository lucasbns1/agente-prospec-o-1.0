/**
 * O que da para saber sobre uma chave sem olhar para ela.
 *
 * ============================================================
 * POR QUE ISTO EXISTE
 * ============================================================
 * "API key not valid" e a resposta do Google, e ela nao distingue chave
 * revogada de chave que nunca foi uma chave. Uma `GEMINI_API_KEY` com
 * 104 caracteres nao pode ser uma chave do AI Studio — elas tem 39 e
 * comecam com `AIza`. Da para dizer isso ANTES de gastar a chamada, e sem
 * a chave aparecer em lugar nenhum.
 *
 * ============================================================
 * A REGRA DA CASA CONTINUA VALENDO
 * ============================================================
 * Nada aqui devolve a chave, nem pedaco dela. Todo retorno e booleano ou
 * numero. O que sai na tela e "comeca com AIza: nao", nunca o que ela
 * comeca de verdade — porque terminal vira print, e print vira grupo de
 * WhatsApp.
 *
 * Esta funcao e PURA e sem I/O: recebe o texto, devolve o diagnostico.
 * Por isso da para testa-la de verdade, com chaves fabricadas.
 */

/**
 * Faixa de tamanho aceitavel para uma chave do AI Studio.
 *
 * ============================================================
 * POR QUE UMA FAIXA, E NAO O NUMERO 39
 * ============================================================
 * A primeira versao disto exigia exatamente 39 caracteres, que era o
 * tamanho das chaves antigas. Uma chave nova, recem-criada e VALIDA, veio
 * com 53 — e a checagem teria dito ao dono que a chave dele estava
 * errada, no exato momento em que ela passou a funcionar.
 *
 * Um diagnostico que acusa o que esta certo e pior que nenhum: manda a
 * pessoa desfazer o que deu certo. Entao a regra ficou frouxa de
 * proposito. O que realmente separa chave de nao-chave e o prefixo
 * `AIza`; o tamanho so serve para pegar coisa absurda, como um comando de
 * PowerShell inteiro colado no lugar da chave.
 */
export const TAMANHO_MINIMO = 30;
export const TAMANHO_MAXIMO = 80;

/** Como toda chave do AI Studio comeca. */
const PREFIXO_AI_STUDIO = 'AIza';

export interface FormatoDaChave {
  /** Tamanho depois de tirar espaco das pontas. */
  comprimento: number;
  /** Tem cara de chave do AI Studio: prefixo e tamanho certos. */
  pareceAiStudio: boolean;
  /**
   * O que esta errado, em portugues, pronto para imprimir. Vazio quando
   * o formato esta plausivel — o que NAO garante que a chave valha; so o
   * Google sabe disso.
   */
  problemas: string[];
}

export function conferirFormatoDaChave(bruta: string): FormatoDaChave {
  const chave = bruta.trim();
  const problemas: string[] = [];

  // --- Coisas que vieram junto por engano ---
  //
  // Sao os erros de copiar e colar, e sao os mais comuns. Cada um deles
  // produz exatamente o mesmo "API key not valid" do Google.
  if (/^["']|["']$/.test(chave)) {
    problemas.push('esta entre aspas — tire as aspas do .env');
  }
  if (/^GEMINI_API_KEY\s*=/i.test(chave)) {
    problemas.push('o valor inclui "GEMINI_API_KEY=" — deixe so o que vem depois do =');
  }
  if (/\s/.test(chave)) {
    problemas.push('tem espaco ou quebra de linha no meio — deve ser uma linha unica');
  }

  // --- Coisas que sao outra credencial ---
  if (chave.startsWith('ya29.')) {
    problemas.push('isto e um token OAuth do Google, nao uma API key do AI Studio');
  }
  if (chave.startsWith('{') || chave.includes('"private_key"')) {
    problemas.push('isto e um JSON de conta de servico, nao uma API key');
  }

  // Duas ocorrencias do prefixo = a chave foi colada duas vezes. Explica
  // um tamanho perto do dobro sem nenhum outro sintoma.
  const ocorrencias = chave.split(PREFIXO_AI_STUDIO).length - 1;
  if (ocorrencias > 1) {
    problemas.push(`o prefixo "${PREFIXO_AI_STUDIO}" aparece ${ocorrencias}x — a chave foi colada mais de uma vez`);
  }

  // --- A forma em si ---
  const temPrefixo = chave.startsWith(PREFIXO_AI_STUDIO);
  const temTamanho = chave.length >= TAMANHO_MINIMO && chave.length <= TAMANHO_MAXIMO;

  if (!temPrefixo && ocorrencias === 0) {
    problemas.push(`nao comeca com "${PREFIXO_AI_STUDIO}" — toda chave do AI Studio comeca`);
  }
  if (!temTamanho) {
    problemas.push(
      `tem ${chave.length} caracteres, fora da faixa esperada ` +
        `(${TAMANHO_MINIMO} a ${TAMANHO_MAXIMO})`
    );
  }

  return {
    comprimento: chave.length,
    pareceAiStudio: temPrefixo && temTamanho && ocorrencias === 1,
    problemas,
  };
}
