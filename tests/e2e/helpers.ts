/**
 * Apoio para os specs E2E.
 *
 * ============================================================
 * POR QUE CADA SPEC LIMPA O BANCO
 * ============================================================
 * Os specs compartilham o mesmo Postgres. Sem limpeza, os leads criados
 * por um spec entram nas contagens do outro — e asercoes do tipo
 * "4 leads nesta visão" passam a depender da ordem de execucao.
 *
 * A limpeza usa o Prisma direto, e nao uma rota da API: criar um
 * endpoint "apagar tudo" so para teste deixaria uma porta perigosa
 * aberta em producao.
 *
 * Apaga apenas dados de LEAD e CAMPANHA. Usuario, sessoes, templates,
 * dicionario e configuracoes ficam — o login e o motor de regras
 * dependem do seed.
 */
import path from 'node:path';
import { config } from 'dotenv';

// O Playwright carrega estes arquivos como CommonJS, entao usamos
// __dirname em vez de import.meta.url.
const raiz = path.resolve(__dirname, '..', '..');
config({ path: path.join(raiz, '.env') });

export async function limparLeadsECampanhas(): Promise<void> {
  // Import relativo, nao pelo nome do workspace: a raiz do monorepo nao
  // declara os packages como dependencia.
  const { prisma } = await import('../../packages/database/src/index.js');

  // A ordem respeita as chaves estrangeiras.
  await prisma.outboundMessage.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.leadEvent.deleteMany();
  await prisma.websiteCheck.deleteMany();
  await prisma.importRow.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.leadCampaign.deleteMany();
  await prisma.campaignStep.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.import.deleteMany();

  await prisma.$disconnect();
}
