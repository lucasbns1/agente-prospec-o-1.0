/**
 * Traducao dos 14 intents do modelo para as 8 categorias do sistema.
 *
 * ============================================================
 * POR QUE NAO EXPANDIR O ENUM DO BANCO
 * ============================================================
 * `RespostaCategoria` e um enum do PostgreSQL, usado por quatro tabelas:
 * `messages.categoria`, `response_keywords`, `campaign_step_rules` e
 * `response_templates`. Acrescentar seis valores ali obrigaria a mexer
 * nas regras de todas as campanhas ja configuradas, e o ganho seria
 * zero: nenhuma delas tem regra para NEGOCIACAO.
 *
 * Entao o intent granular fica gravado cru em `messages.ai_intent`, para
 * auditoria e para o dia em que for util, e o motor continua recebendo
 * as 8 categorias que ele sabe tratar.
 */
import type { RespostaCategoria } from '@prospector/shared';
import type { IntentIA } from './decisao-ia.js';

/**
 * O mapa. Cada escolha aqui tem uma consequencia no comportamento, entao
 * as nao obvias estao justificadas.
 */
const MAPA: Record<IntentIA, RespostaCategoria> = {
  // Interesse declarado, aceite explicito, negociacao e agendamento sao
  // todos "a conversa avancou": o motor trata como POSITIVO e a regra da
  // etapa decide o que fazer com isso.
  INTERESSE: 'POSITIVO',
  ACEITE: 'POSITIVO',
  NEGOCIACAO: 'POSITIVO',
  AGENDAMENTO: 'POSITIVO',

  PRECO: 'PRECO',

  // Duvida, pedido de informacao e suporte sao a mesma coisa do ponto de
  // vista da acao: o lead quer saber algo, e ou existe template para
  // aquilo ou vira intervencao.
  DUVIDA: 'DUVIDA',
  INFORMACAO: 'DUVIDA',
  SUPORTE: 'DUVIDA',

  // OBJECAO vira DUVIDA, NAO NEGATIVO.
  //
  // "Achei caro", "ja tenho quem cuide disso", "nao sei se preciso" sao
  // conversas em andamento, nao recusas. Manda-las para NEGATIVO faria a
  // regra PARAR encerrar leads que estavam a uma resposta de fechar.
  OBJECAO: 'DUVIDA',

  NEGATIVO: 'NEGATIVO',
  OPT_OUT: 'OPT_OUT',

  // SPAM e DESCONHECIDO caem em DESCONHECIDO, que pela invariante 3 do
  // `decidirAcao` nunca avanca e nunca responde.
  SPAM: 'DESCONHECIDO',
  DESCONHECIDO: 'DESCONHECIDO',

  // INTERVENCAO e o modelo dizendo "isto e com voce". DESCONHECIDO e
  // exatamente o caminho que ja leva a intervencao humana — nao precisa
  // de mecanismo novo.
  INTERVENCAO: 'DESCONHECIDO',
};

/**
 * Converte. Um valor fora do enum (que so chegaria aqui se o Zod fosse
 * contornado) cai em DESCONHECIDO — o destino seguro.
 */
export function mapearIntent(intent: IntentIA): RespostaCategoria {
  return MAPA[intent] ?? 'DESCONHECIDO';
}

/**
 * Teto de confianca para uma classificacao que veio SO da IA.
 *
 * ============================================================
 * O NUMERO 49 NAO E ARBITRARIO
 * ============================================================
 * O motor tem dois limiares: 30 para classificar, 50 para AGIR (enviar
 * qualquer coisa). Em modo sombra e nos primeiros dias de operacao, a IA
 * pode enriquecer o CRM mas nao pode disparar mensagem sozinha.
 *
 * Limitar a 49 faz isso valer por construcao, e nao por configuracao que
 * alguem esquece de conferir: a classificacao aparece na tela, alimenta
 * a intervencao com um resumo util, e nao atinge o piso de envio.
 */
export const TETO_CONFIANCA_SO_IA = 49;

export function limitarConfiancaDaIA(confianca: number): number {
  return Math.min(confianca, TETO_CONFIANCA_SO_IA);
}
