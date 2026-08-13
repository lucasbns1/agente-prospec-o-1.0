/**
 * @prospector/domain — regras de negocio puras.
 *
 * REGRA ARQUITETURAL: este package nao faz I/O de rede nem de banco. Nao
 * importa Prisma, nao importa Fastify, nao importa whatsapp-web.js.
 * Recebe dados, devolve dados. E isso que permite testar todo o
 * comportamento de importacao e campanha no Vitest sem banco.
 *
 * IMPLEMENTADO (Fase 2): normalizacao, classificacao de website, dedupe.
 * CONTRATOS (Fases 4-7): motor de regras, templates, avanco de campanha.
 */

export * from './delay.js';

// --- Normalizacao (Fase 2) ---
export * from './normalization/texto.js';
export * from './normalization/telefone.js';
export * from './normalization/website.js';
export * from './normalization/dedupe.js';
export * from './normalization/lead.js';

// --- Contratos das proximas fases ---
// --- Motor de regras (Fase 3) ---
export * from './rules/normalizar-resposta.js';
export * from './rules/motor.js';
export * from './rules/decisao.js';
export * from './rules/dicionario-padrao.js';
// --- Campanhas (Fase 4) ---
export * from './campaign/qualificacao.js';
export * from './campaign/template.js';
export * from './campaign/agendamento.js';
export * from './campaign/contracts.js';
export * from './campaign/quadro.js';
export * from './template/contracts.js';
// --- Dashboard (Fase 5) ---
export * from './dashboard/atencao.js';
// --- Recebimento (Fase 6A) ---
export * from './inbound/identificar-lead.js';
export * from './inbound/confirmacao-entrega.js';
