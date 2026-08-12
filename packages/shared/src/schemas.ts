/**
 * Schemas Zod compartilhados.
 *
 * A API valida TODA entrada com estes schemas. O frontend usa os mesmos
 * para validar formularios antes de enviar — mas a validacao do frontend
 * e conveniencia, nunca garantia: o backend nunca confia no cliente.
 */
import { z } from 'zod';
import {
  LEAD_STATUS,
  TEMPERATURA,
  WEBSITE_STATUS,
  RESPOSTA_CATEGORIA,
  MATCH_TIPO,
  STEP_ACTION,
  SNOOZE_UNIDADE,
  CAMPAIGN_STATUS,
  TASK_STATUS,
  TASK_PRIORITY,
} from './enums.js';

// -----------------------------------------------------------------------------
// Autenticacao
// -----------------------------------------------------------------------------
export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Informe o e-mail').max(200),
  senha: z.string().min(1, 'Informe a senha').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

// -----------------------------------------------------------------------------
// Paginacao e filtros
// -----------------------------------------------------------------------------
export const paginacaoSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(50),
});

export const leadFiltrosSchema = paginacaoSchema.extend({
  busca: z.string().trim().max(200).optional(),
  status: z.enum(LEAD_STATUS).optional(),
  temperatura: z.enum(TEMPERATURA).optional(),
  websiteStatus: z.enum(WEBSITE_STATUS).optional(),
  /** Atalho: true = apenas leads SEM site proprio. */
  semSite: z.coerce.boolean().optional(),
  cidade: z.string().trim().max(120).optional(),
  bairro: z.string().trim().max(120).optional(),
  categoria: z.string().trim().max(120).optional(),
  campaignId: z.string().uuid().optional(),
  optOut: z.coerce.boolean().optional(),
  ordenarPor: z
    .enum(['temperatura', 'ultimaInteracaoEm', 'createdAt', 'nomeCompleto'])
    .default('temperatura'),
  ordem: z.enum(['asc', 'desc']).default('desc'),
});
export type LeadFiltros = z.infer<typeof leadFiltrosSchema>;

// -----------------------------------------------------------------------------
// Lead
// -----------------------------------------------------------------------------
export const leadCreateSchema = z.object({
  nomeCompleto: z.string().trim().min(1).max(200),
  empresa: z.string().trim().max(200).nullable().optional(),
  nomeContato: z.string().trim().max(200).nullable().optional(),
  categoria: z.string().trim().max(120).nullable().optional(),
  telefone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional().or(z.literal('')),
  logradouro: z.string().trim().max(200).nullable().optional(),
  numero: z.string().trim().max(30).nullable().optional(),
  bairro: z.string().trim().max(120).nullable().optional(),
  cidade: z.string().trim().max(120).nullable().optional(),
  estado: z.string().trim().max(2).nullable().optional(),
  cep: z.string().trim().max(12).nullable().optional(),
  websiteUrl: z.string().trim().max(500).nullable().optional(),
  instagramUrl: z.string().trim().max(500).nullable().optional(),
  facebookUrl: z.string().trim().max(500).nullable().optional(),
  observacoes: z.string().trim().max(5000).nullable().optional(),
});
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;

export const leadUpdateSchema = leadCreateSchema.partial().extend({
  status: z.enum(LEAD_STATUS).optional(),
  temperatura: z.enum(TEMPERATURA).optional(),
});

// -----------------------------------------------------------------------------
// Campanha
// -----------------------------------------------------------------------------
export const campaignCreateSchema = z
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
  })
  .refine((d) => d.delayMaxSegundos >= d.delayMinSegundos, {
    message: 'O delay maximo precisa ser maior ou igual ao minimo',
    path: ['delayMaxSegundos'],
  })
  .refine((d) => d.delayEntreLeadsMaxSegundos >= d.delayEntreLeadsMinSegundos, {
    message: 'O delay maximo entre leads precisa ser maior ou igual ao minimo',
    path: ['delayEntreLeadsMaxSegundos'],
  });
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

export const campaignStepSchema = z.object({
  ordem: z.number().int().min(1),
  nome: z.string().trim().max(120).nullable().optional(),
  texto: z.string().trim().min(1, 'A mensagem nao pode ficar vazia').max(4000),
  enviarAutomaticamente: z.boolean().default(true),
  aguardarResposta: z.boolean().default(true),
  delayMinSegundos: z.number().int().min(0).max(86400).nullable().optional(),
  delayMaxSegundos: z.number().int().min(0).max(86400).nullable().optional(),
  acaoPadraoDesconhecido: z.enum(STEP_ACTION).default('AGUARDAR_INTERVENCAO'),
});

export const campaignStepRuleSchema = z.object({
  categoria: z.enum(RESPOSTA_CATEGORIA),
  acao: z.enum(STEP_ACTION).default('NENHUMA'),
  proximaEtapaId: z.string().uuid().nullable().optional(),
  novaTemperatura: z.enum(TEMPERATURA).nullable().optional(),
  novoStatus: z.enum(LEAD_STATUS).nullable().optional(),
  criarTarefa: z.boolean().default(false),
  tarefaTitulo: z.string().trim().max(200).nullable().optional(),
  tarefaDescricao: z.string().trim().max(2000).nullable().optional(),
  tarefaPrioridade: z.enum(TASK_PRIORITY).nullable().optional(),
  notificar: z.boolean().default(false),
  notificacaoTitulo: z.string().trim().max(200).nullable().optional(),
  notificacaoMensagem: z.string().trim().max(1000).nullable().optional(),
  registrarOptOut: z.boolean().default(false),
  snoozeUnidade: z.enum(SNOOZE_UNIDADE).nullable().optional(),
  snoozeValor: z.number().int().min(1).max(365).nullable().optional(),
  ativo: z.boolean().default(true),
});

export const campaignStatusSchema = z.enum(CAMPAIGN_STATUS);

// -----------------------------------------------------------------------------
// Configuracoes
// -----------------------------------------------------------------------------
export const socialDomainSchema = z.object({
  /** Sem protocolo e sem "www.". Ex: "instagram.com" */
  dominio: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(200)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Informe apenas o dominio, ex: instagram.com'),
  rotulo: z.string().trim().max(120).nullable().optional(),
  ativo: z.boolean().default(true),
});

export const responseKeywordSchema = z.object({
  categoria: z.enum(RESPOSTA_CATEGORIA),
  termo: z.string().trim().min(1).max(200),
  matchTipo: z.enum(MATCH_TIPO).default('CONTEM'),
  peso: z.number().int().min(0).max(100).default(0),
  ativo: z.boolean().default(true),
  campaignStepId: z.string().uuid().nullable().optional(),
});

export const settingUpdateSchema = z.object({
  valor: z.unknown(),
});

// -----------------------------------------------------------------------------
// Tarefas
// -----------------------------------------------------------------------------
export const taskUpdateSchema = z.object({
  status: z.enum(TASK_STATUS).optional(),
  prioridade: z.enum(TASK_PRIORITY).optional(),
  titulo: z.string().trim().min(1).max(200).optional(),
  descricao: z.string().trim().max(2000).nullable().optional(),
  prazo: z.coerce.date().nullable().optional(),
});
