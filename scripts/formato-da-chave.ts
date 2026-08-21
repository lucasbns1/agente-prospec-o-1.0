/**
 * Os erros de copiar-e-colar que estragam uma GEMINI_API_KEY.
 *
 * ============================================================
 * O QUE ESTA FUNCAO APRENDEU A NAO FAZER
 * ============================================================
 * A primeira versao disto conferia o TAMANHO da chave (39 caracteres) e
 * o PREFIXO (`AIza`). As duas regras acusaram de errada, em dias
 * seguidos, a mesma chave — uma chave recem-criada no AI Studio que
 * autenticava sem problema nenhum: veio com 53 caracteres e sem aquele
 * prefixo.
 *
 * A licao nao e "ajustar os numeros". E que o formato das credenciais do
 * Google e problema do Google: ele muda quando quiser, sem avisar, e
 * qualquer regra escrita aqui envelhece sozinha. Um diagnostico que
 * envelhece nao fica so inutil — ele passa a mandar a pessoa trocar o que
 * esta funcionando, que e o pior conselho possivel.
 *
 * Entao sobrou o que NAO depende do Google: os erros de digitacao e de
 * colagem, que sao nossos e nao mudam. Aspas do .env, o nome da variavel
 * grudado no valor, espaco no meio, a chave colada duas vezes, e as duas
 * credenciais que as pessoas confundem com API key. Todos produzem o
 * mesmo "API key not valid" generico, e nenhum deles precisa saber quanto
 * mede uma chave.
 *
 * Quem decide se a chave vale e o Google. Isto aqui so tira do caminho as
 * chances de a pergunta nem chegar la.
 *
 * ============================================================
 * A REGRA DA CASA
 * ============================================================
 * Nada aqui devolve a chave, nem pedaco dela — so booleanos, numeros e
 * frases fixas. Terminal vira print, e print vira grupo de WhatsApp.
 *
 * Funcao PURA, sem I/O: recebe o texto, devolve o diagnostico. Por isso
 * da para testa-la com chaves fabricadas.
 */

export interface FormatoDaChave {
  /** Tamanho depois de tirar espaco das pontas. Informativo, nunca julgado. */
  comprimento: number;
  /**
   * O que esta comprovadamente errado, em portugues, pronto para
   * imprimir. Vazio quer dizer "nao encontrei erro de colagem" — e NAO
   * quer dizer que a chave vale. So o Google sabe disso.
   */
  problemas: string[];
}

export function conferirFormatoDaChave(bruta: string): FormatoDaChave {
  const chave = bruta.trim();
  const problemas: string[] = [];

  // --- Coisas que vieram junto por engano ---
  if (/^["']|["']$/.test(chave)) {
    problemas.push('esta entre aspas — tire as aspas do .env');
  }
  if (/^GEMINI_API_KEY\s*=/i.test(chave)) {
    problemas.push('o valor inclui "GEMINI_API_KEY=" — deixe so o que vem depois do =');
  }
  if (/\s/.test(chave)) {
    problemas.push('tem espaco ou quebra de linha no meio — deve ser uma linha unica');
  }

  // Um comando inteiro no lugar da chave. Ja aconteceu: um `Select-String`
  // de PowerShell colado dentro do .env, com 104 caracteres, que o script
  // mandou obedientemente para o Google.
  if (/[|<>;]|\$_|\bForEach-Object\b|\bSelect-String\b/.test(chave)) {
    problemas.push('parece um comando de terminal, nao uma chave — cole so a chave');
  }

  // --- Coisas que sao outra credencial ---
  if (chave.startsWith('ya29.')) {
    problemas.push('isto e um token OAuth do Google, nao uma API key do AI Studio');
  }
  if (chave.startsWith('{') || chave.includes('"private_key"')) {
    problemas.push('isto e um JSON de conta de servico, nao uma API key');
  }

  // A mesma chave colada duas vezes seguidas. Detectado pela repeticao em
  // si, e nao por um prefixo conhecido — o prefixo e justamente a parte
  // que ja errou duas vezes aqui.
  //
  // A exigencia de VARIEDADE na metade nao e detalhe: sem ela, uma chave
  // formada por poucos caracteres distintos ("zzzz...") tem as duas
  // metades iguais por acidente e seria acusada. Foi o proprio teste
  // desta funcao que pegou isso — que e para o que ele serve.
  const meio = Math.floor(chave.length / 2);
  const primeiraMetade = chave.slice(0, meio);
  const variedade = new Set(primeiraMetade).size;
  if (
    chave.length >= 20 &&
    chave.length % 2 === 0 &&
    variedade >= 10 &&
    primeiraMetade === chave.slice(meio)
  ) {
    problemas.push('o valor e a mesma coisa repetida duas vezes — cole a chave uma vez so');
  }

  return { comprimento: chave.length, problemas };
}
