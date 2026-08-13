/**
 * Intervencao manual — quando VOCE assume a conversa.
 *
 * ============================================================
 * POR QUE ISSO EXISTE
 * ============================================================
 * O sistema para de proposito em varias situacoes: nao entendeu a
 * resposta, o lead ficou quente, uma variavel faltou. Ate aqui os leads
 * eram somente-leitura — o CRM sabia dizer "este lead precisa de voce",
 * mas nao havia nada que voce pudesse fazer na tela. A conversa ficava
 * travada num status sem saida.
 *
 * ============================================================
 * TODA ACAO DEIXA RASTRO
 * ============================================================
 * Cada rota daqui grava um `LeadEvent`. Sem isso, daqui a tres meses
 * ninguem saberia por que um lead saiu de AGUARDANDO_INTERVENCAO — e
 * "quem mudou isso?" e a primeira pergunta quando algo da errado.
 *
 * NENHUMA ROTA AQUI ENVIA MENSAGEM. Assumir a conversa significa que
 * VOCE vai falar com a pessoa, pelo seu WhatsApp.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, Prisma } from '@prospector/database';
import { LEAD_STATUS, TEMPERATURA } from '@prospector/shared';
import { exigirAutenticacao } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';
import { eventsBus } from '../lib/events-bus.js';

const idSchema = z.object({ id: z.string().uuid() });

async function buscarLead(id: string) {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) throw new AppError('Lead não encontrado', 404, 'NAO_ENCONTRADO');
  return lead;
}

/** Cancela a fila pendente do lead. Usado quando a conversa sai do automático. */
async function cancelarFilaDoLead(leadId: string, motivo: string): Promise<number> {
  const r = await prisma.outboundMessage.updateMany({
    where: { leadId, status: { in: ['PENDENTE', 'AGENDADA'] } },
    data: { status: 'CANCELADA', erro: motivo },
  });
  return r.count;
}

