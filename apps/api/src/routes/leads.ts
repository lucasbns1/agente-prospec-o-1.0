/**
 * Rotas do CRM de leads.
 *
 * Filtros e paginacao sao SERVER-SIDE. O frontend nunca recebe a lista
 * inteira — com alguns milhares de leads isso travaria o navegador e
 * transformaria cada filtro em trabalho de CPU no cliente.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, Prisma } from '@prospector/database';
import { LEAD_STATUS, TEMPERATURA, WEBSITE_STATUS } from '@prospector/shared';
import { exigirAutenticacao } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';

/** Visoes rapidas da tela de leads. */
export const VISOES = [
  'TODOS',
  'SEM_SITE',
  'COM_SITE',
  'SEM_TELEFONE',
  'AGUARDANDO_RESPOSTA',
  'INTERESSADOS',
  'QUENTES',
  'MORNOS',
  'FRIOS',
  'NEGATIVOS',
  'OPT_OUT',
  'INTERVENCAO',
  'CLIENTES',
] as const;

const filtrosSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(50),
  visao: z.enum(VISOES).default('TODOS'),
  busca: z.string().trim().max(200).optional(),
  status: z.enum(LEAD_STATUS).optional(),
  temperatura: z.enum(TEMPERATURA).optional(),
  websiteStatus: z.enum(WEBSITE_STATUS).optional(),
  cidade: z.string().trim().max(120).optional(),
  bairro: z.string().trim().max(120).optional(),
  categoria: z.string().trim().max(120).optional(),
  ordenarPor: z
    .enum(['temperatura', 'ultimaInteracaoEm', 'createdAt', 'nomeCompleto', 'avaliacao'])
    .default('createdAt'),
  ordem: z.enum(['asc', 'desc']).default('desc'),
});

/** Tudo que NAO for SITE_PROPRIO conta como sem site (inclui rede social). */
const SEM_SITE: Prisma.LeadWhereInput = {
  websiteStatus: { in: ['NAO_INFORMADO', 'REDE_SOCIAL', 'INVALIDO'] },
};

function whereDaVisao(visao: (typeof VISOES)[number]): Prisma.LeadWhereInput {
  switch (visao) {
    case 'SEM_SITE':
      return SEM_SITE;
    case 'COM_SITE':
      return { websiteStatus: 'SITE_PROPRIO' };
    case 'SEM_TELEFONE':
      return { telefoneNormalizado: null };
    case 'AGUARDANDO_RESPOSTA':
      return { status: 'AGUARDANDO_RESPOSTA' };
    case 'INTERESSADOS':
      return { ultimaCategoria: { in: ['POSITIVO', 'INTERESSE', 'PRECO'] } };
    case 'QUENTES':
      return { temperatura: 'QUENTE' };
    case 'MORNOS':
      return { temperatura: 'MORNO' };
    case 'FRIOS':
      return { temperatura: 'FRIO' };
    case 'NEGATIVOS':
      return { ultimaCategoria: 'NEGATIVO' };
    case 'OPT_OUT':
      return { optOut: true };
    case 'INTERVENCAO':
      return { status: 'AGUARDANDO_INTERVENCAO' };
    case 'CLIENTES':
      return { status: 'CLIENTE' };
    default:
      return {};
  }
}

