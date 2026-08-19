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

/**
 * Chave de idempotencia de uma NOTIFICACAO.
 *
 * ============================================================
 * O BURACO QUE ISTO FECHA
 * ============================================================
 * Ate agora `criarNotificacao` era um `create()` seco. Nada impedia que
 * o mesmo acontecimento gerasse dois avisos: uma segunda resposta do
 * lead, uma varredura que repetiu, um job reexecutado pelo BullMQ — e
 * o sino mostrava o mesmo pedido duas vezes.
 *
 * O que identifica uma notificacao nao e o texto dela (que pode mudar
 * conforme o nome da etapa), e sim O ACONTECIMENTO: este tipo de aviso,
 * para este lead, por causa deste fato. Duas tentativas de avisar a
 * mesma coisa produzem a mesma chave, e a segunda colide na UNIQUE.
 *
 * `referencia` e o que torna o acontecimento unico dentro do tipo:
 * o id da etapa, o id da mensagem recebida, o id do envio que falhou.
 * Sem ela, "lead chegou na etapa 3" e "lead chegou na etapa 5" seriam a
 * mesma notificacao e a segunda sumiria.
 */
export function chaveNotificacao(
  tipo: string,
  leadId: string,
  referencia: string
): string {
  const base = `notif|${tipo}|${leadId}|${referencia}`;
  return `ntf:${createHash('sha256').update(base).digest('hex').slice(0, 40)}`;
}
