/**
 * CONTRATOS DO MOTOR DE REGRAS — implementacao na FASE 6.
 *
 * O motor e DETERMINISTICO. Nao ha IA, nao ha modelo, nao ha chamada de
 * rede. Entra um texto, sai uma categoria — sempre a mesma para a mesma
 * entrada e o mesmo dicionario.
 *
 * O dicionario NAO vive aqui: vem da tabela `response_keywords`, e a
 * ordem de precedencia vem de `settings['regras.precedencia']`. Este
 * arquivo so define como os dois sao aplicados.
 */
import type { RespostaCategoria, MatchTipo } from '@prospector/shared';

/** Um termo do dicionario, ja normalizado. */
export interface TermoRegra {
  id: string;
  categoria: RespostaCategoria;
  termo: string;
  matchTipo: MatchTipo;
  peso: number;
  ativo: boolean;
  /** null = global; preenchido = especifico de uma etapa. */
  campaignStepId: string | null;
}

export interface TermoCasado {
  termoId: string;
  termo: string;
  categoria: RespostaCategoria;
  matchTipo: MatchTipo;
  peso: number;
}

export interface ResultadoClassificacao {
  /** A categoria vencedora, apos aplicar a precedencia. */
  categoria: RespostaCategoria;
  /** Todas as categorias que tiveram algum termo casado. */
  categoriasDetectadas: RespostaCategoria[];
  /** Todos os termos que casaram — guardado no banco para auditoria. */
  termosCasados: TermoCasado[];
  /** O texto apos normalizacao, para voce conferir o que foi comparado. */
  textoNormalizado: string;
  /**
   * true quando nada casou. Neste caso a categoria e DESCONHECIDO e o
   * sistema NAO pode avancar a campanha: precisa criar tarefa, marcar
   * ATENCAO_NECESSARIA e notificar. Ver regra 10 do briefing.
   */
  desconhecido: boolean;
}

export interface OpcoesClassificacao {
  /** Dicionario aplicavel (globais + os da etapa atual). */
  termos: TermoRegra[];
  /** Ordem de precedencia vinda das configuracoes. */
  precedencia: RespostaCategoria[];
  /** Termos com campaignStepId preenchido vencem os globais. */
  campaignStepId?: string | null;
}

/**
 * Classifica uma resposta recebida.
 *
 * Algoritmo previsto:
 *   1. normaliza o texto (minusculo, sem acento, sem pontuacao);
 *   2. testa todos os termos ativos e coleta os que casam;
 *   3. termos especificos da etapa tem prioridade sobre os globais;
 *   4. agrupa por categoria; dentro da categoria, maior `peso` vence;
 *   5. entre categorias, a ordem de `precedencia` decide;
 *   6. nada casou -> DESCONHECIDO, com `desconhecido: true`.
 */
export type ClassificarResposta = (
  texto: string,
  opcoes: OpcoesClassificacao
) => ResultadoClassificacao;

/** Testa um unico termo contra um texto ja normalizado. */
export type TestarTermo = (
  textoNormalizado: string,
  termo: string,
  matchTipo: MatchTipo
) => boolean;
