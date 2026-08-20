/**
 * Conversas — a caixa de entrada.
 *
 * Somente leitura, com duas excecoes: marcar como lida e retomar a
 * automacao. Assumir a conversa continua sendo a rota da Fase 5
 * (`/api/leads/:id/status`), que ja faz o que precisa.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, Prisma } from '@prospector/database';
import { exigirAutenticacao } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';
import { eventsBus } from '../lib/events-bus.js';
import { pedirOrquestracao } from '../lib/pedir-orquestracao.js';

const idSchema = z.object({ id: z.string().uuid() });

export async function rotasConversas(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------- caixa de entrada
  app.get('/api/conversas', { preHandler: exigirAutenticacao }, async (request) => {
    const { busca, apenasNaoLidas, limite } = z
      .object({
        busca: z.string().trim().optional(),
        apenasNaoLidas: z.coerce.boolean().default(false),
        limite: z.coerce.number().int().min(1).max(200).default(100),
      })
      .parse(request.query);

    const where: Prisma.ConversationWhereInput = {
      ...(apenasNaoLidas ? { naoLidas: { gt: 0 } } : {}),
      ...(busca
        ? {
            lead: {
              OR: [
                { nomeCompleto: { contains: busca, mode: 'insensitive' } },
                { empresa: { contains: busca, mode: 'insensitive' } },
                { telefone: { contains: busca } },
              ],
            },
          }
        : {}),
    };

    const [conversas, naoLidas] = await Promise.all([
      prisma.conversation.findMany({
        where,
        // Quem falou por último vem primeiro: é a ordem de uma caixa de
        // entrada, e é o que coloca na frente quem está esperando.
        orderBy: [{ ultimaMensagemEm: { sort: 'desc', nulls: 'last' } }],
        take: limite,
        include: {
          lead: {
            select: {
              id: true, nomeCompleto: true, empresa: true, telefone: true,
              cidade: true, temperatura: true, status: true, optOut: true,
              ultimaCategoria: true, proximaAcao: true,
            },
          },
          campaign: { select: { id: true, nome: true } },
        },
      }),
      prisma.conversation.count({ where: { naoLidas: { gt: 0 } } }),
    ]);

    return { conversas, naoLidas };
  });

  // ------------------------------------------------- contatos desconhecidos
  //
  // Quem escreveu e nao e lead. Fica visivel de proposito: se alguem
  // responde de um segundo numero, ou se o telefone do lead esta
  // cadastrado errado, a mensagem nao pode sumir sem rastro.
  app.get(
    '/api/conversas/desconhecidos',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { incluirResolvidos } = z
        .object({ incluirResolvidos: z.coerce.boolean().default(false) })
        .parse(request.query);

      const contatos = await prisma.unknownContact.findMany({
        where: incluirResolvidos ? {} : { resolvido: false },
        orderBy: { recebidaEm: 'desc' },
        take: 200,
      });

      return {
        contatos,
        pendentes: await prisma.unknownContact.count({ where: { resolvido: false } }),
      };
    }
  );

  /** Marca um contato desconhecido como tratado. */
  app.post<{ Params: { id: string } }>(
    '/api/conversas/desconhecidos/:id/resolver',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { leadId } = z
        .object({ leadId: z.string().uuid().nullable().optional() })
        .parse(request.body ?? {});

      const contato = await prisma.unknownContact.findUnique({ where: { id } });
      if (!contato) throw new AppError('Contato não encontrado', 404, 'NAO_ENCONTRADO');

      const atualizado = await prisma.unknownContact.update({
        where: { id },
        data: {
          resolvido: true,
          resolvidoEm: new Date(),
          resolvidoLeadId: leadId ?? null,
        },
      });

      // A mensagem original NAO e movida para o lead: reprocessar um
      // texto antigo aplicaria efeitos (mudanca de etapa, opt-out) com
      // base em algo que ja passou. O registro fica como historico.
      if (leadId) {
        await prisma.leadEvent.create({
          data: {
            leadId,
            tipo: 'MENSAGEM_RECEBIDA',
            descricao: `Contato desconhecido associado manualmente: "${contato.texto.slice(0, 120)}"`,
            origem: 'usuario',
          },
        });
      }

      eventsBus.publicar('dashboard.atualizar');
      return { contato: atualizado };
    }
  );

  // ------------------------------------------------------------ uma conversa
  app.get<{ Params: { leadId: string } }>(
    '/api/conversas/:leadId',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { leadId } = z
        .object({ leadId: z.string().uuid() })
        .parse(request.params);

      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          id: true, nomeCompleto: true, empresa: true, telefone: true,
          telefoneNormalizado: true, cidade: true, categoria: true,
          status: true, temperatura: true, optOut: true, proximaAcao: true,
          ultimaCategoria: true, observacoes: true,
          campaign: { select: { id: true, nome: true } },
          leadCampaigns: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              status: true,
              campaign: { select: { id: true, nome: true } },
              etapaAtual: { select: { id: true, ordem: true, nome: true } },
            },
          },
          tasks: {
            where: { status: { in: ['ABERTA', 'EM_ANDAMENTO'] } },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!lead) throw new AppError('Lead não encontrado', 404, 'NAO_ENCONTRADO');

      const [mensagens, eventos, fila] = await Promise.all([
        prisma.message.findMany({
          where: { leadId },
          orderBy: { createdAt: 'asc' },
          take: 300,
          select: {
            id: true, direcao: true, status: true, texto: true,
            categoria: true, subtipo: true, confianca: true,
            simulada: true, createdAt: true, recebidaEm: true,
            enviadaEm: true, erro: true,
          },
        }),
        prisma.leadEvent.findMany({
          where: { leadId },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        prisma.outboundMessage.findMany({
          where: { leadId, status: { in: ['PENDENTE', 'AGENDADA'] } },
          orderBy: { scheduledAt: 'asc' },
          select: {
            id: true, status: true, scheduledAt: true, textoRenderizado: true,
            dryRun: true,
          },
        }),
      ]);

      // Abrir a conversa zera o contador — é o gesto de "eu vi".
      await prisma.conversation.updateMany({
        where: { leadId },
        data: { naoLidas: 0 },
      });

      return {
        lead,
        mensagens,
        eventos,
        filaPendente: fila,
        automacao: {
          // Um lead aguardando intervenção está fora do automático: foi
          // você quem assumiu, ou o sistema parou e está esperando.
          ativa: !lead.optOut && lead.status !== 'AGUARDANDO_INTERVENCAO' && lead.status !== 'PAUSADO',
          motivoParada: lead.optOut
            ? 'Lead pediu para não receber mais mensagens'
            : lead.status === 'AGUARDANDO_INTERVENCAO'
              ? (lead.proximaAcao ?? 'Aguardando sua intervenção')
              : lead.status === 'PAUSADO'
                ? 'Lead pausado manualmente'
                : null,
        },
      };
    }
  );

  // -------------------------------------------------------- retomar automacao
  //
  // O caminho de volta depois de "assumir a conversa" (item 13).
  app.post<{ Params: { leadId: string } }>(
    '/api/conversas/:leadId/retomar-automacao',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { leadId } = z
        .object({ leadId: z.string().uuid() })
        .parse(request.params);

      const { confirmar } = z
        .object({ confirmar: z.literal(true) })
        .parse(request.body);

      const lead = await prisma.lead.findUnique({ where: { id: leadId } });
      if (!lead) throw new AppError('Lead não encontrado', 404, 'NAO_ENCONTRADO');

      // --- Verificações antes de devolver o lead ao automático ---
      //
      // Voltar sem checar seria a forma mais fácil de mandar mensagem
      // para quem pediu para parar.
      if (lead.optOut) {
        throw new AppError(
          'Este lead pediu para não ser mais contatado. A automação não pode ser retomada.',
          422,
          'LEAD_EM_OPT_OUT'
        );
      }

      if (lead.status === 'ENCERRADO' || lead.status === 'CLIENTE') {
        throw new AppError(
          `O lead está ${lead.status.toLowerCase()} — não há sequência a retomar.`,
          422,
          'LEAD_FORA_DA_SEQUENCIA'
        );
      }

      const vinculo = await prisma.leadCampaign.findFirst({
        where: { leadId },
        orderBy: { createdAt: 'desc' },
        include: { campaign: { select: { id: true, nome: true, status: true } } },
      });

      if (!vinculo) {
        throw new AppError(
          'Este lead não está em nenhuma campanha.',
          422,
          'SEM_CAMPANHA'
        );
      }

      if (vinculo.campaign.status !== 'ATIVA') {
        throw new AppError(
          `A campanha "${vinculo.campaign.nome}" está ${vinculo.campaign.status}. Ative-a antes de retomar.`,
          422,
          'CAMPANHA_INATIVA'
        );
      }

      // --- Não duplicar ---
      //
      // Se já existe mensagem na fila, retomar não pode criar outra.
      const jaNaFila = await prisma.outboundMessage.count({
        where: { leadId, status: { in: ['PENDENTE', 'AGENDADA'] } },
      });

      const atualizado = await prisma.lead.update({
        where: { id: leadId },
        data: {
          status: 'EM_CAMPANHA',
          proximaAcao: null,
          proximaAcaoEm: null,
        },
      });

      await prisma.leadEvent.create({
        data: {
          leadId,
          tipo: 'RETOMADO_MANUALMENTE',
          descricao:
            jaNaFila > 0
              ? `Automação retomada; ${jaNaFila} mensagem(ns) já estavam na fila e foram mantidas`
              : 'Automação retomada; a próxima etapa será agendada pela campanha',
          origem: 'usuario',
          dados: { confirmado: confirmar, jaNaFila } as Prisma.InputJsonValue,
        },
      });

      eventsBus.publicar('lead.status_alterado', {
        leadId,
        status: 'EM_CAMPANHA',
      });
      eventsBus.publicar('dashboard.atualizar');

      // ============================================================
      // PEDE AO ORQUESTRADOR PARA REAVALIAR
      // ============================================================
      // Retomar nao e "mande a proxima mensagem" — e "pode continuar".
      // Entre a intervencao ter nascido e voce libera-la, o lead pode ter
      // respondido de novo, pedido para parar, ou a campanha pode ter
      // sido pausada.
      //
      // Quem decide o que "continuar" significa AGORA e o orquestrador,
      // olhando o estado atual. Com a IA desligada o pedido nao faz nada
      // e o despachante cuida, como sempre fez.
      //
      // `await` sem try/catch: `pedirOrquestracao` nunca lanca.
      await pedirOrquestracao({
        leadId,
        campaignId: vinculo.campaign.id,
        gatilho: 'OPERADOR_LIBEROU',
        // O evento e "este lead foi liberado nesta campanha". Um
        // duplo-clique produz um job so.
        referencia: `${leadId}-${vinculo.campaign.id}-${Date.now()}`,
        log: request.log,
      });

      return {
        lead: atualizado,
        jaNaFila,
        campanha: vinculo.campaign,
      };
    }
  );
}
