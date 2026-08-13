/**
 * Agregacoes do dashboard.
 *
 * Este arquivo so BUSCA e MONTA. A decisao de ordem e de deduplicacao
 * mora em `@prospector/domain` (`priorizarAtencao`), que e testavel sem
 * banco.
 *
 * As seis consultas de candidatos rodam em paralelo e cada uma tem seu
 * proprio teto. Sem teto, um banco com 5 mil leads frios geraria 5 mil
 * candidatos para a funcao descartar depois — trabalho jogado fora no
 * banco, que e onde ele custa mais caro.
 */
import { prisma } from '@prospector/database';
import {
  priorizarAtencao,
  type CandidatoAtencao,
  type ItemAtencao,
} from '@prospector/domain';

/** Teto por motivo. A lista final é cortada de novo pelo domínio. */
const LIMITE_POR_MOTIVO = 25;

/** Status em que o lead saiu do jogo — não faz sentido cobrar ação. */
const STATUS_ENCERRADOS = ['OPT_OUT', 'ENCERRADO', 'CLIENTE'] as const;

const SELECAO = {
  id: true,
  nomeCompleto: true,
  empresa: true,
  categoria: true,
  bairro: true,
  cidade: true,
  temperatura: true,
  status: true,
  ultimaInteracaoEm: true,
  updatedAt: true,
} as const;

type LeadSelecionado = {
  id: string;
  nomeCompleto: string | null;
  empresa: string | null;
  categoria: string | null;
  bairro: string | null;
  cidade: string | null;
  temperatura: string;
  status: string;
  ultimaInteracaoEm: Date | null;
  updatedAt: Date;
};

function paraCandidato(
  lead: LeadSelecionado,
  motivo: CandidatoAtencao['motivo'],
  extras: { ultimaMensagem?: string | null; etapaAtual?: string | null; em?: Date } = {}
): CandidatoAtencao {
  return {
    leadId: lead.id,
    nome: lead.nomeCompleto ?? lead.empresa,
    categoria: lead.categoria,
    bairro: lead.bairro,
    cidade: lead.cidade,
    temperatura: lead.temperatura,
    status: lead.status,
    motivo,
    ultimaMensagem: extras.ultimaMensagem ?? null,
    etapaAtual: extras.etapaAtual ?? null,
    // `ultimaInteracaoEm` é o instante que importa: é quando o lead
    // passou a esperar. `updatedAt` é só o fallback.
    em: extras.em ?? lead.ultimaInteracaoEm ?? lead.updatedAt,
  };
}

