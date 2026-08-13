/**
 * Tarefas — o que VOCE precisa fazer.
 *
 * A tabela existe desde a Fase 1, mas nunca teve rota: as tarefas eram
 * criadas pelo sistema e ficavam invisiveis. Isso e pior do que nao ter
 * tarefa nenhuma, porque o dashboard contava um numero que nao dava para
 * abrir.
 *
 * Uma tarefa nao envia nada e nao muda o lead sozinha. Ela e um lembrete
 * com prazo, ligado a um lead.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, Prisma } from '@prospector/database';
import { exigirAutenticacao } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';
import { eventsBus } from '../lib/events-bus.js';

const TIPOS = [
  'CRIAR_PREVIEW',
  'RESPONDER_CLIENTE',
  'ENVIAR_PROPOSTA',
  'FOLLOW_UP',
  'VERIFICAR_LEAD',
  'RESPOSTA_NAO_RECONHECIDA',
  'REVISAR_VARIAVEL_FALTANDO',
  'OUTRO',
] as const;

const PRIORIDADES = ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'] as const;
const STATUS = ['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'] as const;

const idSchema = z.object({ id: z.string().uuid() });

const criarSchema = z.object({
  leadId: z.string().uuid().nullable().optional(),
  tipo: z.enum(TIPOS).default('OUTRO'),
  titulo: z.string().trim().min(1).max(200),
  descricao: z.string().trim().max(2000).nullable().optional(),
  prioridade: z.enum(PRIORIDADES).default('MEDIA'),
  // Aceita ISO ou `null` para "sem prazo". Sem prazo a tarefa nunca
  // aparece como atrasada — e isso e proposital, nao um esquecimento.
  prazo: z.coerce.date().nullable().optional(),
});

const editarSchema = criarSchema.partial().extend({
  status: z.enum(STATUS).optional(),
});

export async function rotasTasks(app: FastifyInstance): Promise<void> {
  // --------------------------------------------------------------- lista
  app.get('/api/tasks', { preHandler: exigirAutenticacao }, async (request) => {
    const { status, prioridade, tipo, leadId, apenasAtrasadas, limite } = z
      .object({
        status: z.enum(STATUS).optional(),
        prioridade: z.enum(PRIORIDADES).optional(),
        tipo: z.enum(TIPOS).optional(),
        leadId: z.string().uuid().optional(),
        apenasAtrasadas: z.coerce.boolean().default(false),
        limite: z.coerce.number().int().min(1).max(200).default(100),
      })
      .parse(request.query);

    const agora = new Date();

    const where: Prisma.TaskWhereInput = {
      ...(status ? { status } : {}),
      ...(prioridade ? { prioridade } : {}),
      ...(tipo ? { tipo } : {}),
      ...(leadId ? { leadId } : {}),
      ...(apenasAtrasadas
        ? { prazo: { lt: agora }, status: { in: ['ABERTA', 'EM_ANDAMENTO'] } }
        : {}),
    };

    const [tarefas, contagem] = await Promise.all([
      prisma.task.findMany({
        where,
        // Abertas primeiro, depois as mais urgentes, depois as com prazo
        // mais proximo. `nulls: 'last'` importa: tarefa sem prazo nao pode
        // aparecer antes de uma que vence hoje.
        orderBy: [
          { status: 'asc' },
          { prioridade: 'desc' },
          { prazo: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        take: limite,
        include: {
          lead: {
            select: {
              id: true, nomeCompleto: true, empresa: true, telefone: true,
              cidade: true, temperatura: true, status: true,
            },
          },
        },
      }),
      prisma.task.groupBy({ by: ['status'], _count: true }),
    ]);

    const atrasadas = await prisma.task.count({
      where: { prazo: { lt: agora }, status: { in: ['ABERTA', 'EM_ANDAMENTO'] } },
    });

    return {
      tarefas,
      contagem: Object.fromEntries(contagem.map((c) => [c.status, c._count])),
      atrasadas,
    };
  });

  // --------------------------------------------------------------- criar
  app.post('/api/tasks', { preHandler: exigirAutenticacao }, async (request, reply) => {
    const dados = criarSchema.parse(request.body);

    if (dados.leadId) {
      const lead = await prisma.lead.findUnique({ where: { id: dados.leadId } });
      if (!lead) throw new AppError('Lead não encontrado', 404, 'NAO_ENCONTRADO');
    }

    const tarefa = await prisma.task.create({
      data: {
        leadId: dados.leadId ?? null,
        userId: request.usuario?.id ?? null,
        tipo: dados.tipo,
        titulo: dados.titulo,
        descricao: dados.descricao ?? null,
        prioridade: dados.prioridade,
        prazo: dados.prazo ?? null,
      },
    });

    if (dados.leadId) {
      await prisma.leadEvent.create({
        data: {
          leadId: dados.leadId,
          tipo: 'TAREFA_CRIADA',
          descricao: `Tarefa criada: ${dados.titulo}`,
          origem: 'usuario',
        },
      });
    }

    eventsBus.publicar('tarefa.criada', { tarefaId: tarefa.id });
    return reply.status(201).send({ tarefa });
  });

  // -------------------------------------------------------------- editar
  app.patch<{ Params: { id: string } }>(
    '/api/tasks/:id',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const dados = editarSchema.parse(request.body);

      const existente = await prisma.task.findUnique({ where: { id } });
      if (!existente) throw new AppError('Tarefa não encontrada', 404, 'NAO_ENCONTRADO');

      const virouConcluida =
        dados.status === 'CONCLUIDA' && existente.status !== 'CONCLUIDA';

      const tarefa = await prisma.task.update({
        where: { id },
        data: {
          ...dados,
          prazo: dados.prazo === undefined ? undefined : dados.prazo,
          // `concluidaEm` acompanha o status em vez de ser preenchido por
          // quem chama: assim nao existe tarefa concluida sem data.
          ...(virouConcluida ? { concluidaEm: new Date() } : {}),
          ...(dados.status && dados.status !== 'CONCLUIDA'
            ? { concluidaEm: null }
            : {}),
        },
      });

      if (virouConcluida && tarefa.leadId) {
        await prisma.leadEvent.create({
          data: {
            leadId: tarefa.leadId,
            tipo: 'TAREFA_CONCLUIDA',
            descricao: `Tarefa concluída: ${tarefa.titulo}`,
            origem: 'usuario',
          },
        });
      }

      eventsBus.publicar(virouConcluida ? 'tarefa.concluida' : 'tarefa.criada', {
        tarefaId: tarefa.id,
      });
      return { tarefa };
    }
  );

  // ------------------------------------------------------------- concluir
  //
  // Atalho para o caso mais comum. O PATCH continua servindo para o resto.
  app.post<{ Params: { id: string } }>(
    '/api/tasks/:id/concluir',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);

      const existente = await prisma.task.findUnique({ where: { id } });
      if (!existente) throw new AppError('Tarefa não encontrada', 404, 'NAO_ENCONTRADO');

      const tarefa = await prisma.task.update({
        where: { id },
        data: { status: 'CONCLUIDA', concluidaEm: new Date() },
      });

      if (tarefa.leadId) {
        await prisma.leadEvent.create({
          data: {
            leadId: tarefa.leadId,
            tipo: 'TAREFA_CONCLUIDA',
            descricao: `Tarefa concluída: ${tarefa.titulo}`,
            origem: 'usuario',
          },
        });
      }

      eventsBus.publicar('tarefa.concluida', { tarefaId: tarefa.id });
      return { tarefa };
    }
  );
}

/**
 * Cria uma tarefa a partir do sistema (worker, motor de regras).
 *
 * Exportada para as fases seguintes: e por aqui que "resposta nao
 * reconhecida" vira algo que voce consegue ver e fechar.
 */
export async function criarTarefa(dados: {
  leadId?: string | null;
  tipo: (typeof TIPOS)[number];
  titulo: string;
  descricao?: string | null;
  prioridade?: (typeof PRIORIDADES)[number];
  prazo?: Date | null;
}): Promise<void> {
  const tarefa = await prisma.task.create({
    data: {
      leadId: dados.leadId ?? null,
      tipo: dados.tipo,
      titulo: dados.titulo,
      descricao: dados.descricao ?? null,
      prioridade: dados.prioridade ?? 'MEDIA',
      prazo: dados.prazo ?? null,
    },
  });

  eventsBus.publicar('tarefa.criada', { tarefaId: tarefa.id });
}
