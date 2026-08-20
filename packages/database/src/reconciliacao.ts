/**
 * A LEITURA da reconciliacao.
 *
 * ============================================================
 * POR QUE ISTO MORA AQUI, E NAO NO WORKER
 * ============================================================
 * Dois processos precisam da mesma resposta:
 *
 *   - o worker, na passada horaria que age sobre o que achou;
 *   - a API, na tela que mostra o estado sem mexer em nada.
 *
 * `apps/api` e `apps/worker` sao aplicacoes separadas e nao se importam
 * — a fronteira e deliberada: o worker carrega um Chromium inteiro, e a
 * API nao pode arrastar isso junto. Duplicar a consulta nos dois lados
 * garantiria que uma das copias envelhecesse.
 *
 * Entao a consulta vive aqui, ao lado do cliente Prisma. O que ela NAO
 * faz e decidir: isso e `detectarInconsistencias`, funcao pura em
 * `@prospector/domain`, que recebe este retrato pronto.
 */
import { prisma } from './index.js';

/**
 * Quantos registros a varredura olha por vez.
 *
 * A reconciliacao roda em segundo plano e nao pode competir por banco
 * com o envio. O que sobrar aparece na proxima passada.
 */
export const MAX_POR_PASSADA = 500;

/**
 * Le o estado atual e devolve o retrato cru.
 *
 * Os tipos de saida sao os de `@prospector/domain`
 * (`RetratoParaConferir`), mas nao sao importados aqui: este package nao
 * depende do dominio, e inverter isso criaria um ciclo. A forma e
 * conferida do outro lado, na chamada.
 */
export async function lerRetratoParaConferir(agora: Date = new Date()) {
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
            // `take: 1` porque a pergunta e "existe?", nao "quantas?".
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

  return {
    agora,
    ordens: ordens.map((o) => ({
      id: o.id,
      leadId: o.leadId,
      campaignId: o.campaignId,
      etapaOrdem: o.campaignStep?.ordem ?? null,
      status: o.status as string,
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
      status: m.status as string,
      whatsappMessageId: m.whatsappMessageId,
    })),
    posicoes: posicoes.map((p) => ({
      leadId: p.leadId,
      campaignId: p.campaignId,
      etapaAtualOrdem: p.etapaAtualOrdem,
      status: p.status as string,
      aguardandoLiberacao: p.aguardandoLiberacao,
      leadEmOptOut: p.lead.optOut,
      temTarefaAberta: p.lead.tasks.length > 0,
      temAvisoPendente: p.lead.notifications.length > 0,
    })),
  };
}

/**
 * Cancela mensagens que ainda vao sair para leads em opt-out.
 *
 * ============================================================
 * A UNICA CORRECAO AUTOMATICA DO SISTEMA INTEIRO
 * ============================================================
 * Nao e conveniencia — e a diferenca entre "o sistema tem um bug" e "o
 * sistema mandou mensagem para quem pediu para parar".
 *
 * PROCESSANDO fica DE FORA: ali o envio pode estar em curso neste
 * instante, e reescrever o status atropelaria o worker que esta
 * trabalhando. Aquele caso continua sendo relatado para decisao humana.
 */
export async function cancelarPendentesDeOptOut(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await prisma.outboundMessage.updateMany({
    where: { id: { in: ids }, status: { in: ['PENDENTE', 'AGENDADA'] } },
    data: { status: 'CANCELADA', erro: 'Cancelada pela reconciliacao: lead em opt-out' },
  });
  return r.count;
}
