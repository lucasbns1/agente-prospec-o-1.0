/**
 * GET /api/dashboard
 *
 * A ordem da resposta espelha a ordem da tela, e ela e uma decisao de
 * produto: primeiro o que exige acao sua, depois os numeros.
 *
 * As agregacoes de "precisa da sua atencao" e o resumo da campanha ativa
 * vivem em `dashboard-service`. Ate a Fase 4 essa secao era um array
 * vazio fixo e o card da campanha mostrava quatro zeros — existiam, mas
 * mentiam.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@prospector/database';
import {
  STATUS_ENVIO_REAL,
  STATUS_PROSPECTADO,
  type DashboardResponse,
} from '@prospector/shared';
import { exigirAutenticacao } from '../plugins/auth.js';
import {
  leadsSemResposta,
  montarAtencao,
  resumoCampanhaAtiva,
} from '../services/dashboard-service.js';

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

      const inicioDoDia = new Date();
      inicioDoDia.setHours(0, 0, 0, 0);

      const [agendados, leadsHoje] = await Promise.all([
        prisma.lead.count({ where: { status: 'AGENDADO' } }),
        prisma.lead.count({ where: { createdAt: { gte: inicioDoDia } } }),
      ]);

      const [atencao, campanhaAtiva] = await Promise.all([
        montarAtencao(),
        resumoCampanhaAtiva(),
      ]);

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
          agendados,
          leadsHoje,
        },
        campanhaAtiva,
        atencao,
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
          // Sempre desconectado ate a fase de integracao: o adapter real
          // com whatsapp-web.js ainda nao existe.
          status: 'DESCONECTADO',
        },
      };
    }
  );

  /**
   * GET /api/dashboard/sem-resposta
   *
   * Rota separada, e nao mais um campo do /api/dashboard, por dois
   * motivos: a lista pode ser longa e o dashboard e carregado a cada
   * visita; e ela so interessa quando voce clica para ver.
   *
   * O dashboard traz os TOTAIS por etapa (baratos). A lista vem daqui.
   */
  app.get(
    '/api/dashboard/sem-resposta',
    { preHandler: exigirAutenticacao },
    async () => ({ grupos: await leadsSemResposta() })
  );
}
