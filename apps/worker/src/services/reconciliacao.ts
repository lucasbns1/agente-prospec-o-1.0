/**
 * A reconciliacao no worker: le, detecta e age.
 *
 * ============================================================
 * A DIVISAO DE TRABALHO, EM TRES PEDACOS
 * ============================================================
 *   `@prospector/database`  LE o banco (a API tambem usa)
 *   `@prospector/domain`    DECIDE o que e problema (puro, testavel)
 *   este arquivo            AGE e agenda a passada periodica
 *
 * Decidir precisa ser testavel sem banco: produzir de verdade um "job
 * concluido sem mensagem" exigiria matar um worker no instante exato
 * entre duas escritas.
 *
 * ============================================================
 * NAO CONSERTA NADA SOZINHO
 * ============================================================
 * Uma unica excecao, e ela e sobre seguranca e nao sobre conveniencia:
 * mensagem pendente para lead em OPT-OUT e cancelada na hora. Nao ha
 * cenario em que deixar aquilo na fila seja a escolha certa.
 *
 * Todo o resto e relatado e esperado. Especialmente quando ha duvida
 * sobre se o WhatsApp recebeu: reenviar as cegas manda a MESMA mensagem
 * duas vezes para um cliente seu.
 */
import { lerRetratoParaConferir, cancelarPendentesDeOptOut } from '@prospector/database';
import {
  detectarInconsistencias,
  resumirInconsistencias,
  type Inconsistencia,
} from '@prospector/domain';
import type { Logger } from 'pino';
import { publicarEvento } from '../events.js';

export interface ResultadoReconciliacao {
  achados: Inconsistencia[];
  resumo: { CRITICA: number; ATENCAO: number; INFO: number };
  /** Quantas mensagens foram canceladas por opt-out. */
  canceladasPorOptOut: number;
}

/** Le o estado atual e devolve o que nao bate. */
export async function reconciliar(
  opcoes: { agora?: Date; corrigirOptOut?: boolean } = {}
): Promise<ResultadoReconciliacao> {
  const retrato = await lerRetratoParaConferir(opcoes.agora ?? new Date());
  const achados = detectarInconsistencias(retrato);

  let canceladasPorOptOut = 0;
  if (opcoes.corrigirOptOut !== false) {
    const ids = achados
      .filter((a) => a.tipo === 'ENVIO_PENDENTE_APOS_OPT_OUT')
      .flatMap((a) => a.ids);
    canceladasPorOptOut = await cancelarPendentesDeOptOut(ids);
  }

  return { achados, resumo: resumirInconsistencias(achados), canceladasPorOptOut };
}

/**
 * A passada periodica.
 *
 * Rara de proposito: uma hora. Isto nao e monitoramento em tempo real —
 * e uma rede de seguranca para o que escapou. Rodar de minuto em minuto
 * so gastaria banco para reencontrar os mesmos achados.
 */
export const INTERVALO_RECONCILIACAO_MS = 60 * 60_000;

export function iniciarReconciliacao(log: Logger): () => void {
  let rodando = false;

  const tick = async (): Promise<void> => {
    if (rodando) return;
    rodando = true;
    try {
      const r = await reconciliar();

      if (r.resumo.CRITICA > 0 || r.resumo.ATENCAO > 0) {
        log.warn(
          {
            evento: 'RECONCILIACAO_NECESSARIA',
            ...r.resumo,
            canceladasPorOptOut: r.canceladasPorOptOut,
            // So os criticos no log: a lista inteira pode ser longa, e
            // `pnpm auditoria` mostra tudo quando voce quiser ver.
            criticas: r.achados
              .filter((a) => a.gravidade === 'CRITICA')
              .map((a) => ({ tipo: a.tipo, leadId: a.leadId, descricao: a.descricao })),
          },
          'A reconciliacao encontrou inconsistencias'
        );
        void publicarEvento('dashboard.atualizar');
      }

      if (r.canceladasPorOptOut > 0) {
        log.warn(
          { canceladas: r.canceladasPorOptOut },
          'Mensagens canceladas: o lead esta em opt-out'
        );
      }
    } catch (err) {
      // Rede de seguranca nao pode derrubar o worker que ela protege.
      log.error({ err }, 'A reconciliacao falhou');
    } finally {
      rodando = false;
    }
  };

  // A primeira passada espera um minuto: no boot o worker tem coisa mais
  // urgente a fazer, e mensagem presa ha uma hora aguenta mais sessenta
  // segundos.
  const inicial = setTimeout(() => void tick(), 60_000);
  const timer = setInterval(() => void tick(), INTERVALO_RECONCILIACAO_MS);

  return () => {
    clearTimeout(inicial);
    clearInterval(timer);
  };
}
