/**
 * "Ja cuidei disso" — tirar um lead de "Precisa da sua atencao".
 *
 * ============================================================
 * POR QUE ISTO NAO E UM `delete`
 * ============================================================
 * A lista de atencao nao e uma tabela. Ela e RECALCULADA a cada carga da
 * tela, a partir de seis perguntas feitas ao banco: quem esta travado
 * esperando voce, quem esta quente, quem perguntou preco, quem tem
 * tarefa atrasada, quem teve envio falhado, quem espera uma previa.
 *
 * Nao ha linha para apagar. Um lead quente esta ali porque a coluna
 * `temperatura` diz QUENTE, e vai continuar ali enquanto disser.
 *
 * ============================================================
 * O CAMINHO ERRADO, E POR QUE ELE E ERRADO
 * ============================================================
 * A saida obvia seria o botao MUDAR o dado que colocou o lead ali:
 * rebaixar a temperatura, limpar a ultima categoria, cancelar o envio
 * que falhou. Isso faz a lista encolher — e falsifica o historico. O
 * lead REALMENTE perguntou preco; o envio REALMENTE falhou. Apagar o
 * fato para limpar uma tela troca uma tela suja por dados mentirosos, e
 * a semana seguinte passa a ser decidida em cima deles.
 *
 * ============================================================
 * O QUE ISTO FAZ NO LUGAR
 * ============================================================
 * Grava uma DISPENSA: "as pendencias que este lead tinha ate o instante
 * T, eu ja tratei". Nada do que aconteceu e alterado.
 *
 * A lista entao esconde as pendencias mais VELHAS que a dispensa, e
 * mostra as mais novas. Isso resolve de graca o problema que um botao
 * ingenuo teria: se o lead responder de novo amanha, ou uma tarefa nova
 * vencer, ele VOLTA — porque aquilo aconteceu depois de voce dizer que
 * tinha cuidado, e portanto voce ainda nao cuidou.
 *
 * ============================================================
 * E POR QUE ELE LIMPA TODOS OS MOTIVOS DE UMA VEZ
 * ============================================================
 * O mesmo lead pode estar na lista por varios motivos ao mesmo tempo —
 * a tela mostra o mais urgente e conta os outros em `totalMotivos`.
 * Se o botao dispensasse so o motivo exibido, o lead reapareceria na
 * hora com o segundo, e o botao pareceria quebrado.
 *
 * FUNCAO PURA: recebe os candidatos e as dispensas, devolve o que sobra.
 */

import type { CandidatoAtencao } from './atencao.js';

/**
 * A origem que marca o evento de dispensa.
 *
 * A consulta filtra por ela: e um contrato entre quem grava e quem le,
 * nao um rotulo solto.
 */
export const ORIGEM_ATENCAO_RESOLVIDA = 'atencao-resolvida';

/** A descricao que aparece na trilha do lead. */
export const DESCRICAO_ATENCAO_RESOLVIDA =
  'Você marcou como resolvido em "Precisa da sua atenção"';

/**
 * Tira os candidatos que a dispensa ja cobre.
 *
 * A comparacao e `em <= dispensadoEm`: uma pendencia nascida no MESMO
 * instante da dispensa conta como coberta. O contrario faria uma tarefa
 * criada no mesmo segundo do clique sobreviver, e o lead voltaria sem
 * nada ter acontecido de novo.
 */
export function peneirarResolvidos(
  candidatos: CandidatoAtencao[],
  /** Por lead, o instante da dispensa MAIS RECENTE. */
  dispensas: Map<string, Date>
): CandidatoAtencao[] {
  if (dispensas.size === 0) return candidatos;

  return candidatos.filter((c) => {
    const ate = dispensas.get(c.leadId);
    if (ate === undefined) return true;
    return c.em.getTime() > ate.getTime();
  });
}
