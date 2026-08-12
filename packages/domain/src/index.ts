/**
 * @prospector/domain — regras de negocio puras.
 *
 * REGRA ARQUITETURAL: este package nao faz I/O. Nao importa Prisma, nao
 * importa Fastify, nao importa whatsapp-web.js, nao le arquivo, nao acessa
 * rede. Recebe dados, devolve dados. E isso que permite testar todo o
 * comportamento de campanha no Vitest sem banco e sem telefone conectado.
 *
 * ESTADO NA FASE 1: apenas contratos (tipos e assinaturas) e o utilitario
 * de delay. As implementacoes entram nas fases indicadas em cada arquivo.
 */

export * from './delay.js';
export * from './normalization/contracts.js';
export * from './rules/contracts.js';
export * from './campaign/contracts.js';
export * from './template/contracts.js';
