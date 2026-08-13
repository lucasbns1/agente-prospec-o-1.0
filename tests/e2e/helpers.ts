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
  await prisma.unknownContact.deleteMany();
  await prisma.outboundMessage.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.leadEvent.deleteMany();
  await prisma.websiteCheck.deleteMany();
  await prisma.importRow.deleteMany();
  await prisma.notification.deleteMany();
  // Tarefas sem lead sobrevivem ao resto da limpeza e se acumulam entre
  // execucoes, quebrando asercoes de contagem na segunda rodada.
  await prisma.task.deleteMany();
  await prisma.leadCampaign.deleteMany();
  await prisma.campaignStep.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.import.deleteMany();

  await prisma.$disconnect();
}

/** Cria um lead direto no banco, para o spec nao depender de importacao. */
export async function criarLeadDeTeste(
  dados: Record<string, unknown>
): Promise<{ id: string }> {
  const { prisma } = await import('../../packages/database/src/index.js');
  const lead = await prisma.lead.create({
    data: {
      cidade: 'Campinas',
      websiteStatus: 'NAO_INFORMADO',
      status: 'AGUARDANDO_RESPOSTA',
      ...dados,
    } as never,
  });
  await prisma.$disconnect();
  return { id: lead.id };
}

/**
 * Injeta uma mensagem recebida na fila.
 *
 * O mesmo caminho do script `simular-recebida.ts`: nao ha celular
 * pareado num ambiente de teste, e o worker e quem processa.
 */
export async function simularRecebida(
  telefone: string,
  texto: string,
  providerMessageId: string
): Promise<void> {
  const { Queue } = await import('bullmq');
  const { QUEUES } = await import('../../packages/shared/src/index.js');

  const fila = new Queue(QUEUES.PROCESS_INCOMING_MESSAGE, {
    connection: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
    },
  });

  await fila.add(
    'processar',
    {
      mensagem: {
        providerMessageId,
        chatId: `${telefone}@c.us`,
        telefone,
        texto,
        nomeContato: null,
        recebidaEmISO: new Date().toISOString(),
        tipo: 'chat',
        temMidia: false,
      },
    },
    { jobId: `inbound-${providerMessageId}` }
  );

  await fila.close();
}
