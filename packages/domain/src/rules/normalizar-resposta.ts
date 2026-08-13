/**
 * Normalizacao de uma resposta recebida, antes da classificacao.
 *
 * FILOSOFIA: normalizacao CONSERVADORA. Cada transformacao aqui pode
 * criar um falso positivo — "nao" virando "sim" por um typo mal
 * corrigido faria o sistema mandar uma proposta para quem recusou.
 *
 * Por isso: corrigimos apenas variacoes inequivocas (acento, caixa,
 * pontuacao, alongamento de vogal, abreviacoes consagradas). NAO ha
 * fuzzy matching por distancia de edicao — ele confundiria "nao" com
 * "sao", "mao", "pao".
 *
 * O texto original e sempre preservado para auditoria.
 */

/** Emojis com significado razoavelmente estavel em prospeccao. */
export const EMOJI_POSITIVO = ['👍', '👌', '✅', '🆗', '🙌', '💪'];
/** Emojis ambiguos: NUNCA disparam acao sozinhos. */
export const EMOJI_AMBIGUO = ['😂', '🤣', '❤️', '❤', '🙏', '🔥', '😅', '😊', '🤝', '👏', '😍'];
/** Emojis com carga negativa. */
export const EMOJI_NEGATIVO = ['👎', '🚫', '❌', '😡', '🤬', '😠'];

/**
 * Abreviacoes SEGURAS do portugues informal.
 *
 * Criterio para entrar nesta lista: a expansao precisa ser a unica
 * leitura plausivel no contexto de uma conversa comercial. "vc" so pode
 * ser "voce". Ja "n" pode ser "nao" ou "n" de numero — por isso "n" so
 * e tratado quando esta isolado (ver `expandirAbreviacoes`).
 */
const ABREVIACOES: Record<string, string> = {
  vc: 'voce',
  vcs: 'voces',
  vlw: 'valeu',
  blz: 'beleza',
  pq: 'porque',
  qto: 'quanto',
  qnto: 'quanto',
  qdo: 'quando',
  qnd: 'quando',
  tbm: 'tambem',
  tb: 'tambem',
  msg: 'mensagem',
  msgs: 'mensagens',
  hj: 'hoje',
  amanha: 'amanha',
  amnh: 'amanha',
  agr: 'agora',
  mto: 'muito',
  mt: 'muito',
  pfv: 'por favor',
  pf: 'por favor',
  obg: 'obrigado',
  vdd: 'verdade',
  td: 'tudo',
  ta: 'esta',
  to: 'estou',
  tou: 'estou',
  neh: 'ne',
  ctz: 'certeza',
  qq: 'qualquer',
  nd: 'nada',
  add: 'adicionar',
  nao: 'nao',
};

/**
 * Erros de digitacao frequentes, corrigidos por igualdade EXATA da
 * palavra inteira. Nada de substring: "naum" vira "nao", mas
 * "naumburgo" nao vira "naoburgo".
 *
 * IMPORTANTE: as chaves aqui ja estao SEM ACENTO, porque a correcao
 * roda depois da remocao de acentos. Uma chave como "preçu" nunca
 * casaria — o texto ja chega como "precu".
 */
const TYPOS: Record<string, string> = {
  // negacao
  naum: 'nao',
  nau: 'nao',
  nnao: 'nao',
  nao1: 'nao',
  // interesse
  enteresse: 'interesse',
  tenhu: 'tenho',
  tenhoo: 'tenho',
  // "intereçe" chega aqui como "interece" — o cedilha vira "c" na
  // normalizacao NFD, entao a chave precisa ser a forma sem acento.
  interece: 'interesse',
  interese: 'interesse',
  intresse: 'interesse',
  ineresse: 'interesse',
  interessse: 'interesse',
  // preco
  precu: 'preco',
  presso: 'preco',
  prreco: 'preco',
  preso: 'preco',
  vlor: 'valor',
  valro: 'valor',
  quantoo: 'quanto',
  qaunto: 'quanto',
  // tempo
  amnha: 'amanha',
  amanhan: 'amanha',
  amana: 'amanha',
  // diversos
  entaum: 'entao',
  tbem: 'tambem',
  qeuro: 'quero',
  qero: 'quero',
  obrigadu: 'obrigado',
};

export interface RespostaNormalizada {
  /** Exatamente como chegou. Nunca modificado. */
  original: string;
  /** Minusculo, sem acento, sem pontuacao, espacos colapsados. */
  normalizado: string;
  /** Normalizado + abreviacoes e typos corrigidos. Base da comparacao. */
  canonico: string;
  /** Tokens do texto canonico. */
  tokens: string[];
  /** Emojis encontrados, na ordem. */
  emojis: string[];
  /** true quando, tirando emojis e risadas, nao sobrou texto. */
  somenteEmoji: boolean;
  /** true quando so ha risada ("kkk", "haha", "rs"). */
  somenteRisada: boolean;
  /** URLs encontradas. Requisito 42. */
  urls: string[];
  contemUrl: boolean;
  /** Sequencias que parecem telefone. Requisito 43. */
  telefonesMencionados: string[];
  /** Numero de palavras uteis (descontando risadas). */
  totalPalavras: number;
  /** true quando o texto e vazio ou so pontuacao. */
  vazio: boolean;
}