export async function montarAtencao(limite = 20): Promise<ItemAtencao[]> {
  const agora = new Date();

  const [
    intervencao,
    quentes,
    pedidosPreco,
    tarefasAtrasadas,
    errosEnvio,
    tarefasPreview,
  ] = await Promise.all([
    // 1. O sistema não entendeu e parou. Ninguém está respondendo.
    prisma.lead.findMany({
      where: { status: 'AGUARDANDO_INTERVENCAO' },
      select: SELECAO,
      orderBy: { ultimaInteracaoEm: 'asc' },
      take: LIMITE_POR_MOTIVO,
    }),

    // 2. Lead quente que ainda não virou cliente.
    prisma.lead.findMany({
      where: {
        temperatura: 'QUENTE',
        optOut: false,
        status: { notIn: [...STATUS_ENCERRADOS] },
      },
      select: SELECAO,
      orderBy: { ultimaInteracaoEm: 'asc' },
      take: LIMITE_POR_MOTIVO,
    }),

    // 3. Perguntou preço. Sem resposta, esfria rápido.
    prisma.lead.findMany({
      where: {
        ultimaCategoria: 'PRECO',
        optOut: false,
        status: { notIn: [...STATUS_ENCERRADOS] },
      },
      select: SELECAO,
      orderBy: { ultimaInteracaoEm: 'asc' },
      take: LIMITE_POR_MOTIVO,
    }),

    prisma.task.findMany({
      where: {
        status: { in: ['ABERTA', 'EM_ANDAMENTO'] },
        prazo: { lt: agora },
        leadId: { not: null },
      },
      select: { prazo: true, titulo: true, lead: { select: SELECAO } },
      orderBy: { prazo: 'asc' },
      take: LIMITE_POR_MOTIVO,
    }),

    prisma.outboundMessage.findMany({
      where: { status: 'FALHOU' },
      select: { erro: true, processedAt: true, lead: { select: SELECAO } },
      orderBy: { processedAt: 'desc' },
      take: LIMITE_POR_MOTIVO,
    }),

    prisma.task.findMany({
      where: {
        tipo: 'CRIAR_PREVIEW',
        status: { in: ['ABERTA', 'EM_ANDAMENTO'] },
        leadId: { not: null },
      },
      select: { createdAt: true, titulo: true, lead: { select: SELECAO } },
      orderBy: { createdAt: 'asc' },
      take: LIMITE_POR_MOTIVO,
    }),
  ]);

  const candidatos: CandidatoAtencao[] = [
    ...intervencao.map((l) => paraCandidato(l, 'INTERVENCAO_NECESSARIA')),
    ...quentes.map((l) => paraCandidato(l, 'LEAD_QUENTE')),
    ...pedidosPreco.map((l) => paraCandidato(l, 'PEDIDO_PRECO')),
    ...tarefasAtrasadas
      .filter((t) => t.lead !== null)
      .map((t) =>
        paraCandidato(t.lead!, 'TAREFA_ATRASADA', {
          ultimaMensagem: t.titulo,
          em: t.prazo ?? undefined,
        })
      ),
    ...errosEnvio
      .filter((m) => m.lead !== null)
      .map((m) =>
        paraCandidato(m.lead, 'ERRO_ENVIO', {
          ultimaMensagem: m.erro,
          em: m.processedAt ?? undefined,
        })
      ),
    ...tarefasPreview
      .filter((t) => t.lead !== null)
      .map((t) =>
        paraCandidato(t.lead!, 'PEDIDO_PREVIEW', {
          ultimaMensagem: t.titulo,
          em: t.createdAt,
        })
      ),
  ];

  return priorizarAtencao(candidatos, { limite });
}

export interface ResumoCampanhaAtiva {
  id: string;
  nome: string;
  nicho: string | null;
  cidade: string | null;
  totalLeads: number;
  enviadasHoje: number;
  respostas: number;
  quentes: number;
  limiteDiario: number;
}

/**
 * Resumo da campanha ativa mais recente.
 *
 * Os quatro contadores eram fixos em zero desde a Fase 1 — o card
 * existia mas mentia. Agora vêm do banco.
 */
export async function resumoCampanhaAtiva(): Promise<ResumoCampanhaAtiva | null> {
  const campanha = await prisma.campaign.findFirst({
    where: { status: 'ATIVA' },
    orderBy: { iniciadaEm: 'desc' },
  });
  if (!campanha) return null;

  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);

  const [totalLeads, enviadasHoje, respostas, quentes] = await Promise.all([
    prisma.outboundMessage.count({ where: { campaignId: campanha.id } }),
    // Só envios REAIS de hoje. Simulações não consomem cota e não podem
    // dar a impressão de que a campanha está rodando de verdade.
    prisma.outboundMessage.count({
      where: {
        campaignId: campanha.id,
        status: 'ENVIADA',
        processedAt: { gte: inicioDoDia },
      },
    }),
    prisma.message.count({
      where: { campaignId: campanha.id, direcao: 'RECEBIDA' },
    }),
    prisma.lead.count({
      where: {
        temperatura: 'QUENTE',
        outbound: { some: { campaignId: campanha.id } },
      },
    }),
  ]);

  return {
    id: campanha.id,
    nome: campanha.nome,
    nicho: campanha.nicho,
    cidade: campanha.cidade,
    totalLeads,
    enviadasHoje,
    respostas,
    quentes,
    limiteDiario: campanha.limiteDiarioEnvios,
  };
}
