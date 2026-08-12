/**
 * GET /api/dashboard
 *
 * FASE 1: o contrato de resposta ja e o definitivo, mas as metricas sao
 * calculadas a partir de um banco que ainda esta vazio — entao vem tudo
 * zerado. As agregacoes reais e a secao "PRECISA DA SUA ATENCAO" com
 * dados de verdade entram na Fase 9.
 *
 * As contagens abaixo ja consultam o banco (nao sao numeros fixos): assim
 * que a Fase 2 comecar a criar leads, os cards passam a se mover sozinhos.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@prospector/database';
import type { DashboardResponse } from '@prospector/shared';
import { exigirAutenticacao } from '../plugins/auth.js';

export async function rotasDashboard(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/dashboard',
    { preHandler: exigirAutenticacao },
    async (): Promise<DashboardResponse> => {
      const [
        totalLeads,
        totalImportados,
        totalProspectados,
        semSite,
        aguardandoResposta,
        mensagensEnviadas,
        respostasRecebidas,
        frios,
        mornos,
        quentes,
        optOuts,
        clientes,
        tarefasPendentes,
      ] = await Promise.all([
        prisma.lead.count(),
        prisma.lead.count({ where: { importId: { not: null } } }),
        prisma.lead.count({
          where: {
            status: {
              in: [
                'EM_CAMPANHA',
                'AGUARDANDO_RESPOSTA',
                'AGENDADO',
                'ATENCAO_NECESSARIA',
                'OPORTUNIDADE',
                'CLIENTE',
                'ENCERRADO',
              ],
            },
          },
        }),
        // "Sem site proprio" = tudo que NAO for SITE_PROPRIO e que ja
        // tenha passado pela verificacao.
        prisma.lead.count({
          where: { websiteStatus: { in: ['NAO_INFORMADO', 'REDE_SOCIAL', 'INVALIDO'] } },
        }),
        prisma.lead.count({ where: { status: 'AGUARDANDO_RESPOSTA' } }),
        // Apenas envios REAIS. Simulacoes (dry-run) ficam de fora.
        prisma.message.count({
          where: { direcao: 'ENVIADA', status: { in: ['ENVIADA', 'ENTREGUE', 'LIDA'] } },
        }),
        prisma.message.count({ where: { direcao: 'RECEBIDA' } }),
        prisma.lead.count({ where: { temperatura: 'FRIO' } }),
        prisma.lead.count({ where: { temperatura: 'MORNO' } }),
        prisma.lead.count({ where: { temperatura: 'QUENTE' } }),
        prisma.lead.count({ where: { optOut: true } }),
        prisma.lead.count({ where: { status: 'CLIENTE' } }),
        prisma.task.count({ where: { status: { in: ['ABERTA', 'EM_ANDAMENTO'] } } }),
      ]);

      return {
        metricas: {
          totalLeads,
          totalImportados,
          totalProspectados,
          semSite,
          aguardandoResposta,
          mensagensEnviadas,
          respostasRecebidas,
          frios,
          mornos,
          quentes,
          optOuts,
          clientes,
          tarefasPendentes,
        },
        // Populada na Fase 9, quando existirem leads e conversas.
        atencao: [],
        funil: [
          { rotulo: 'Capturados', total: totalLeads },
          { rotulo: 'Sem site', total: semSite },
          { rotulo: 'Prospectados', total: totalProspectados },
          { rotulo: 'Responderam', total: respostasRecebidas },
          { rotulo: 'Mornos', total: mornos },
          { rotulo: 'Quentes', total: quentes },
          { rotulo: 'Clientes', total: clientes },
        ],
        whatsapp: {
          // Fase 1: sempre desconectado — o adapter real chega na Fase 8.
          status: 'DESCONECTADO',
          modo:
            process.env.WHATSAPP_MODE?.trim().toLowerCase() === 'live'
              ? 'live'
              : 'dry-run',
        },
      };
    }
  );
}