export async function rotasLeads(app: FastifyInstance): Promise<void> {
  /** Lista paginada com filtros. */
  app.get('/api/leads', { preHandler: exigirAutenticacao }, async (request) => {
    const f = filtrosSchema.parse(request.query);

    const condicoes: Prisma.LeadWhereInput[] = [whereDaVisao(f.visao)];

    if (f.busca) {
      // Busca por nome, telefone (cru e normalizado), endereco, bairro e cidade.
      const soDigitos = f.busca.replace(/\D/g, '');
      const alternativas: Prisma.LeadWhereInput[] = [
        { nomeCompleto: { contains: f.busca, mode: 'insensitive' } },
        { empresa: { contains: f.busca, mode: 'insensitive' } },
        { enderecoOriginal: { contains: f.busca, mode: 'insensitive' } },
        { bairro: { contains: f.busca, mode: 'insensitive' } },
        { cidade: { contains: f.busca, mode: 'insensitive' } },
        { telefone: { contains: f.busca, mode: 'insensitive' } },
      ];
      if (soDigitos.length >= 4) {
        alternativas.push({ telefoneNormalizado: { contains: soDigitos } });
      }
      condicoes.push({ OR: alternativas });
    }

    if (f.status) condicoes.push({ status: f.status });
    if (f.temperatura) condicoes.push({ temperatura: f.temperatura });
    if (f.websiteStatus) condicoes.push({ websiteStatus: f.websiteStatus });
    if (f.cidade) condicoes.push({ cidade: { equals: f.cidade, mode: 'insensitive' } });
    if (f.bairro) condicoes.push({ bairro: { equals: f.bairro, mode: 'insensitive' } });
    if (f.categoria) {
      condicoes.push({ categoria: { contains: f.categoria, mode: 'insensitive' } });
    }

    const where: Prisma.LeadWhereInput = { AND: condicoes };

    // A ordenacao por temperatura precisa ser QUENTE > MORNO > FRIO. O
    // enum do Postgres ordena pela ordem de declaracao (FRIO primeiro),
    // entao invertemos a direcao para "mais quentes primeiro".
    const orderBy: Prisma.LeadOrderByWithRelationInput =
      f.ordenarPor === 'temperatura'
        ? { temperatura: f.ordem === 'desc' ? 'desc' : 'asc' }
        : { [f.ordenarPor]: f.ordem };

    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy: [orderBy, { id: 'asc' }],
        skip: (f.pagina - 1) * f.porPagina,
        take: f.porPagina,
        select: {
          id: true, nomeCompleto: true, empresa: true, categoria: true,
          telefone: true, telefoneNormalizado: true,
          cidade: true, bairro: true,
          websiteUrl: true, websiteStatus: true,
          status: true, temperatura: true, optOut: true,
          ultimaCategoria: true, ultimaInteracaoEm: true,
          proximaAcao: true, proximaAcaoEm: true,
          origem: true, avaliacao: true, totalAvaliacoes: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      leads,
      paginacao: {
        pagina: f.pagina,
        porPagina: f.porPagina,
        total,
        totalPaginas: Math.max(1, Math.ceil(total / f.porPagina)),
      },
    };
  });

  /** Contadores de cada visao — alimenta as abas da tela de leads. */
  app.get(
    '/api/leads/contadores',
    { preHandler: exigirAutenticacao },
    async () => {
      const entradas = await Promise.all(
        VISOES.map(async (visao) => {
          const total = await prisma.lead.count({ where: whereDaVisao(visao) });
          return [visao, total] as const;
        })
      );
      return { contadores: Object.fromEntries(entradas) };
    }
  );

  /** Valores distintos para os selects de filtro. */
  app.get(
    '/api/leads/filtros',
    { preHandler: exigirAutenticacao },
    async () => {
      const [cidades, bairros, categorias] = await Promise.all([
        prisma.lead.findMany({
          where: { cidade: { not: null } },
          distinct: ['cidade'], select: { cidade: true },
          orderBy: { cidade: 'asc' }, take: 200,
        }),
        prisma.lead.findMany({
          where: { bairro: { not: null } },
          distinct: ['bairro'], select: { bairro: true },
          orderBy: { bairro: 'asc' }, take: 300,
        }),
        prisma.lead.findMany({
          where: { categoria: { not: null } },
          distinct: ['categoria'], select: { categoria: true },
          orderBy: { categoria: 'asc' }, take: 200,
        }),
      ]);

      return {
        cidades: cidades.map((c) => c.cidade!).filter(Boolean),
        bairros: bairros.map((b) => b.bairro!).filter(Boolean),
        categorias: categorias.map((c) => c.categoria!).filter(Boolean),
      };
    }
  );

  /** Detalhe do lead, com historico de eventos. */
  app.get<{ Params: { id: string } }>(
    '/api/leads/:id',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

      const lead = await prisma.lead.findUnique({
        where: { id },
        include: {
          events: { orderBy: { createdAt: 'desc' }, take: 100 },
          websiteChecks: { orderBy: { createdAt: 'desc' }, take: 10 },
          tasks: {
            where: { status: { in: ['ABERTA', 'EM_ANDAMENTO'] } },
            orderBy: { createdAt: 'desc' },
          },
          campaign: { select: { id: true, nome: true } },
          leadCampaigns: {
            include: {
              campaign: { select: { id: true, nome: true } },
              etapaAtual: { select: { id: true, ordem: true, nome: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
          import: { select: { id: true, nomeArquivo: true, createdAt: true } },
        },
      });

      if (!lead) throw new AppError('Lead não encontrado', 404, 'NAO_ENCONTRADO');
      return { lead };
    }
  );
}
