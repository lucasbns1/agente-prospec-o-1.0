/**
 * Notificacoes.
 *
 * A ordenacao e por PRIORIDADE antes de data: uma intervencao necessaria
 * de ontem importa mais que uma importacao concluida agora. A prioridade
 * fica numa coluna indexada — sem ela, ordenar exigiria um CASE sobre o
 * tipo em toda consulta.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@prospector/database';
import { PRIORIDADE_NOTIFICACAO } from '@prospector/shared';
import { exigirAutenticacao } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';
import { eventsBus } from '../lib/events-bus.js';

export async function rotasNotifications(app: FastifyInstance): Promise<void> {
  app.get('/api/notifications', { preHandler: exigirAutenticacao }, async (request) => {
    const { apenasNaoLidas, limite } = z
      .object({
        apenasNaoLidas: z.coerce.boolean().default(false),
        limite: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(request.query);

    const [notificacoes, naoLidas] = await Promise.all([
      prisma.notification.findMany({
        where: apenasNaoLidas ? { lida: false } : {},
        orderBy: [{ lida: 'asc' }, { prioridade: 'asc' }, { createdAt: 'desc' }],
        take: limite,
        include: {
          lead: { select: { id: true, nomeCompleto: true, temperatura: true } },
        },
      }),
      prisma.notification.count({ where: { lida: false } }),
    ]);

    return { notificacoes, naoLidas };
  });

  app.post<{ Params: { id: string } }>(
    '/api/notifications/:id/read',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

      const existente = await prisma.notification.findUnique({ where: { id } });
      if (!existente) {
        throw new AppError('Notificação não encontrada', 404, 'NAO_ENCONTRADO');
      }

      const notificacao = await prisma.notification.update({
        where: { id },
        data: { lida: true, lidaEm: new Date() },
      });

      eventsBus.publicar('notificacao.criada');
      return { notificacao };
    }
  );

  app.post(
    '/api/notifications/read-all',
    { preHandler: exigirAutenticacao },
    async () => {
      const r = await prisma.notification.updateMany({
        where: { lida: false },
        data: { lida: true, lidaEm: new Date() },
      });
      eventsBus.publicar('notificacao.criada');
      return { marcadas: r.count };
    }
  );

  /**
   * DELETE /api/notifications/:id
   *
   * ============================================================
   * LIDA E APAGADA SAO COISAS DIFERENTES
   * ============================================================
   * "Marcar como lida" quer dizer "eu vi". A notificacao continua no
   * historico e continua contando na lista.
   *
   * Apagar quer dizer "isto nao me serve" — o aviso de um lead que voce
   * decidiu ignorar, uma intervencao que voce resolveu por fora, o
   * terceiro aviso identico de um numero que nem existe. Sem esta rota,
   * a unica saida era marcar como lida e conviver com a lista crescendo.
   *
   * ============================================================
   * O QUE APAGAR NAO FAZ
   * ============================================================
   * Nao destrava o lead. Se ele esta em AGUARDANDO_INTERVENCAO, apagar o
   * aviso some com o aviso e deixa o lead parado do mesmo jeito — quem
   * destrava e o botao de liberar, na tela do lead.
   *
   * Isso e deliberado: um botao "apagar" que tambem retomasse a cadencia
   * mandaria mensagem para um cliente seu como efeito colateral de
   * limpar a caixa de avisos.
   */
  app.delete<{ Params: { id: string } }>(
    '/api/notifications/:id',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

      const existente = await prisma.notification.findUnique({ where: { id } });
      if (!existente) {
        throw new AppError('Notificação não encontrada', 404, 'NAO_ENCONTRADO');
      }

      await prisma.notification.delete({ where: { id } });

      eventsBus.publicar('notificacao.criada');
      return { apagada: true };
    }
  );

  /**
   * DELETE /api/notifications/lidas
   *
   * Limpa o que voce ja viu. Nao toca no que esta por ler — apagar em
   * massa uma coisa que voce ainda nao leu e como jogar fora a
   * correspondencia sem abrir.
   */
  app.delete(
    '/api/notifications/lidas',
    { preHandler: exigirAutenticacao },
    async () => {
      const r = await prisma.notification.deleteMany({ where: { lida: true } });
      eventsBus.publicar('notificacao.criada');
      return { apagadas: r.count };
    }
  );
}

/**
 * Cria uma notificacao e avisa o dashboard na hora.
 *
 * Exportada para as proximas fases usarem: e por aqui que a regra
 * "resposta nao reconhecida" vai gritar na sua tela.
 */
export async function criarNotificacao(dados: {
  tipo: string;
  titulo: string;
  mensagem: string;
  nivel?: 'INFO' | 'SUCESSO' | 'ALERTA' | 'ERRO';
  leadId?: string | null;
  userId?: string | null;
  link?: string | null;
}): Promise<void> {
  const prioridade = PRIORIDADE_NOTIFICACAO[dados.tipo] ?? 50;

  const notificacao = await prisma.notification.create({
    data: {
      tipo: dados.tipo as never,
      titulo: dados.titulo,
      mensagem: dados.mensagem,
      nivel: (dados.nivel ?? 'INFO') as never,
      prioridade,
      leadId: dados.leadId ?? null,
      userId: dados.userId ?? null,
      link: dados.link ?? null,
    },
  });

  eventsBus.publicar('notificacao.criada', {
    id: notificacao.id,
    tipo: notificacao.tipo,
    nivel: notificacao.nivel,
    titulo: notificacao.titulo,
    mensagem: notificacao.mensagem,
    link: notificacao.link,
    prioridade,
  });
}
