/**
 * CONTRATOS DO SISTEMA DE TEMPLATES — implementacao na FASE 5.
 *
 * REGRA 16 DO BRIEFING: nunca inventar dados. Se {{bairro}} nao existe
 * para aquele lead, a mensagem NAO e enviada com um espaco em branco nem
 * com um valor generico. O envio e bloqueado e uma tarefa de revisao e
 * criada.
 */
import type { TemplateVariavel } from '@prospector/shared';

export interface ContextoTemplate {
  primeiro_nome: string | null;
  nome_completo: string | null;
  empresa: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  telefone: string | null;
  categoria: string | null;
  site_preview_url: string | null;
}

export interface ResultadoRenderizacao {
  /** Texto final. Preenchido apenas quando `ok === true`. */
  texto: string | null;
  ok: boolean;
  /** Variaveis usadas e seus valores — guardado junto da mensagem. */
  variaveisUsadas: Record<string, string>;
  /** Variaveis referenciadas no template mas vazias/nulas no lead. */
  variaveisFaltando: TemplateVariavel[];
  /** Variaveis escritas no template que nao existem no sistema. */
  variaveisDesconhecidas: string[];
}

/**
 * Substitui {{variavel}} pelos valores do lead.
 *
 * Retorna `ok: false` — bloqueando o envio — quando:
 *   - alguma variavel referenciada esta nula ou vazia;
 *   - alguma variavel referenciada nao existe no sistema.
 *
 * Nunca substitui por string vazia, por placeholder, nem por um valor
 * "parecido". Prefere nao enviar.
 */
export type RenderizarTemplate = (
  template: string,
  contexto: ContextoTemplate
) => ResultadoRenderizacao;

/** Lista as variaveis referenciadas em um template, sem renderizar. */
export type ExtrairVariaveis = (template: string) => string[];
