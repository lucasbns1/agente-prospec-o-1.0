/**
 * O contrato do analisador — a fronteira entre "decidir" e "chamar rede".
 *
 * ============================================================
 * POR QUE UMA INTERFACE, E NAO A SDK DIRETO
 * ============================================================
 * Os testes precisam exercitar o ciclo inteiro — contexto, decisao,
 * guarda, acao, banco — sem chamar o Google. Nao por economia: por
 * determinismo. Um teste que depende de um modelo remoto falha por
 * motivos que nada tem a ver com o codigo, e um teste que falha
 * sozinho deixa de ser lido.
 *
 * Com esta interface, o fake do teste e o Gemini de producao entram
 * pelo mesmo buraco, e o orquestrador nao sabe a diferenca.
 */
import type { ContextoCadencia, DecisaoIA } from '@prospector/domain';

/**
 * De onde veio a falha.
 *
 * ============================================================
 * POR QUE ISTO IMPORTA
 * ============================================================
 * "Cannot read properties of undefined" ja foi apresentado ao usuario
 * como "chave invalida ou revogada -> gere outra". Era um defeito NOSSO,
 * num objeto montado errado, e a sugestao mandava a pessoa trocar uma
 * chave que estava perfeita.
 *
 * Erro remoto e erro nosso pedem coisas diferentes de quem le: um pede
 * conferir chave, rede e modelo; o outro pede a pilha e um commit.
 */
export type OrigemDaFalha =
  /** A API respondeu com erro, ou a rede/prazo nao deixou chegar la. */
  | 'API'
  /** A resposta chegou, mas nao era o que o contrato promete. */
  | 'RESPOSTA'
  /** Quebrou no nosso codigo, antes ou depois da rede. Bug, nao configuracao. */
  | 'CODIGO';

export type ResultadoAnalise =
  | { ok: true; decisao: DecisaoIA; modelo: string; latenciaMs: number }
  | {
      ok: false;
      erro: string;
      modelo: string;
      latenciaMs: number;
      origem?: OrigemDaFalha;
      /**
       * So preenchido quando `origem === 'CODIGO'`, e so para o script de
       * diagnostico conseguir mostrar onde quebrou. Nao vai para a coluna
       * `erro` de `ai_decisions`.
       */
      pilha?: string;
    };

export interface AnalisadorDeCadencia {
  /**
   * NUNCA lanca. Falha de rede, timeout, JSON invalido e resposta vazia
   * sao todos `{ ok: false }` — porque quem chama precisa cair no motor
   * deterministico sem try/catch. Falhar aqui e evento esperado.
   */
  analisar(contexto: ContextoCadencia): Promise<ResultadoAnalise>;
  readonly modelo: string;
}
