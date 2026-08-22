/**
 * Rotas de campanhas.
 *
 * NENHUMA rota aqui envia mensagem. A mais "perigosa" e
 * `POST /:id/enfileirar`, que cria linhas em `outbound_messages` com
 * `dryRun: true`. O envio depende do worker, que esta em simulacao.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, Prisma } from '@prospector/database';
import {
  montarColunas,
  posicaoNoQuadro,
  chaveDaColuna,
  STATUS_ENCERRADOS,
  STATUS_ESPERANDO_VOCE,
  regrasPadraoDaEtapa,
} from '@prospector/domain';
import { exigirAutenticacao } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';
import { eventsBus } from '../lib/events-bus.js';
import {
  previewCampanha,
  enfileirarCampanha,
  requalificarLeads,
  montarWhere,
  explicarContagem,
  type FiltrosCampanha,
} from '../services/campaign-service.js';

/**
 * Da a uma etapa o conjunto padrao de regras, se ela ainda nao tem
 * nenhuma.
 *
 * ============================================================
 * POR QUE ISTO PRECISA EXISTIR
 * ============================================================
 * `decidirAcao` nao improvisa: categoria sem regra vira intervencao
 * manual. Correto — mas `campaign_step_rules` nao tinha NENHUM caminho
 * para ser preenchida (nao ha tela, nao ha rota, o seed nao cria). Toda
 * etapa nascia sem regra, e por isso TODA resposta caia em intervencao,
 * inclusive um "sim, quero" perfeito. A automacao nunca automatizava.
 *
 * ============================================================
 * SO SEMEIA O QUE ESTA VAZIO
 * ============================================================
 * A checagem de `count` nao e otimizacao: sem ela, salvar as etapas
 * devolveria as regras padrao por cima de qualquer ajuste que voce
 * tivesse feito. Editar o texto da mensagem 1 desfaria a configuracao
 * das respostas — e em silencio.
 */
async function semearRegras(
  tx: Prisma.TransactionClient,
  campaignStepId: string
): Promise<void> {
  const existentes = await tx.campaignStepRule.count({ where: { campaignStepId } });
  if (existentes > 0) return;

  await tx.campaignStepRule.createMany({
    data: regrasPadraoDaEtapa().map((r) => ({
      campaignStepId,
      categoria: r.categoria as never,
      acao: r.acao as never,
      novaTemperatura: r.novaTemperatura as never,
      novoStatus: r.novoStatus as never,
      criarTarefa: r.criarTarefa,
      tarefaTipo: (r.criarTarefa ? 'RESPONDER_CLIENTE' : null) as never,
      tarefaTitulo: r.tarefaTitulo,
      notificar: r.notificar,
    })),
  });
}

const filtrosSchema = z
  .object({
    exigirTelefone: z.boolean().optional(),
    exigirSemSite: z.boolean().optional(),
    exigirComSite: z.boolean().optional(),
    exigirSemInstagram: z.boolean().optional(),
    exigirComInstagram: z.boolean().optional(),
    avaliacaoMinima: z.number().min(0).max(5).optional(),
    totalAvaliacoesMinimo: z.number().int().min(0).optional(),
    cidades: z.array(z.string().trim().min(1)).optional(),
    estados: z.array(z.string().trim().length(2)).optional(),
    categorias: z.array(z.string().trim().min(1)).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    apenasNuncaContatados: z.boolean().optional(),
    status: z.array(z.string()).optional(),
    origem: z.array(z.string()).optional(),
    captureSessionIds: z.array(z.string().uuid()).optional(),
    importIds: z.array(z.string().uuid()).optional(),
  })
  .strict();

const horarioSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM');

// O objeto base fica separado dos `.refine()` porque `.partial()` nao
// existe em ZodEffects — e a rota de edicao precisa de campos parciais.
const campanhaBase = z
  .object({
    nome: z.string().trim().min(1).max(200),
    descricao: z.string().trim().max(2000).nullable().optional(),
    nicho: z.string().trim().max(120).nullable().optional(),
    cidade: z.string().trim().max(120).nullable().optional(),
    estado: z.string().trim().max(2).nullable().optional(),
    delayMinSegundos: z.number().int().min(0).max(86400).default(180),
    delayMaxSegundos: z.number().int().min(0).max(86400).default(240),
    delayEntreLeadsMinSegundos: z.number().int().min(0).max(86400).default(60),
    delayEntreLeadsMaxSegundos: z.number().int().min(0).max(86400).default(180),
    limiteDiarioEnvios: z.number().int().min(1).max(1000).default(50),
    limiteHorarioEnvios: z.number().int().min(1).max(500).default(10),
    horarioInicio: horarioSchema.default('08:00'),
    horarioFim: horarioSchema.default('20:00'),
    diasPermitidos: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
    maxLeads: z.number().int().min(0).max(100000).default(0),
    filtros: filtrosSchema.default({}),
  });

