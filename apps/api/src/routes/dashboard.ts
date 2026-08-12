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
import {
  STATUS_ENVIO_REAL,
  STATUS_PROSPECTADO,
  type DashboardResponse,
} from '@prospector/shared';
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
        comSite,
        aguardandoResposta,
        emConversa,
        intervencoesPendentes,
        interessados,
        negativos,
        mensagensEnviadas,
        mensagensRecebidas,
        errosEnvio,
        frios,
        mornos,
        quentes,
        optOuts,
        clientes,
        tarefasPendentes,
      ] = await Promise.all([
        prisma.lead.count(),
        prisma.lead.count({ where: { importId: { not: null } } }),
        prisma.lead.count({ where: { status: { in: [...STATUS_PROSPECTADO] } } }),
        // "Sem site proprio" = tudo que NAO for SITE_PROPRIO e que ja
        // tenha passado pela verificacao.
        prisma.lead.count({
          where: { websiteStatus: { in: ['NAO_INFORMADO', 'REDE_SOCIAL', 'INVALIDO'] } },
        }),
        prisma.lead.count({ where: { websiteStatus: 'SITE_PROPRIO' } }),
        prisma.lead.count({ where: { status: 'AGUARDANDO_RESPOSTA' } }),
        prisma.lead.count({ where: { status: 'EM_CONVERSA' } }),
        prisma.lead.count({ where: { status: 'AGUARDANDO_INTERVENCAO' } }),
        // Usa a categoria denormalizada no lead — sem varrer mensagens.
        prisma.lead.count({
          where: { ultimaCategoria: { in: ['POSITIVO', 'INTERESSE', 'PRECO'] } },
        }),
        prisma.lead.count({ where: { ultimaCategoria: 'NEGATIVO' } }),
        // Apenas envios REAIS. Simulacoes (dry-run) ficam de fora.
        prisma.message.count({
          where: { direcao: 'ENVIADA', status: { in: [...STATUS_ENVIO_REAL] } },
        }),
        prisma.message.count({ where: { direcao: 'RECEBIDA' } }),
        prisma.message.count({ where: { status: 'FALHOU' } }),
        prisma.lead.count({ where: { temperatura: 'FRIO' } }),
        prisma.lead.count({ where: { temperatura: 'MORNO' } }),
        prisma.lead.count({ where: { temperatura: 'QUENTE' } }),
        prisma.lead.count({ where: { optOut: true } }),
        prisma.lead.count({ where: { status: 'CLIENTE' } }),
        prisma.task.count({ where: { status: { in: ['ABERTA', 'EM_ANDAMENTO'] } } }),
      ]);

      // Campanha ativa: na Fase 1 ainda nao existe nenhuma.
      const campanha = await prisma.campaign.findFirst({
        where: { status: 'ATIVA' },
        orderBy: { iniciadaEm: 'desc' },
      });

      return {
        metricas: {
          totalLeads,
          totalImportados,
          totalProspectados,
          semSite,
          comSite,
          aguardandoResposta,
          emConversa,
          intervencoesPendentes,
          interessados,
          negativos,
          mensagensEnviadas,
          mensagensRecebidas,
          errosEnvio,
          frios,
          mornos,
          quentes,
          optOuts,
          clientes,
          tarefasPendentes,
        },
        campanhaAtiva: campanha
          ? {
              id: campanha.id,
              nome: campanha.nome,
              nicho: campanha.nicho,
              cidade: campanha.cidade,
              totalLeads: 0,
              enviadasHoje: 0,
              respostas: 0,
              quentes: 0,
              limiteDiario: campanha.limiteDiarioEnvios,
            }
          : null,
        // Populada na Fase 9, quando existirem leads e conversas.
        atencao: [],
        funil: [
          { rotulo: 'Capturados', total: totalLeads },
          { rotulo: 'Sem site', total: semSite },
          { rotulo: 'Prospectados', total: totalProspectados },
          { rotulo: 'Responderam', total: mensagensRecebidas },
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
