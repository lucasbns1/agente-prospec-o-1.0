/**
 * Qual nome usar ao falar com o lead.
 *
 * ============================================================
 * A REGRA: NOME DE PESSOA NUNCA E DEDUZIDO
 * ============================================================
 * "Studio Luana Silva" e o nome de um ESTABELECIMENTO. Luana pode ser a
 * dona, pode ser a mae da dona, pode ser o nome de uma rua, pode ser a
 * ex-socia que saiu ha cinco anos. O sistema NAO tem como saber, e
 * chutar custa caro: uma mensagem que comeca com o nome errado morre na
 * primeira linha e queima o lead.
 *
 * Entao a regra e simples e absoluta:
 *
 *   nome de pessoa so existe quando ALGUEM DECLAROU que e de pessoa.
 *
 * Na pratica: veio de uma coluna chamada "Responsavel", "Proprietario",
 * "Dono" ou equivalente, ou foi digitado a mao no CRM. Nunca extraido do
 * nome do estabelecimento.
 *
 * ============================================================
 * POR QUE UMA LISTA DE PALAVRAS NAO RESOLVE
 * ============================================================
 * A tentacao e manter uma lista de marcadores ("clinica", "studio",
 * "centro"...) e dizer "se tem um desses, e empresa". Isso falha sempre,
 * porque a lista nunca acaba:
 *
 *   "Salao da Ana"      -> sem marcador -> viraria "Oi, Salao!"
 *   "Barbearia do Ze"   -> sem marcador -> viraria "Oi, Barbearia!"
 *   "Ana Beleza"        -> sem marcador -> viraria "Oi, Ana!" (nome do salao)
 *
 * O terceiro e o pior: soa correto e esta errado. Nao ha lista que
 * separe "Ana Beleza" (salao) de "Ana Beleza" (a pessoa) — a informacao
 * simplesmente nao esta no texto.
 *
 * A saida nao e uma lista melhor. E nao precisar de lista nenhuma.
 */

/** O que se sabe sobre a identidade do lead. */
export interface IdentidadeLead {
  /**
   * Nome de PESSOA, vindo de fonte declarada (coluna de responsavel ou
   * digitado no CRM). `null` quando ninguem declarou.
   */
  nomeContato: string | null;
  /** Nome do estabelecimento. */
  empresa: string | null;
  /** Nome como veio na planilha, quando nao ha `empresa` separada. */
  nomeCompleto: string | null;
}

export type OrigemNome = 'CONTATO_DECLARADO' | 'ESTABELECIMENTO' | 'NENHUM';

export interface NomeParaAbordagem {
  /** O que usar em `{{nome_abordagem}}`. `null` = nao ha nome utilizavel. */
  nome: string | null;
  origem: OrigemNome;
  /** true apenas quando `nome` e comprovadamente de uma PESSOA. */
  ehPessoa: boolean;
}

function limpo(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') return null;
  const t = valor.trim().replace(/\s+/g, ' ');
  return t === '' ? null : t;
}

/**
 * Decide o nome da abordagem.
 *
 * Prioridade:
 *   1. `nomeContato` — pessoa, declarada. Vira "Oi, Luana!"
 *   2. `empresa` / `nomeCompleto` — estabelecimento. NAO vira saudacao
 *      direta; serve para "Encontrei o Studio Sonia no Google".
 *   3. nada.
 *
 * `ehPessoa` e o campo que impede o uso errado: quem monta a mensagem
 * consulta ELE, e nao a presenca do nome, para decidir se pode escrever
 * "Oi, {nome}!".
 */
export function obterNomeParaAbordagem(
  lead: IdentidadeLead
): NomeParaAbordagem {
  const contato = limpo(lead.nomeContato);
  if (contato !== null) {
    return { nome: contato, origem: 'CONTATO_DECLARADO', ehPessoa: true };
  }

  const estabelecimento = limpo(lead.empresa) ?? limpo(lead.nomeCompleto);
  if (estabelecimento !== null) {
    return {
      nome: estabelecimento,
      origem: 'ESTABELECIMENTO',
      // O ponto central deste arquivo. Mesmo havendo nome, ele NAO e de
      // pessoa — e a mensagem precisa saber disso.
      ehPessoa: false,
    };
  }

  return { nome: null, origem: 'NENHUM', ehPessoa: false };
}

/**
 * O nome do estabelecimento, para `{{nome_estabelecimento}}`.
 *
 * Separado de proposito: `{{nome_abordagem}}` pode virar o nome de uma
 * pessoa, e uma mensagem que diga "Encontrei a Luana no Google" quando
 * o certo era "Encontrei o Studio Luana Silva no Google" perde a
 * referencia que faz o lead entender de onde voce veio.
 */
export function obterNomeEstabelecimento(lead: IdentidadeLead): string | null {
  return limpo(lead.empresa) ?? limpo(lead.nomeCompleto);
}

/**
 * Pode escrever "Oi, {nome}!"?
 *
 * Existe como funcao propria porque a pergunta aparece em mais de um
 * lugar (render do template, previa, tela do lead) e a resposta precisa
 * ser a mesma nos tres.
 */
export function podeSaudarPeloNome(lead: IdentidadeLead): boolean {
  return obterNomeParaAbordagem(lead).ehPessoa;
}