const campanhaSchema = campanhaBase
  .refine((d) => d.delayMaxSegundos >= d.delayMinSegundos, {
    message: 'O delay maximo precisa ser >= ao minimo',
    path: ['delayMaxSegundos'],
  })
  .refine((d) => d.horarioFim > d.horarioInicio, {
    message: 'O horario final precisa ser depois do inicial',
    path: ['horarioFim'],
  });

/** Versao parcial para PATCH, com as mesmas validacoes cruzadas. */
const campanhaPatchSchema = campanhaBase
  .partial()
  // `dryRun` so na EDICAO, nunca na criacao: toda campanha nasce em
  // simulacao, e liberar precisa ser um ato separado e deliberado.
  .extend({ dryRun: z.boolean().optional() })
  .refine(
    (d) =>
      d.delayMinSegundos === undefined ||
      d.delayMaxSegundos === undefined ||
      d.delayMaxSegundos >= d.delayMinSegundos,
    { message: 'O delay maximo precisa ser >= ao minimo', path: ['delayMaxSegundos'] }
  )
  .refine(
    (d) =>
      d.horarioInicio === undefined ||
      d.horarioFim === undefined ||
      d.horarioFim > d.horarioInicio,
    { message: 'O horario final precisa ser depois do inicial', path: ['horarioFim'] }
  );

const etapaSchema = z.object({
  ordem: z.number().int().min(1),
  nome: z.string().trim().max(120).nullable().optional(),
  texto: z.string().trim().max(4000).default(''),
  templateId: z.string().uuid().nullable().optional(),
  ativo: z.boolean().default(true),
  enviarAutomaticamente: z.boolean().default(true),
  aguardarResposta: z.boolean().default(true),
  delayMinSegundos: z.number().int().min(0).max(2592000).nullable().optional(),
  delayMaxSegundos: z.number().int().min(0).max(2592000).nullable().optional(),
  notificarAoChegar: z.boolean().default(false),
  notificacaoTexto: z.string().trim().max(500).nullable().optional(),
});

const idSchema = z.object({ id: z.string().uuid() });

