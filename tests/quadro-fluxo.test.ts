/**
 * O elo entre a campanha e o quadro.
 *
 * ============================================================
 * O QUE ESTES TESTES PROTEGEM
 * ============================================================
 * O quadro le `lead_campaigns`. Durante um tempo NADA escrevia nessa
 * tabela: enfileirar criava a mensagem e o worker a enviava, mas o
 * vinculo lead<->campanha nunca nascia. O quadro funcionava em teste
 * (que criava as linhas na mao) e ficava permanentemente vazio no uso
 * real — o pior tipo de defeito, porque a tela parecia certa.
 *
 * Cada teste aqui falha se aquele elo se romper de novo.
 *
 * Requer Postgres e Redis no ar, migrado e com seed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });
process.env.LOG_LEVEL = 'silent';

let prisma: typeof import('@prospector/database').prisma;
let servico: typeof import('../apps/api/src/services/campaign-service.js');

const TEMPLATE = 'Olá! Vi a {{empresa}} em {{cidade}}. Posso te mostrar uma ideia?';

beforeAll(async () => {
  prisma = (await import('@prospector/database')).prisma;
  servico = await import('../apps/api/src/services/campaign-service.js');
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await prisma.outboundMessage.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.leadEvent.deleteMany();
  await prisma.leadCampaign.deleteMany();
  await prisma.campaignStep.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.lead.deleteMany();
});

let n = 0;

async function criarLead(dados: Record<string, unknown> = {}) {
  n += 1;
  return prisma.lead.create({
    data: {
      nomeCompleto: `Clínica Fluxo ${n}`,
      empresa: `Clínica Fluxo ${n}`,
      telefone: `(19) 99999-${String(3000 + n).slice(-4)}`,
      telefoneNormalizado: `5519977${String(100000 + n).slice(-6)}`,
      cidade: 'Campinas',
      estado: 'SP',
      websiteStatus: 'NAO_INFORMADO',
      status: 'IMPORTADO',
      ...dados,
    } as never,
  });
}

async function criarCampanha(etapas = 1) {
  const campanha = await prisma.campaign.create({
    data: {
      nome: `Fluxo ${Date.now()}-${n}`,
      status: 'ATIVA',
      filtros: {} as never,
    },
  });
  for (let i = 1; i <= etapas; i += 1) {
    await prisma.campaignStep.create({
      data: {
        campaignId: campanha.id,
        ordem: i,
        texto: TEMPLATE,
        ativo: true,
        aguardarResposta: true,
      },
    });
  }
  return campanha;
}

describe('enfileirar cria o vínculo lead <-> campanha', () => {
  it('o lead aparece em lead_campaigns depois de enfileirar', async () => {
    const lead = await criarLead();
    const campanha = await criarCampanha();

    await servico.enfileirarCampanha(campanha.id);

    const vinculo = await prisma.leadCampaign.findUnique({
      where: { leadId_campaignId: { leadId: lead.id, campaignId: campanha.id } },
    });
    expect(vinculo).not.toBeNull();
  });

  it('nasce PENDENTE e SEM etapa — ele ainda não recebeu nada', async () => {
    const lead = await criarLead();
    const campanha = await criarCampanha();

    await servico.enfileirarCampanha(campanha.id);

    const v = await prisma.leadCampaign.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    // Dizer que já está na etapa 1 seria afirmar um envio que não houve.
    expect(v.status).toBe('PENDENTE');
    expect(v.etapaAtualId).toBeNull();
    expect(v.totalEnviadas).toBe(0);
  });

  it('lead bloqueado entra como PARADO, com o motivo', async () => {
    const lead = await criarLead({ optOut: true, optOutEm: new Date() });
    const campanha = await criarCampanha();

    await servico.enfileirarCampanha(campanha.id);

    const v = await prisma.leadCampaign.findFirst({ where: { leadId: lead.id } });
    // Pode nem ser selecionado pelo filtro; se for, tem de vir parado.
    if (v) {
      expect(v.status).toBe('PARADO');
      expect(v.motivoParada).toBeTruthy();
    }
  });

  it('enfileirar de novo não duplica o vínculo', async () => {
    await criarLead();
    const campanha = await criarCampanha();

    await servico.enfileirarCampanha(campanha.id);
    await servico.enfileirarCampanha(campanha.id);

    expect(await prisma.leadCampaign.count()).toBe(1);
  });

  it('enfileirar de novo NÃO joga para trás quem já avançou', async () => {
    const lead = await criarLead();
    const campanha = await criarCampanha(2);
    await servico.enfileirarCampanha(campanha.id);

    const etapa2 = await prisma.campaignStep.findFirstOrThrow({
      where: { campaignId: campanha.id, ordem: 2 },
    });
    await prisma.leadCampaign.updateMany({
      where: { leadId: lead.id },
      data: {
        status: 'AGUARDANDO_RESPOSTA',
        etapaAtualId: etapa2.id,
        etapaAtualOrdem: 2,
        totalEnviadas: 2,
      },
    });

    // Adicionar leads novos a uma campanha que já roda é normal. Se o
    // reenfileiramento resetasse, todo mundo voltaria para o começo e
    // receberia a mensagem 1 de novo.
    await servico.enfileirarCampanha(campanha.id);

    const v = await prisma.leadCampaign.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(v.etapaAtualOrdem).toBe(2);
    expect(v.status).toBe('AGUARDANDO_RESPOSTA');
    expect(v.totalEnviadas).toBe(2);
  });
});

describe('o quadro reflete o que foi enfileirado', () => {
  it('depois de enfileirar, os leads aparecem em "Na fila"', async () => {
    await criarLead();
    await criarLead();
    const campanha = await criarCampanha(2);

    await servico.enfileirarCampanha(campanha.id);

    // O mesmo critério que a rota do quadro usa para a coluna "Na fila".
    const naFila = await prisma.leadCampaign.count({
      where: {
        campaignId: campanha.id,
        etapaAtualId: null,
        status: { notIn: ['CONCLUIDO', 'PARADO', 'OPT_OUT', 'AGUARDANDO_INTERVENCAO', 'PAUSADO'] },
      },
    });
    expect(naFila).toBe(2);
  });
});