export async function rotasLeadAcoes(app: FastifyInstance): Promise<void> {
  // ------------------------------------------------------ mudar o status
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/status',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { status, motivo } = z
        .object({
          status: z.enum(LEAD_STATUS as unknown as [string, ...string[]]),
          motivo: z.string().trim().max(500).optional(),
        })
        .parse(request.body);

      const lead = await buscarLead(id);

      // Opt-out nao entra por aqui. Ele tem rota propria, com confirmacao,
      // porque e a unica mudanca de status que o sistema trata como
      // promessa feita a outra pessoa.
      if (status === 'OPT_OUT') {
        throw new AppError(
          'Use POST /api/leads/:id/opt-out para registrar um opt-out',
          422,
          'USE_ROTA_OPT_OUT'
        );
      }
      if (lead.optOut) {
        throw new AppError(
          'Este lead pediu para não ser mais contatado. Reverta o opt-out antes de mudar o status.',
          422,
          'LEAD_EM_OPT_OUT'
        );
      }

      if (lead.status === status) return { lead };

      const atualizado = await prisma.lead.update({
        where: { id },
        data: { status: status as never },
      });

      await prisma.leadEvent.create({
        data: {
          leadId: id,
          tipo: 'STATUS_ALTERADO',
          descricao: `Status alterado de ${lead.status} para ${status}${
            motivo ? ` — ${motivo}` : ''
          }`,
          origem: 'usuario',
          dados: { de: lead.status, para: status } as Prisma.InputJsonValue,
        },
      });

      // Sair do automático cancela o que estava agendado. Se a fila
      // continuasse andando, o sistema mandaria a próxima etapa por cima
      // da conversa que você acabou de assumir.
      if (['PAUSADO', 'ENCERRADO', 'CLIENTE', 'AGUARDANDO_INTERVENCAO'].includes(status)) {
        await cancelarFilaDoLead(id, `Lead movido para ${status}`);
      }

      eventsBus.publicar('lead.status_alterado', { leadId: id, status });
      return { lead: atualizado };
    }
  );

  // ------------------------------------------------- mudar a temperatura
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/temperatura',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { temperatura } = z
        .object({
          temperatura: z.enum(TEMPERATURA as unknown as [string, ...string[]]),
        })
        .parse(request.body);

      const lead = await buscarLead(id);
      if (lead.temperatura === temperatura) return { lead };

      const atualizado = await prisma.lead.update({
        where: { id },
        data: { temperatura: temperatura as never },
      });

      await prisma.leadEvent.create({
        data: {
          leadId: id,
          tipo: 'TEMPERATURA_ALTERADA',
          descricao: `Temperatura alterada de ${lead.temperatura} para ${temperatura}`,
          origem: 'usuario',
          dados: { de: lead.temperatura, para: temperatura } as Prisma.InputJsonValue,
        },
      });

      eventsBus.publicar('lead.temperatura_alterada', { leadId: id, temperatura });
      return { lead: atualizado };
    }
  );

  // --------------------------------------------- resolver a intervencao
  //
  // O caso central da Fase 5: o sistema parou, voce resolveu, a conversa
  // volta a andar (ou termina).
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/resolver-intervencao',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { novoStatus, nota, concluirTarefas } = z
        .object({
          novoStatus: z
            .enum(['EM_CONVERSA', 'AGENDADO', 'PAUSADO', 'ENCERRADO', 'OPORTUNIDADE', 'CLIENTE'])
            .default('EM_CONVERSA'),
          nota: z.string().trim().max(2000).optional(),
          concluirTarefas: z.boolean().default(true),
        })
        .parse(request.body ?? {});

      const lead = await buscarLead(id);

      if (lead.status !== 'AGUARDANDO_INTERVENCAO') {
        throw new AppError(
          `Este lead não está aguardando intervenção (está ${lead.status})`,
          422,
          'SEM_INTERVENCAO_PENDENTE'
        );
      }

      const atualizado = await prisma.lead.update({
        where: { id },
        data: {
          status: novoStatus as never,
          // A próxima ação some junto: ela descrevia a intervenção que
          // acabou de ser resolvida.
          proximaAcao: null,
          proximaAcaoEm: null,
          ultimaInteracaoEm: new Date(),
          ...(nota
            ? {
                observacoes: lead.observacoes
                  ? `${lead.observacoes}\n\n${nota}`
                  : nota,
              }
            : {}),
        },
      });

      await prisma.leadEvent.create({
        data: {
          leadId: id,
          tipo: 'INTERVENCAO_RESOLVIDA',
          descricao: nota
            ? `Intervenção resolvida — ${nota}`
            : `Intervenção resolvida; lead movido para ${novoStatus}`,
          origem: 'usuario',
          dados: { novoStatus } as Prisma.InputJsonValue,
        },
      });

      // As tarefas abertas do tipo "resposta não reconhecida" descrevem
      // exatamente o problema que acabou de ser resolvido. Deixá-las
      // abertas faria o contador do dashboard mentir.
      let tarefasConcluidas = 0;
      if (concluirTarefas) {
        const r = await prisma.task.updateMany({
          where: {
            leadId: id,
            tipo: { in: ['RESPOSTA_NAO_RECONHECIDA', 'RESPONDER_CLIENTE'] },
            status: { in: ['ABERTA', 'EM_ANDAMENTO'] },
          },
          data: { status: 'CONCLUIDA', concluidaEm: new Date() },
        });
        tarefasConcluidas = r.count;
      }

      // Notificações sobre este lead já não pedem ação.
      await prisma.notification.updateMany({
        where: { leadId: id, tipo: 'INTERVENCAO_NECESSARIA', lida: false },
        data: { lida: true, lidaEm: new Date() },
      });

      eventsBus.publicar('lead.status_alterado', { leadId: id, status: novoStatus });
      eventsBus.publicar('dashboard.atualizar');

      return { lead: atualizado, tarefasConcluidas };
    }
  );

  // ------------------------------------------------------ marcar opt-out
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/opt-out',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { motivo } = z
        .object({ motivo: z.string().trim().max(500).optional() })
        .parse(request.body ?? {});

      const lead = await buscarLead(id);
      if (lead.optOut) return { lead, canceladas: 0 };

      const atualizado = await prisma.lead.update({
        where: { id },
        data: {
          optOut: true,
          optOutEm: new Date(),
          status: 'OPT_OUT',
          proximaAcao: null,
          proximaAcaoEm: null,
        },
      });

      // Opt-out sem cancelar a fila seria uma promessa quebrada: a pessoa
      // pediu para parar e receberia a próxima etapa mesmo assim.
      const canceladas = await cancelarFilaDoLead(id, 'Lead registrou opt-out');

      await prisma.leadEvent.create({
        data: {
          leadId: id,
          tipo: 'OPT_OUT_REGISTRADO',
          descricao: motivo
            ? `Opt-out registrado manualmente — ${motivo}`
            : 'Opt-out registrado manualmente',
          origem: 'usuario',
        },
      });

      eventsBus.publicar('lead.status_alterado', { leadId: id, status: 'OPT_OUT' });
      return { lead: atualizado, canceladas };
    }
  );

  // ----------------------------------------------------- reverter opt-out
  //
  // Existe porque um clique errado nao pode condenar um lead para sempre.
  // Mas exige confirmacao e justificativa, e grava o evento: desfazer um
  // opt-out e uma decisao que precisa ter dono.
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/opt-out/reverter',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { confirmar, motivo } = z
        .object({
          confirmar: z.literal(true),
          motivo: z.string().trim().min(3).max(500),
        })
        .parse(request.body);

      const lead = await buscarLead(id);
      if (!lead.optOut) {
        throw new AppError('Este lead não está em opt-out', 422, 'SEM_OPT_OUT');
      }

      const atualizado = await prisma.lead.update({
        where: { id },
        data: { optOut: false, optOutEm: null, status: 'PAUSADO' },
      });

      await prisma.leadEvent.create({
        data: {
          leadId: id,
          tipo: 'OPT_OUT_REGISTRADO',
          descricao: `OPT-OUT REVERTIDO manualmente — ${motivo}`,
          origem: 'usuario',
          dados: { revertido: true, confirmado: confirmar } as Prisma.InputJsonValue,
        },
      });

      request.log.warn({ leadId: id, motivo }, 'Opt-out revertido manualmente');

      // Volta como PAUSADO, nunca direto para a campanha: retomar o envio
      // automático tem que ser um segundo ato consciente.
      eventsBus.publicar('lead.status_alterado', { leadId: id, status: 'PAUSADO' });
      return { lead: atualizado };
    }
  );

  // -------------------------------------------------------- anotar algo
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/nota',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { texto } = z
        .object({ texto: z.string().trim().min(1).max(2000) })
        .parse(request.body);

      const lead = await buscarLead(id);
      const carimbo = new Date().toLocaleString('pt-BR');

      const atualizado = await prisma.lead.update({
        where: { id },
        data: {
          observacoes: lead.observacoes
            ? `${lead.observacoes}\n\n[${carimbo}] ${texto}`
            : `[${carimbo}] ${texto}`,
        },
      });

      await prisma.leadEvent.create({
        data: {
          leadId: id,
          tipo: 'STATUS_ALTERADO',
          descricao: `Nota adicionada: ${texto.slice(0, 120)}`,
          origem: 'usuario',
        },
      });

      eventsBus.publicar('lead.atualizado', { leadId: id });
      return { lead: atualizado };
    }
  );

  // ------------------------------------------------- definir proxima acao
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/proxima-acao',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { texto, quando } = z
        .object({
          texto: z.string().trim().max(300).nullable(),
          quando: z.coerce.date().nullable().optional(),
        })
        .parse(request.body);

      await buscarLead(id);

      const atualizado = await prisma.lead.update({
        where: { id },
        data: { proximaAcao: texto, proximaAcaoEm: quando ?? null },
      });

      eventsBus.publicar('lead.atualizado', { leadId: id });
      return { lead: atualizado };
    }
  );
}
