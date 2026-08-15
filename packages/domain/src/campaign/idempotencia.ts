/**
 * Chave de idempotencia de uma mensagem de saida.
 *
 * ============================================================
 * POR QUE ISTO MORA NO DOMINIO, E NAO NO SERVICO
 * ============================================================
 * Dois lugares diferentes criam mensagens de saida para o mesmo par
 * lead+etapa:
 *
 *   - a API, quando voce enfileira a campanha;
 *   - o worker, quando uma resposta do lead manda avancar de etapa.
 *
 * Se cada um calculasse a propria chave, bastaria uma diferenca de
 * separador para que a constraint UNIQUE deixasse de colidir — e o lead
 * receberia a MESMA mensagem duas vezes. A funcao e uma so, importada
 * pelos dois, justamente para que essa divergencia nao seja possivel.
 *
 * Nao ha I/O aqui: entra texto, sai texto. `node:crypto` e hash puro,
 * como ja e usado em `normalization/dedupe.ts`.
 */
import { createHash } from 'node:crypto';

/**
 * Mesmo lead + mesma campanha + mesma etapa = mesma chave, sempre.
 *
 * Cem tentativas identicas colidem na constraint UNIQUE e resultam em
 * UMA linha. Quem garante e o banco, nao a aplicacao.
 */
export function chaveIdempotencia(
  leadId: string,
  campaignId: string,
  campaignStepId: string
): string {
  const base = `${leadId}|${campaignId}|${campaignStepId}`;
  return `out:${createHash('sha256').update(base).digest('hex').slice(0, 40)}`;
}

/**
 * Chave de uma resposta automatica a UMA mensagem recebida.
 *
 * A chave de etapa nao serve aqui: a etapa ja tem a mensagem dela, e
 * reusar a chave faria a resposta colidir com o proprio envio da etapa
 * e sumir silenciosamente.
 *
 * O que identifica uma resposta e a mensagem que a provocou. Processar
 * o mesmo evento do WhatsApp duas vezes produz a mesma chave, e a
 * segunda colide.
 */
export function chaveIdempotenciaResposta(
  leadId: string,
  mensagemRecebidaId: string
): string {
  const base = `resposta|${leadId}|${mensagemRecebidaId}`;
  return `out:${createHash('sha256').update(base).digest('hex').slice(0, 40)}`;
}
