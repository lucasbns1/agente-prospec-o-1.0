/**
 * Le o banco e entrega o retrato para a deteccao.
 *
 * ============================================================
 * A DIVISAO DE TRABALHO
 * ============================================================
 * Este arquivo LE. `packages/domain/src/reconciliacao/deteccao.ts`
 * DECIDE o que e problema. Separados porque decidir precisa ser testavel
 * sem banco: produzir de verdade um "job concluido sem mensagem"
 * exigiria matar um worker no instante exato entre duas escritas.
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
import { prisma } from '@prospector/database';
import {
  detectarInconsistencias,
  resumirInconsistencias,
  type Inconsistencia,
  type RetratoParaConferir,
} from '@prospector/domain';
import type { Logger } from 'pino';
import { publicarEvento } from '../events.js';

/**
 * Quantos leads a varredura olha por vez.
 *
 * A reconciliacao roda em segundo plano, e nao pode competir por banco
 * com o envio. Um teto baixo mantem cada passada barata; o que sobrar
 * aparece na proxima.
 */
const MAX_POR_PASSADA = 500;

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
  const agora = opcoes.agora ?? new Date();

  const [ordens, mensagens, posicoes] = await Promise.all([
    prisma.outboundMessage.findMany({
      take: MAX_POR_PASSADA,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        leadId: true,
        campaignId: true,
        status: true,
        erro: true,
        dryRun: true,
        updatedAt: true,
        messageId: true,
        campaignStep: { select: { ordem: true } },
      },
    }),
    prisma.message.findMany({
      take: MAX_POR_PASSADA,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        leadId: true,
        campaignId: true,
        direcao: true,
        status: true,
        whatsappMessageId: true,
        campaignStep: { select: { ordem: true } },
      },
    }),
    prisma.leadCampaign.findMany({
      take: MAX_POR_PASSADA,
      orderBy: { updatedAt: 'desc' },
      select: {
        leadId: true,
        campaignId: true,
        etapaAtualOrdem: true,
        status: true,
        aguardandoLiberacao: true,
        lead: {
          select: {
            optOut: true,
            tasks: {
              where: { status: { in: ['ABERTA', 'EM_ANDAMENTO'] } },
              select: { id: true },
              take: 1,
            },
            notifications: {
              where: { lida: false },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    }),
  ]);

  const retrato: RetratoParaConferir = {
    agora,
    ordens: ordens.map((o) => ({
      id: o.id,
      leadId: o.leadId,
      campaignId: o.campaignId,
      etapaOrdem: o.campaignStep?.ordem ?? null,
      status: o.status,
      erro: o.erro,
      dryRun: o.dryRun,
      atualizadoEm: o.updatedAt,
      messageId: o.messageId,
    })),
    mensagens: mensagens.map((m) => ({
      id: m.id,
      leadId: m.leadId,
      campaignId: m.campaignId,
      etapaOrdem: m.campaignStep?.ordem ?? null,
      direcao: m.direcao as 'ENVIADA' | 'RECEBIDA',
      status: m.status,
      whatsappMessageId: m.whatsappMessageId,
    })),
    posicoes: posicoes.map((p) => ({
      leadId: p.leadId,
      campaignId: p.campaignId,
      etapaAtualOrdem: p.etapaAtualOrdem,
      status: p.status,
      aguardandoLiberacao: p.aguardandoLiberacao,
      leadEmOptOut: p.lead.optOut,
      temTarefaAberta: p.lead.tasks.length > 0,
      temAvisoPendente: p.lead.notifications.length > 0,
    })),
  };

  const achados = detectarInconsistencias(retrato);

  // ============================================================
  // A UNICA CORRECAO AUTOMATICA
  // ============================================================
  // Nao e conveniencia — e a diferenca entre "o sistema tem um bug" e
  // "o sistema mandou mensagem para quem pediu para parar".
  let canceladasPorOptOut = 0;
  if (opcoes.corrigirOptOut !== false) {
    const idsParaCancelar = achados
      .filter((a) => a.tipo === 'ENVIO_PENDENTE_APOS_OPT_OUT')
      .flatMap((a) => a.ids);

    if (idsParaCancelar.length > 0) {
      const r = await prisma.outboundMessage.updateMany({
        // PROCESSANDO fica DE FORA: ali o envio pode ja estar em curso, e
        // reescrever o status atropelaria o worker que esta trabalhando.
        // Aquele caso continua sendo relatado para voce decidir.
        where: { id: { in: idsParaCancelar }, status: { in: ['PENDENTE', 'AGENDADA'] } },
        data: { status: 'CANCELADA', erro: 'Cancelada pela reconciliacao: lead em opt-out' },
      });
      canceladasPorOptOut = r.count;
    }
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
