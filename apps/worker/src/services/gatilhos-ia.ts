/**
 * Os gatilhos que acordam o orquestrador.
 *
 * ============================================================
 * POR QUE UM MODULO SO PARA ISTO
 * ============================================================
 * O orquestrador precisa do analisador e do logger. Passar os dois por
 * parametro em cada ponto de chamada obrigaria `inbound.ts`,
 * `outbound.ts` e as rotas a conhecerem a configuracao da IA — e a
 * primeira consequencia seria alguem esquecer de repassar e a IA
 * silenciosamente nao rodar naquele caminho.
 *
 * Aqui a configuracao e resolvida UMA vez, no boot, e os pontos de
 * chamada so dizem o que aconteceu.
 *
 * ============================================================
 * REGRA QUE VALE PARA TODAS AS FUNCOES DESTE ARQUIVO
 * ============================================================
 * NENHUMA delas pode lancar. Elas sao chamadas de dentro de caminhos
 * criticos — o processamento de uma mensagem recebida, o pos-envio de
 * uma mensagem que ja saiu. Uma excecao aqui derrubaria o job que a
 * chamou, e a IA e um acessorio: ela nao pode quebrar o que funcionava
 * sem ela.
 */
import type { AnalisadorDeCadencia } from '@prospector/integrations';
import type { Logger } from 'pino';
import type { GatilhoCadencia } from '@prospector/domain';
import { orquestrarCadencia } from './orquestrador.js';

let analisador: AnalisadorDeCadencia | null = null;
let somenteAnalise = true;
let log: Logger | null = null;

/**
 * Chamado uma vez, no boot do worker.
 *
 * Sem isto, `dispararGatilho` nao faz nada — e nao fazer nada e o
 * comportamento correto: e o sistema de antes da Fase 9.
 */
export function configurarIA(opcoes: {
  analisador: AnalisadorDeCadencia | null;
  somenteAnalise: boolean;
  log: Logger;
}): void {
  analisador = opcoes.analisador;
  somenteAnalise = opcoes.somenteAnalise;
  log = opcoes.log;
}

/** Para os testes: volta ao estado de fabrica. */
export function desconfigurarIA(): void {
  analisador = null;
  somenteAnalise = true;
  log = null;
}

export function iaEstaLigada(): boolean {
  return analisador !== null;
}

/**
 * A IA esta COMANDANDO, e nao apenas observando?
 *
 * ============================================================
 * QUEM PERGUNTA ISTO, E POR QUE
 * ============================================================
 * `processarMensagemRecebida` precisa saber, ANTES de aplicar os efeitos
 * do motor, se a cadencia vai ser conduzida por ele ou pela IA. Sem essa
 * pergunta os dois agiriam sobre o mesmo evento: o motor avancaria a
 * etapa e a IA avancaria de novo.
 *
 * A UNIQUE do banco barraria o segundo enfileiramento, entao nao sairia
 * mensagem dobrada — mas os efeitos colaterais (tarefa, notificacao,
 * mudanca de status) aconteceriam duas vezes, e o log ficaria mentindo
 * sobre quem decidiu o que.
 */
export function iaComanda(): boolean {
  return analisador !== null && !somenteAnalise;
}

/**
 * Acorda o orquestrador por causa de um evento.
 *
 * Devolve void e engole qualquer erro de proposito: quem chama esta no
 * meio de outra coisa mais importante.
 */
export async function dispararGatilho(params: {
  leadId: string;
  campaignId: string | null;
  gatilho: GatilhoCadencia;
  /** Ver `OpcoesOrquestrador.observarApenas`. */
  observarApenas?: boolean;
  agora?: Date;
  /**
   * A mensagem EXATA que provocou o gatilho.
   *
   * So faz sentido em `MENSAGEM_RECEBIDA`. Sem ela, a leitura da IA nao
   * e gravada em mensagem nenhuma — ver `gravarLeituraNaMensagem`, que
   * explica por que "a ultima recebida" era um palpite errado.
   */
  mensagemId?: string;
}): Promise<void> {
  // Sem IA configurada nao ha o que comparar nem o que decidir: o motor
  // ja fez o trabalho no caminho normal. Sair aqui evita uma leitura de
  // banco inteira por mensagem recebida.
  if (!analisador || !log || !params.campaignId) return;

  try {
    await orquestrarCadencia(
      {
        leadId: params.leadId,
        campaignId: params.campaignId,
        gatilho: params.gatilho,
        agora: params.agora,
        mensagemId: params.mensagemId,
      },
      {
        analisador,
        somenteAnalise,
        log,
        observarApenas: params.observarApenas,
      }
    );
  } catch (err) {
    log.error(
      {
        evento: 'AI_ORCHESTRATION_FAILED',
        leadId: params.leadId,
        campaignId: params.campaignId,
        gatilho: params.gatilho,
        err,
      },
      'O orquestrador falhou; a cadencia segue pelo caminho deterministico'
    );
  }
}
