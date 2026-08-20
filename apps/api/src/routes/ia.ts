/**
 * O que a IA andou decidindo.
 *
 * ============================================================
 * POR QUE ISTO PRECISA DE TELA
 * ============================================================
 * A IA passou a decidir o que acontece com os seus leads. Sem uma tela,
 * a unica forma de saber o que ela fez seria abrir o Postgres e escrever
 * SQL — o que na pratica significa nunca conferir.
 *
 * E conferir importa por dois motivos opostos: para ver se ela esta
 * ajudando, e para ver se esta atrapalhando.
 *
 * ============================================================
 * O QUE ESTAS ROTAS NAO FAZEM
 * ============================================================
 * Nao alteram nada. Nem uma decisao, nem um lead, nem uma configuracao.
 * Sao leitura pura. Ligar ou desligar a IA continua sendo uma edicao do
 * `.env` seguida de reinicio — de proposito, para que uma tela aberta no
 * navegador nao consiga mudar quem comanda a cadencia.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, lerRetratoParaConferir } from '@prospector/database';
import { detectarInconsistencias, resumirInconsistencias } from '@prospector/domain';
import { exigirAutenticacao } from '../plugins/auth.js';

const listagemSchema = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  /** Só o que divergiu do motor — o filtro mais util da tela. */
  divergiu: z.coerce.boolean().optional(),
  /** Só as que cairam no motor por falha da IA. */
  fallback: z.coerce.boolean().optional(),
  leadId: z.string().uuid().optional(),
});

export async function rotasIa(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', exigirAutenticacao);

  /**
   * O resumo: e daqui que sai a resposta para "a IA esta ajudando?".
   */
  app.get('/api/ia/resumo', async () => {
    const [
      total,
      divergencias,
      fallbacks,
      intervencoes,
      optOuts,
      porAcao,
      porIntent,
      rejeicoes,
      latencia,
      ultima,
    ] = await Promise.all([
      prisma.aiDecision.count(),
      prisma.aiDecision.count({ where: { divergiu: true } }),
      prisma.aiDecision.count({ where: { fallback: true } }),
      prisma.aiDecision.count({ where: { acaoExecutada: 'CREATE_INTERVENTION' } }),
      prisma.aiDecision.count({ where: { intentIa: 'OPT_OUT' } }),
      prisma.aiDecision.groupBy({ by: ['acaoExecutada'], _count: true }),
      prisma.aiDecision.groupBy({
        by: ['intentIa'],
        where: { intentIa: { not: null } },
        _count: true,
      }),
      prisma.aiDecision.groupBy({
        by: ['motivoRejeicao'],
        where: { motivoRejeicao: { not: null } },
        _count: true,
      }),
      prisma.aiDecision.aggregate({
        _avg: { latenciaMs: true },
        _max: { latenciaMs: true },
      }),
      prisma.aiDecision.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, modelo: true },
      }),
    ]);

    return {
      total,
      divergencias,
      fallbacks,
      intervencoes,
      optOuts,
      modelo: ultima?.modelo ?? null,
      ultimaEm: ultima?.createdAt ?? null,
      latenciaMediaMs:
        latencia._avg.latenciaMs === null ? null : Math.round(latencia._avg.latenciaMs),
      latenciaMaximaMs: latencia._max.latenciaMs,
      porAcao: porAcao
        .map((a) => ({ acao: a.acaoExecutada ?? '(nenhuma)', total: a._count }))
        .sort((a, b) => b.total - a.total),
      porIntent: porIntent
        .map((i) => ({ intent: i.intentIa!, total: i._count }))
        .sort((a, b) => b.total - a.total),
      // O que a guarda barrou. Aparecer aqui e o sistema funcionando —
      // o que interessa e QUAL barreira, e com que frequencia.
      rejeicoes: rejeicoes
        .map((r) => ({ motivo: r.motivoRejeicao!, total: r._count }))
        .sort((a, b) => b.total - a.total),
    };
  });

  /** A lista, para ler decisao por decisao. */
  app.get('/api/ia/decisoes', async (req) => {
    const q = listagemSchema.parse(req.query);

    const decisoes = await prisma.aiDecision.findMany({
      where: {
        ...(q.divergiu === undefined ? {} : { divergiu: q.divergiu }),
        ...(q.fallback === undefined ? {} : { fallback: q.fallback }),
        ...(q.leadId ? { leadId: q.leadId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limite,
      select: {
        id: true,
        createdAt: true,
        gatilho: true,
        intentIa: true,
        acaoIa: true,
        acaoMotor: true,
        acaoExecutada: true,
        motivoRejeicao: true,
        confianca: true,
        motivo: true,
        divergiu: true,
        fallback: true,
        erro: true,
        modelo: true,
        latenciaMs: true,
        etapaOrdem: true,
        lead: { select: { id: true, empresa: true, nomeCompleto: true } },
        campaign: { select: { id: true, nome: true } },
      },
    });

    return { decisoes };
  });

  /**
   * As inconsistencias, calculadas AGORA.
   *
   * Sem correcao nenhuma — nem a de opt-out, que a passada do worker faz
   * sozinha. Uma tela que conserta o que mostra esconde o proprio
   * historico de problemas.
   */
  app.get('/api/ia/reconciliacao', async () => {
    // A leitura vem do package de banco, e a deteccao do dominio. A API
    // NAO importa nada do worker: sao apps separados de proposito — o
    // worker carrega um Chromium inteiro, e a API nao pode arrastar isso.
    const retrato = await lerRetratoParaConferir();
    const achados = detectarInconsistencias(retrato);
    return { resumo: resumirInconsistencias(achados), achados };
  });
}
