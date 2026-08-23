/**
 * A coluna do telefone e a coluna do telefone mesmo?
 *
 * ============================================================
 * O CASO REAL
 * ============================================================
 * Duas planilhas do Google Maps entraram com 54 leads. Todos com
 * telefone recusado, e os valores eram estes:
 *
 *   "15"  "20"  "3"  "5"  "21"  "4"
 *
 * Nao sao telefones truncados — sao a CONTAGEM DE AVALIACOES. No
 * arquivo, a avaliacao estava numa coluna e o numero de avaliacoes na
 * seguinte; o telefone morava dez colunas depois. O mapeamento pegou a
 * errada.
 *
 * O sistema importou os 54 assim mesmo, contou "54 importados", e so
 * meses depois — quando a campanha mostrou "0 leads" — e que a pergunta
 * apareceu. A analise SABIA: `semTelefone` era 25 de 25. Mas era um
 * numero entre outros, e ninguem le um numero que nao grita.
 *
 * ============================================================
 * POR QUE PROPORCAO, E NAO UM VALOR ABSOLUTO
 * ============================================================
 * Uma planilha de verdade tem alguns leads sem telefone — e normal, o
 * Google Maps nem sempre traz. O que NAO e normal e quase nenhum ter.
 *
 * Uma coluna errada erra em TODAS as linhas, porque o erro esta no
 * mapeamento e nao nos dados. E essa a assinatura que isto procura.
 *
 * ============================================================
 * FUNCAO PURA
 * ============================================================
 * Recebe os numeros e uma amostra dos valores crus; devolve o alerta ou
 * `null`. Sem I/O, para o limiar poder ser testado sem subir importacao.
 */

/**
 * Proporcao a partir da qual a coluna vira suspeita.
 *
 * Alto de proposito. Abaixo disto ha explicacoes inocentes — lista velha,
 * estabelecimentos sem telefone publicado — e um alarme que dispara a
 * toa ensina a pessoa a ignorar o alarme.
 */
export const PROPORCAO_SUSPEITA = 0.8;

/**
 * Minimo de linhas para opinar.
 *
 * Com tres leads e dois sem telefone a proporcao passa de 60% sem
 * significar nada. Amostra pequena nao sustenta a acusacao.
 */
export const MINIMO_PARA_OPINAR = 5;

export interface AlertaColunaTelefone {
  /** Entre 0 e 1. */
  proporcaoSemTelefone: number;
  /** Ate tres valores crus que foram recusados, para a mensagem. */
  exemplos: string[];
  /** Pronta para a tela. */
  mensagem: string;
}

export function avaliarColunaTelefone(p: {
  /** Linhas que seriam importadas. */
  novos: number;
  /** Quantas delas ficaram sem telefone utilizavel. */
  semTelefone: number;
  /** Os valores crus das que falharam, na ordem em que apareceram. */
  brutosRecusados: (string | null | undefined)[];
}): AlertaColunaTelefone | null {
  if (p.novos < MINIMO_PARA_OPINAR) return null;

  const proporcao = p.semTelefone / p.novos;
  if (proporcao < PROPORCAO_SUSPEITA) return null;

  const exemplos = p.brutosRecusados
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .slice(0, 3);

  const quantos = `${p.semTelefone} de ${p.novos}`;

  // Sem valor nenhum: a coluna nao foi mapeada, ou veio vazia. E um
  // problema diferente de "mapeou a coluna errada", e o conserto tambem.
  if (exemplos.length === 0) {
    return {
      proporcaoSemTelefone: proporcao,
      exemplos: [],
      mensagem:
        `${quantos} linhas não tem telefone nenhum. Confira se a coluna do ` +
        'telefone foi escolhida no mapeamento — sem ela, os leads entram e ' +
        'nenhuma campanha consegue usá-los.',
    };
  }

  return {
    proporcaoSemTelefone: proporcao,
    exemplos,
    mensagem:
      `${quantos} linhas têm um valor no campo telefone que não é um ` +
      `telefone: ${exemplos.map((e) => `"${e}"`).join(', ')}. ` +
      'Isso costuma ser coluna trocada no mapeamento — avaliação e ' +
      'número de avaliações ficam perto do telefone nas planilhas do ' +
      'Google Maps.',
  };
}
