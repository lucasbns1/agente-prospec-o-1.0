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

export type ResultadoAnalise =
  | { ok: true; decisao: DecisaoIA; modelo: string; latenciaMs: number }
  | { ok: false; erro: string; modelo: string; latenciaMs: number };

export interface AnalisadorDeCadencia {
  /**
   * NUNCA lanca. Falha de rede, timeout, JSON invalido e resposta vazia
   * sao todos `{ ok: false }` — porque quem chama precisa cair no motor
   * deterministico sem try/catch. Falhar aqui e evento esperado.
   */
  analisar(contexto: ContextoCadencia): Promise<ResultadoAnalise>;
  readonly modelo: string;
}