const RE_URL = /https?:\/\/[^\s]+|www\.[^\s]+|[a-z0-9-]+\.(?:com|com\.br|net|org|br|io|me)(?:\/[^\s]*)?/gi;
const RE_TELEFONE = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}/g;
const RE_RISADA = /^(?:k{2,}|(?:ha){2,}|(?:he){2,}|(?:rs){1,}|hehe+|haha+|kk+|huahua+)$/;

/**
 * Token sentinela que marca fim de oracao (virgula, ponto, quebra).
 * Sobrevive a limpeza de pontuacao porque e composto so de letras.
 */
export const MARCA_FRONTEIRA = 'xfronteirax';

/** Remove acentos preservando o resto. */
function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Extrai os emojis do texto. */
function extrairEmojis(texto: string): string[] {
  const conhecidos = [...EMOJI_POSITIVO, ...EMOJI_AMBIGUO, ...EMOJI_NEGATIVO];
  const achados: string[] = [];
  for (const e of conhecidos) {
    if (texto.includes(e)) achados.push(e);
  }
  // Qualquer outro pictograma tambem conta como emoji presente.
  const outros = texto.match(/\p{Extended_Pictographic}/gu) ?? [];
  for (const o of outros) {
    if (!achados.includes(o)) achados.push(o);
  }
  return achados;
}

/**
 * Colapsa alongamento expressivo: "simmmm" -> "sim", "aaah" -> "ah".
 *
 * REGRA: so mexe em sequencias de TRES OU MAIS caracteres iguais.
 *
 * Por que nao duas: o portugues tem centenas de palavras com letra
 * dobrada legitima — "interessado", "passa", "disso", "correndo",
 * "nossa". Colapsar duplas quebraria todas elas, e nenhuma lista de
 * excecoes daria conta do idioma inteiro. Ja tres repeticoes seguidas
 * nao existem em portugues: sao sempre enfase de quem digitou.
 */
function colapsarRepeticoes(palavra: string): string {
  return palavra.replace(/(.)\1{2,}/g, '$1');
}

/** Expande abreviacoes e corrige typos, palavra por palavra. */
function expandirAbreviacoes(tokens: string[]): string[] {
  return tokens.map((token, i) => {
    // "n" isolado so vira "nao" quando e a mensagem inteira ou vem
    // antes de um verbo de negacao. Sozinho no meio da frase e ambiguo.
    if (token === 'n') {
      if (tokens.length === 1) return 'nao';
      const proximo = tokens[i + 1];
      if (proximo && ['quero', 'tenho', 'preciso', 'vou', 'posso', 'me'].includes(proximo)) {
        return 'nao';
      }
      return token;
    }

    const semRepeticao = colapsarRepeticoes(token);
    return TYPOS[semRepeticao] ?? ABREVIACOES[semRepeticao] ?? semRepeticao;
  });
}

export function normalizarResposta(textoBruto: string | null | undefined): RespostaNormalizada {
  const original = textoBruto == null ? '' : String(textoBruto);

  const emojis = extrairEmojis(original);
  const urls = (original.match(RE_URL) ?? []).map((u) => u.trim());
  const telefonesMencionados = (original.match(RE_TELEFONE) ?? [])
    .map((t) => t.trim())
    .filter((t) => t.replace(/\D/g, '').length >= 10);

  // Remove URLs antes de normalizar: "site.com.br" viraria "site com br"
  // e poluiria os tokens.
  let semUrl = original;
  for (const u of urls) semUrl = semUrl.replace(u, ' ');

  // Marca as fronteiras de oracao ANTES de descartar a pontuacao.
  //
  // POR QUE ISSO IMPORTA: sem a virgula, "nao tenho interesse, remove
  // meu numero" vira uma frase so, e o escopo da negacao engole o
  // "remove meu numero" — o pedido de opt-out seria ignorado. A virgula
  // e o ponto encerram o escopo tanto quanto um "mas".
  const comFronteiras = semAcento(semUrl)
    .toLowerCase()
    .replace(/[,;.!?\n]+/g, ` ${MARCA_FRONTEIRA} `);

  const normalizado = comFronteiras
    .replace(/[^\w\s@]/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokensBrutos = normalizado.split(' ').filter((t) => t.length > 0);
  // A risada e detectada ANTES de colapsar repeticoes: "kkkk" viraria
  // "k" e deixaria de casar com o padrao de risada.
  const risadasBrutas = tokensBrutos.filter(
    (t) => t !== MARCA_FRONTEIRA && RE_RISADA.test(t)
  );

  const tokens = expandirAbreviacoes(tokensBrutos);
  // O texto canonico nao carrega a marca de fronteira — ela existe
  // apenas para o mapa de negacao.
  const canonico = tokens.filter((t) => t !== MARCA_FRONTEIRA).join(' ');

  const uteis = tokensBrutos.filter(
    (t) => t !== MARCA_FRONTEIRA && !RE_RISADA.test(t)
  );
  const somenteRisada = risadasBrutas.length > 0 && uteis.length === 0;

  return {
    original,
    normalizado: canonico,
    canonico,
    // `tokens` PRESERVA a marca de fronteira: e o mapa de negacao que
    // precisa dela. Quem compara texto usa `canonico`.
    tokens,
    emojis,
    somenteEmoji: emojis.length > 0 && tokens.length === 0,
    somenteRisada,
    urls,
    contemUrl: urls.length > 0,
    telefonesMencionados,
    totalPalavras: uteis.length,
    vazio: tokens.length === 0 && emojis.length === 0,
  };
}