export async function rotasCampaigns(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------- lista
  app.get('/api/campaigns', { preHandler: exigirAutenticacao }, async () => {
    const campanhas = await prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { steps: true, outbound: true, leadCampaigns: true } },
      },
    });

    // Contadores da fila por campanha, numa consulta agregada em vez de
    // uma por campanha.
    const porStatus = await prisma.outboundMessage.groupBy({
      by: ['campaignId', 'status'],
      _count: true,
    });

    const resumo = new Map<string, Record<string, number>>();
    for (const r of porStatus) {
      const atual = resumo.get(r.campaignId) ?? {};
      atual[r.status] = r._count;
      resumo.set(r.campaignId, atual);
    }

    const respostas = await prisma.message.groupBy({
      by: ['campaignId'],
      where: { direcao: 'RECEBIDA', campaignId: { not: null } },
      _count: true,
    });
    const porRespostas = new Map(
      respostas.map((r) => [r.campaignId!, r._count] as const)
    );

    return {
      campanhas: campanhas.map((c) => {
        const fila = resumo.get(c.id) ?? {};
        return {
          ...c,
          totalEtapas: c._count.steps,
          totalNaFila: c._count.outbound,
          agendadas: fila['AGENDADA'] ?? 0,
          bloqueadas: fila['BLOQUEADA'] ?? 0,
          simuladas: fila['SIMULADA'] ?? 0,
          enviadas: fila['ENVIADA'] ?? 0,
          respostas: porRespostas.get(c.id) ?? 0,
        };
      }),
    };
  });

  // -------------------------------------------------------------- criar
  app.post('/api/campaigns', { preHandler: exigirAutenticacao }, async (request, reply) => {
    const dados = campanhaSchema.parse(request.body);

    const campanha = await prisma.campaign.create({
      data: {
        ...dados,
        filtros: dados.filtros as Prisma.InputJsonValue,
        // Toda campanha nasce em RASCUNHO e em dry-run. Ativar exige
        // um ato explicito depois.
        status: 'RASCUNHO',
        dryRun: true,
      },
    });

    request.log.info({ campaignId: campanha.id }, 'Campanha criada');
    return reply.status(201).send({ campanha });
  });

  // ------------------------------------------------------------ detalhe
  app.get<{ Params: { id: string } }>(
    '/api/campaigns/:id',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const campanha = await prisma.campaign.findUnique({
        where: { id },
        include: {
          steps: {
            orderBy: { ordem: 'asc' },
            include: { template: true, rules: true },
          },
        },
      });
      if (!campanha) throw new AppError('Campanha nao encontrada', 404, 'NAO_ENCONTRADO');
      return { campanha };
    }
  );

  // ------------------------------------------------------------ editar
  app.patch<{ Params: { id: string } }>(
    '/api/campaigns/:id',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const dados = campanhaPatchSchema.parse(request.body);

      const existente = await prisma.campaign.findUnique({ where: { id } });
      if (!existente) throw new AppError('Campanha nao encontrada', 404, 'NAO_ENCONTRADO');

      const campanha = await prisma.campaign.update({
        where: { id },
        data: {
          ...dados,
          ...(dados.filtros
            ? { filtros: dados.filtros as Prisma.InputJsonValue }
            : {}),
        },
      });
      return { campanha };
    }
  );

  // ----------------------------------------------------------- excluir
  /**
   * Apaga a campanha.
   *
   * O `onDelete: Cascade` do schema leva junto etapas, fila e vinculos
   * com leads. Os LEADS ficam: eles sao seus, existiam antes da campanha
   * e continuam depois dela.
   *
   * Exige `confirmar: true` no corpo. Um DELETE que obedece de primeira
   * transforma um clique errado em perda de historico — e nao ha desfazer.
   */
  app.delete<{ Params: { id: string } }>(
    '/api/campaigns/:id',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { confirmar } = z
        .object({ confirmar: z.boolean().optional() })
        .parse(request.body ?? {});

      if (confirmar !== true) {
        throw new AppError(
          'Exclusao exige confirmacao explicita',
          422,
          'CONFIRMACAO_NECESSARIA'
        );
      }

      const campanha = await prisma.campaign.findUnique({
        where: { id },
        select: {
          nome: true,
          _count: { select: { outbound: true, leadCampaigns: true } },
        },
      });
      if (!campanha) throw new AppError('Campanha nao encontrada', 404, 'NAO_ENCONTRADO');

      // Mensagem REAL enviada e historico de conversa com uma pessoa.
      // Apagar a campanha apagaria o "de onde veio" daquele contato.
      const enviadasReais = await prisma.outboundMessage.count({
        where: { campaignId: id, status: 'ENVIADA', dryRun: false },
      });
      if (enviadasReais > 0) {
        throw new AppError(
          `Esta campanha ja enviou ${enviadasReais} mensagem(ns) real(is). Arquive em vez de apagar, para nao perder o historico.`,
          422,
          'CAMPANHA_COM_ENVIO_REAL'
        );
      }

      await prisma.campaign.delete({ where: { id } });

      request.log.info(
        { campaignId: id, nome: campanha.nome, ...campanha._count },
        'Campanha excluida'
      );
      eventsBus.publicar('dashboard.atualizar');

      return { excluida: true, nome: campanha.nome };
    }
  );

  // ------------------------------------------------------- mudar status
  app.post<{ Params: { id: string } }>(
    '/api/campaigns/:id/status',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { status } = z
        .object({
          status: z.enum(['RASCUNHO', 'ATIVA', 'PAUSADA', 'CONCLUIDA', 'ARQUIVADA']),
        })
        .parse(request.body);

      const campanha = await prisma.campaign.findUnique({
        where: { id },
        include: { steps: { where: { ativo: true } } },
      });
      if (!campanha) throw new AppError('Campanha nao encontrada', 404, 'NAO_ENCONTRADO');

      // Nao deixa ativar campanha sem etapa: ela ficaria "ativa" sem
      // conseguir enfileirar nada, e o erro so apareceria depois.
      if (status === 'ATIVA' && campanha.steps.length === 0) {
        throw new AppError(
          'A campanha precisa de pelo menos uma etapa ativa antes de ser ativada',
          422,
          'CAMPANHA_SEM_ETAPA'
        );
      }

      const atualizada = await prisma.campaign.update({
        where: { id },
        data: {
          status,
          ...(status === 'ATIVA' ? { iniciadaEm: new Date() } : {}),
          ...(status === 'PAUSADA' ? { pausadaEm: new Date() } : {}),
          ...(status === 'CONCLUIDA' ? { concluidaEm: new Date() } : {}),
        },
      });

      // Pausar cancela o que ainda nao saiu. Sem isso, "pausar" seria
      // apenas cosmetico e o worker continuaria processando a fila.
      if (status === 'PAUSADA' || status === 'ARQUIVADA') {
        const canceladas = await prisma.outboundMessage.updateMany({
          where: { campaignId: id, status: { in: ['PENDENTE', 'AGENDADA'] } },
          data: { status: 'CANCELADA', erro: `Campanha ${status.toLowerCase()}` },
        });
        request.log.info(
          { campaignId: id, canceladas: canceladas.count },
          'Fila cancelada pela mudanca de status'
        );
      }

      eventsBus.publicar(
        status === 'ATIVA' ? 'campanha.iniciada' : 'campanha.pausada',
        { campaignId: id }
      );

      return { campanha: atualizada };
    }
  );

  // ------------------------------------------------------------- etapas
  app.put<{ Params: { id: string } }>(
    '/api/campaigns/:id/steps',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { etapas } = z.object({ etapas: z.array(etapaSchema) }).parse(request.body);

      const campanha = await prisma.campaign.findUnique({ where: { id } });
      if (!campanha) throw new AppError('Campanha nao encontrada', 404, 'NAO_ENCONTRADO');

      const ordens = etapas.map((e) => e.ordem);
      if (new Set(ordens).size !== ordens.length) {
        throw new AppError('Ha etapas com a mesma ordem', 422, 'ORDEM_DUPLICADA');
      }
      for (const e of etapas) {
        if (!e.templateId && e.texto.trim() === '') {
          throw new AppError(
            `Etapa ${e.ordem} precisa de um texto ou de um template`,
            422,
            'ETAPA_SEM_TEXTO'
          );
        }
      }

      // ============================================================
      // ATUALIZA EM VEZ DE RECRIAR
      // ============================================================
      // A versao anterior fazia `deleteMany` + `create`. Como
      // `LeadCampaign.etapaAtual` tem `onDelete: SetNull`, apagar as
      // etapas zerava a posicao de TODOS os leads: quem estava na
      // "Mensagem 1" voltava para "Na fila", ainda marcado com
      // "1 enviada". O quadro se contradizia na propria tela.
      //
      // Pior: `OutboundMessage` tem `onDelete: Cascade` — a fila inteira
      // sumia junto, sem aviso. Corrigir um typo no texto apagava o
      // trabalho da campanha.
      //
      // Agora as etapas existentes sao atualizadas pela ORDEM, que e o
      // que o usuario enxerga na tela. So o excedente e apagado.
      await prisma.$transaction(async (tx) => {
        const atuais = await tx.campaignStep.findMany({
          where: { campaignId: id },
          orderBy: { ordem: 'asc' },
          select: { id: true, ordem: true },
        });

        // Sobras primeiro: se a lista encolheu, as etapas do fim saem
        // antes de qualquer update, senao a constraint de ordem unica
        // poderia colidir no meio do caminho.
        const sobrando = atuais.filter((a) => a.ordem > etapas.length);
        if (sobrando.length > 0) {
          await tx.campaignStep.deleteMany({
            where: { id: { in: sobrando.map((s) => s.id) } },
          });
        }

        const porOrdem = new Map(atuais.map((a) => [a.ordem, a.id]));

        for (const e of etapas) {
          const dados = {
            nome: e.nome ?? null,
            texto: e.texto,
            templateId: e.templateId ?? null,
            ativo: e.ativo,
            enviarAutomaticamente: e.enviarAutomaticamente,
            aguardarResposta: e.aguardarResposta,
            delayMinSegundos: e.delayMinSegundos ?? null,
            delayMaxSegundos: e.delayMaxSegundos ?? null,
            notificarAoChegar: e.notificarAoChegar,
            notificacaoTexto: e.notificacaoTexto ?? null,
          };

          const existente = porOrdem.get(e.ordem);
          if (existente) {
            await tx.campaignStep.update({ where: { id: existente }, data: dados });
          } else {
            const criada = await tx.campaignStep.create({
              data: { campaignId: id, ordem: e.ordem, ...dados },
              select: { id: true },
            });
            await semearRegras(tx, criada.id);
          }
        }

        // Etapas que ja existiam e nunca receberam regra: o mesmo
        // problema, so que nas campanhas criadas antes desta correcao.
        // Sem isto, quem ja tinha campanha continuaria com TODA resposta
        // caindo em intervencao manual.
        for (const a of atuais) {
          if (a.ordem <= etapas.length) await semearRegras(tx, a.id);
        }
      });

      const atualizadas = await prisma.campaignStep.findMany({
        where: { campaignId: id },
        orderBy: { ordem: 'asc' },
        include: { template: true },
      });
      return { etapas: atualizadas };
    }
  );

  // ------------------------------------------------------------ preview
  app.get<{ Params: { id: string } }>(
    '/api/campaigns/:id/preview',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { limite } = z
        .object({ limite: z.coerce.number().int().min(1).max(500).default(100) })
        .parse(request.query);

      try {
        return await previewCampanha(id, limite);
      } catch (err) {
        throw new AppError(
          err instanceof Error ? err.message : 'Falha ao gerar a previa',
          404,
          'PREVIEW_FALHOU'
        );
      }
    }
  );

  // ------------------------------------------- preview de um lead so
  app.get<{ Params: { id: string; leadId: string } }>(
    '/api/campaigns/:id/preview/:leadId',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id, leadId } = z
        .object({ id: z.string().uuid(), leadId: z.string().uuid() })
        .parse(request.params);

      const preview = await previewCampanha(id, 500);
      const linha = preview.linhas.find((l) => l.leadId === leadId);
      if (!linha) {
        throw new AppError(
          'Este lead nao esta entre os selecionados pelos filtros da campanha',
          404,
          'LEAD_FORA_DO_FILTRO'
        );
      }

      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          id: true, nomeCompleto: true, empresa: true, categoria: true,
          telefone: true, cidade: true, bairro: true, estado: true,
          websiteUrl: true, websiteStatus: true, instagramUrl: true,
          avaliacao: true, totalAvaliacoes: true, status: true,
          qualificacao: true, motivoQualificacao: true, tags: true,
        },
      });

      return { lead, preview: linha, templateUsado: preview.templateUsado };
    }
  );

  // --------------------------------------------------------- enfileirar
  app.post<{ Params: { id: string } }>(
    '/api/campaigns/:id/enfileirar',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { limite, leadIds } = z
        .object({
          limite: z.coerce.number().int().min(1).max(5000).optional(),
          // Selecao explicita, vinda das caixas marcadas na previa.
          leadIds: z.array(z.string().uuid()).max(5000).optional(),
        })
        .parse(request.body ?? {});

      try {
        const r = await enfileirarCampanha(id, {
          ...(limite ? { limite } : {}),
          ...(leadIds?.length ? { leadIds } : {}),
        });
        request.log.info({ campaignId: id, ...r }, 'Campanha enfileirada (dry-run)');
        eventsBus.publicar('dashboard.atualizar');
        return r;
      } catch (err) {
        throw new AppError(
          err instanceof Error ? err.message : 'Falha ao enfileirar',
          422,
          'ENFILEIRAMENTO_FALHOU'
        );
      }
    }
  );

  // ---------------------------------------------------------- ver a fila
  app.get<{ Params: { id: string } }>(
    '/api/campaigns/:id/fila',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { status, limite } = z
        .object({
          status: z.string().optional(),
          limite: z.coerce.number().int().min(1).max(500).default(100),
        })
        .parse(request.query);

      const mensagens = await prisma.outboundMessage.findMany({
        where: { campaignId: id, ...(status ? { status: status as never } : {}) },
        orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
        take: limite,
        include: {
          lead: { select: { id: true, nomeCompleto: true, empresa: true, cidade: true } },
        },
      });

      const contagem = await prisma.outboundMessage.groupBy({
        by: ['status'],
        where: { campaignId: id },
        _count: true,
      });

      return {
        mensagens,
        contagem: Object.fromEntries(contagem.map((c) => [c.status, c._count])),
      };
    }
  );

  // ------------------------------------------------------------- quadro
  /**
   * O quadro da campanha: quem esta em qual mensagem.
   *
   * Uma consulta por coluna, com teto de cartoes, em vez de trazer todos
   * os leads e agrupar na memoria — uma campanha com milhares de leads
   * derrubaria a tela e o servidor junto.
   *
   * As contagens vem de um `groupBy` separado e sao EXATAS, mesmo quando
   * a coluna mostra so os primeiros cartoes. O numero no topo da coluna
   * e a verdade; os cartoes sao uma amostra dela.
   */
  app.get<{ Params: { id: string } }>(
    '/api/campaigns/:id/quadro',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { porColuna } = z
        .object({
          porColuna: z.coerce.number().int().min(1).max(100).default(20),
        })
        .parse(request.query);

      const campanha = await prisma.campaign.findUnique({
        where: { id },
        select: {
          id: true, nome: true, status: true, dryRun: true,
          steps: {
            where: { ativo: true },
            select: { id: true, ordem: true, nome: true },
            orderBy: { ordem: 'asc' },
          },
        },
      });
      if (!campanha) throw new AppError('Campanha nao encontrada', 404, 'NAO_ENCONTRADO');

      const colunas = montarColunas(campanha.steps);

      // Status que NAO estao numa coluna fixa. Definido por exclusao, e
      // nao por lista propria: assim um status novo aparece na etapa em
      // vez de sumir do quadro.
      const forasDaSequencia = [...STATUS_ENCERRADOS, ...STATUS_ESPERANDO_VOCE];

      const whereDaColuna = (c: (typeof colunas)[number]): Prisma.LeadCampaignWhereInput => {
        if (c.tipo === 'ENCERRADO') {
          return { campaignId: id, status: { in: STATUS_ENCERRADOS as never } };
        }
        if (c.tipo === 'PRECISA_DE_VOCE') {
          return { campaignId: id, status: { in: STATUS_ESPERANDO_VOCE as never } };
        }
        return {
          campaignId: id,
          status: { notIn: forasDaSequencia as never },
          etapaAtualId: c.tipo === 'NA_FILA' ? null : c.etapaId,
        };
      };

      const [contagens, ...amostras] = await Promise.all([
        prisma.leadCampaign.groupBy({
          by: ['status', 'etapaAtualId'],
          where: { campaignId: id },
          _count: true,
        }),
        ...colunas.map((c) =>
          prisma.leadCampaign.findMany({
            where: whereDaColuna(c),
            // Mais recente primeiro: o que mexeu agora e o que voce quer ver.
            orderBy: { updatedAt: 'desc' },
            take: porColuna,
            select: {
              id: true,
              status: true,
              proximoEnvioEm: true,
              aguardandoLiberacao: true,
              totalEnviadas: true,
              totalRecebidas: true,
              updatedAt: true,
              lead: {
                select: {
                  id: true, nomeCompleto: true, empresa: true,
                  telefone: true, cidade: true, temperatura: true,
                  status: true, optOut: true,
                },
              },
            },
          })
        ),
      ]);

      // As contagens saem do mesmo criterio da tela — `posicaoNoQuadro`
      // aplicado a cada combinacao (status, etapa) que o banco devolveu.
      const totalPorChave = new Map<string, number>();
      for (const c of contagens) {
        const chave = chaveDaColuna(
          posicaoNoQuadro({ status: c.status, etapaAtualId: c.etapaAtualId })
        );
        totalPorChave.set(chave, (totalPorChave.get(chave) ?? 0) + c._count);
      }

      const totalGeral = contagens.reduce((s, c) => s + c._count, 0);

      return {
        campanha: {
          id: campanha.id,
          nome: campanha.nome,
          status: campanha.status,
          dryRun: campanha.dryRun,
        },
        totalLeads: totalGeral,
        colunas: colunas.map((c, i) => ({
          ...c,
          total: totalPorChave.get(c.chave) ?? 0,
          leads: amostras[i],
        })),
      };
    }
  );

  // ------------------------------------------------------- qualificacao
  app.post(
    '/api/campaigns/requalificar',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const filtros = filtrosSchema.parse(request.body ?? {}) as FiltrosCampanha;
      const r = await requalificarLeads(filtros);
      request.log.info(r, 'Leads requalificados');
      eventsBus.publicar('dashboard.atualizar');
      return r;
    }
  );

  // ---------------------------------------- quantos leads o filtro pega
  app.post(
    '/api/campaigns/contar-leads',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const filtros = filtrosSchema.parse(request.body ?? {}) as FiltrosCampanha;
      // O funil junto do total: um "0 leads" sem dizer onde eles se
      // perderam faz ajustar o publico virar tentativa e erro.
      const explicacao = await explicarContagem(filtros);
      return { total: explicacao.total, funil: explicacao };
    }
  );
}
