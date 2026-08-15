/**
 * Toda etapa nasce sabendo o que fazer com uma resposta.
 *
 * ============================================================
 * O DEFEITO QUE ESTES TESTES TRANCAM
 * ============================================================
 * `decidirAcao` não improvisa: categoria sem regra configurada vira
 * intervenção manual, com o motivo `SEM_REGRA_CONFIGURADA`. Isso está
 * certo — o sistema não deve inventar o que fazer com "quanto custa?".
 *
 * Só que `campaign_step_rules` não tinha NENHUM caminho para ser
 * preenchida: não há tela, não há rota, e o seed não cria nenhuma. Toda
 * etapa nascia sem regra alguma, e por isso TODA resposta de TODO lead
 * caía em intervenção manual — inclusive um "sim, quero" perfeito.
 *
 * O motor estava certo e o sistema, inútil: a automação nunca podia
 * automatizar nada.
 *
 * Requer Postgres e Redis no ar, migrado e com seed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { regrasPadraoDaEtapa, acaoDoMotor } from '../packages/domain/src/campaign/regras-padrao.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });
process.env.LOG_LEVEL = 'silent';

let prisma: typeof import('@prospector/database').prisma;
let app: import('fastify').FastifyInstance;
let cookie: string;

beforeAll(async () => {
  prisma = (await import('@prospector/database')).prisma;
  const { criarApp } = await import('../apps/api/src/app.js');
  ({ app } = await criarApp());
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: {
      email: process.env.SEED_USER_EMAIL ?? 'admin@local',
      senha: process.env.SEED_USER_PASSWORD ?? 'prospector123',
    },
  });
  if (login.statusCode !== 200) {
    throw new Error('Login falhou. Rode: pnpm db:migrate && pnpm db:seed');
  }
  cookie = login.headers['set-cookie']!.toString().split(';')[0]!;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await prisma.outboundMessage.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.leadEvent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.task.deleteMany();
  await prisma.leadCampaign.deleteMany();
  await prisma.campaignStepRule.deleteMany();
  await prisma.campaignStep.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.lead.deleteMany();
});

async function criarCampanha() {
  return prisma.campaign.create({
    data: { nome: `Regras ${Date.now()}`, status: 'ATIVA', filtros: {} as never },
  });
}

async function salvarEtapas(
  campaignId: string,
  etapas: Array<Record<string, unknown>>
) {
  return app.inject({
    method: 'PUT',
    url: `/api/campaigns/${campaignId}/steps`,
    headers: { cookie },
    payload: { etapas },
  });
}

const ETAPA = (ordem: number, texto = 'Olá! Vi a {{empresa}}.') => ({
  ordem,
  texto,
  ativo: true,
  enviarAutomaticamente: true,
  aguardarResposta: true,
  notificarAoChegar: false,
});

// ---------------------------------------------------------------------------

describe('regrasPadraoDaEtapa — o conjunto em si (função pura)', () => {
  const regras = regrasPadraoDaEtapa();

  it('POSITIVO é a ÚNICA categoria que avança sozinha', () => {
    const avancam = regras.filter((r) => r.acao === 'AVANCAR');
    expect(avancam).toHaveLength(1);
    expect(avancam[0]!.categoria).toBe('POSITIVO');
  });

  it('INTERESSE não avança — é sinal fraco', () => {
    const r = regras.find((x) => x.categoria === 'INTERESSE');
    expect(r?.acao).not.toBe('AVANCAR');
  });

  it('NEGATIVO e OPT_OUT param a sequência', () => {
    for (const cat of ['NEGATIVO', 'OPT_OUT']) {
      expect(regras.find((r) => r.categoria === cat)?.acao).toBe('PARAR');
    }
  });

  it('PREÇO e DÚVIDA chamam você — são as conversas que valem dinheiro', () => {
    for (const cat of ['PRECO', 'DUVIDA']) {
      const r = regras.find((x) => x.categoria === cat);
      expect(r?.acao).toBe('AGUARDAR_INTERVENCAO');
      expect(r?.notificar).toBe(true);
    }
  });

  it('nenhuma regra manda RESPONDER com template automático', () => {
    // Responder sozinho exigiria um template configurado. Sem tela para
    // configurar, o padrão não pode assumir que ele existe.
    expect(regras.every((r) => r.acao !== ('RESPONDER' as never))).toBe(true);
  });

  it('toda regra explica a escolha', () => {
    expect(regras.every((r) => r.porque.trim().length > 20)).toBe(true);
  });
});

describe('acaoDoMotor — os dois vocabulários', () => {
  it('traduz o que coincide', () => {
    expect(acaoDoMotor('AVANCAR')).toBe('AVANCAR');
    expect(acaoDoMotor('PARAR')).toBe('PARAR');
    expect(acaoDoMotor('SNOOZE')).toBe('SNOOZE');
  });

  it('AGUARDAR_INTERVENCAO vira INTERVENCAO de propósito, não por sobra', () => {
    // Antes isso funcionava por acidente: a string não casava com nenhum
    // `case` e caía no `default`. O comportamento certo saía de um
    // caminho que ninguém escolheu.
    expect(acaoDoMotor('AGUARDAR_INTERVENCAO')).toBe('INTERVENCAO');
  });

  it('IR_PARA_ETAPA chama você — o salto para etapa específica não existe ainda', () => {
    // Tratar como AVANCAR mandaria a mensagem da próxima etapa quando a
    // configuração pede a etapa 5. Mensagem errada é pior que parada.
    expect(acaoDoMotor('IR_PARA_ETAPA')).toBe('INTERVENCAO');
  });

  it('acão desconhecida nunca vira envio', () => {
    expect(acaoDoMotor('QUALQUER_COISA_NOVA')).toBe('INTERVENCAO');
  });
});

describe('a rota de etapas semeia as regras', () => {
  it('etapa nova nasce com o conjunto padrão', async () => {
    const campanha = await criarCampanha();
    const r = await salvarEtapas(campanha.id, [ETAPA(1)]);
    expect(r.statusCode).toBe(200);

    const etapa = await prisma.campaignStep.findFirstOrThrow({
      where: { campaignId: campanha.id },
    });
    const regras = await prisma.campaignStepRule.findMany({
      where: { campaignStepId: etapa.id },
    });

    expect(regras).toHaveLength(regrasPadraoDaEtapa().length);
    expect(regras.find((x) => x.categoria === 'POSITIVO')?.acao).toBe('AVANCAR');
  });

  it('cada etapa ganha o seu próprio conjunto', async () => {
    const campanha = await criarCampanha();
    await salvarEtapas(campanha.id, [ETAPA(1), ETAPA(2), ETAPA(3)]);

    const etapas = await prisma.campaignStep.findMany({
      where: { campaignId: campanha.id },
    });
    for (const e of etapas) {
      const n = await prisma.campaignStepRule.count({ where: { campaignStepId: e.id } });
      expect(n).toBe(regrasPadraoDaEtapa().length);
    }
  });

  it('salvar de novo NÃO desfaz o que você configurou', async () => {
    const campanha = await criarCampanha();
    await salvarEtapas(campanha.id, [ETAPA(1)]);

    const etapa = await prisma.campaignStep.findFirstOrThrow({
      where: { campaignId: campanha.id },
    });

    // Você decide que PREÇO deve parar a sequência.
    await prisma.campaignStepRule.updateMany({
      where: { campaignStepId: etapa.id, categoria: 'PRECO' },
      data: { acao: 'PARAR' },
    });

    // E depois corrige um typo no texto da mensagem.
    await salvarEtapas(campanha.id, [ETAPA(1, 'Olá! Vi a {{empresa}} hoje.')]);

    const preco = await prisma.campaignStepRule.findFirstOrThrow({
      where: { campaignStepId: etapa.id, categoria: 'PRECO' },
    });
    // Se o padrão voltasse por cima, sua configuração sumiria em
    // silêncio — e você só descobriria na próxima resposta.
    expect(preco.acao).toBe('PARAR');
  });

  it('campanha antiga, criada sem regras, ganha as regras ao salvar', async () => {
    const campanha = await criarCampanha();
    // Etapa criada direto no banco, como as de antes desta correção.
    const etapa = await prisma.campaignStep.create({
      data: { campaignId: campanha.id, ordem: 1, texto: 'Olá! Vi a {{empresa}}.' },
    });
    expect(
      await prisma.campaignStepRule.count({ where: { campaignStepId: etapa.id } })
    ).toBe(0);

    await salvarEtapas(campanha.id, [ETAPA(1)]);

    expect(
      await prisma.campaignStepRule.count({ where: { campaignStepId: etapa.id } })
    ).toBe(regrasPadraoDaEtapa().length);
  });
});

describe('ponta a ponta: com as regras padrão, um "sim" avança', () => {
  it('a resposta positiva agenda a etapa 2 sem nenhuma configuração manual', async () => {
    const campanha = await criarCampanha();
    await salvarEtapas(campanha.id, [ETAPA(1), ETAPA(2, 'Ótimo! Sobre a {{empresa}}...')]);

    const etapas = await prisma.campaignStep.findMany({
      where: { campaignId: campanha.id },
      orderBy: { ordem: 'asc' },
    });

    const lead = await prisma.lead.create({
      data: {
        nomeCompleto: 'Studio Padrão',
        empresa: 'Studio Padrão',
        telefone: '(19) 97777-1234',
        telefoneNormalizado: '5519977771234',
        cidade: 'Campinas',
        websiteStatus: 'NAO_INFORMADO',
        status: 'AGUARDANDO_RESPOSTA',
      } as never,
    });
    await prisma.leadCampaign.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        status: 'AGUARDANDO_RESPOSTA',
        etapaAtualId: etapas[0]!.id,
        etapaAtualOrdem: 1,
      },
    });

    const { processarMensagemRecebida } = await import(
      '../apps/worker/src/services/inbound.js'
    );
    const r = await processarMensagemRecebida({
      providerMessageId: `pm-padrao-${Date.now()}`,
      chatId: '5519977771234@c.us',
      telefone: '5519977771234',
      texto: 'quero sim, tenho interesse',
      nomeContato: 'Contato',
      recebidaEm: new Date(),
      deMim: false,
      tipo: 'chat',
      temMidia: false,
    });

    // Antes: INTERVENCAO, porque não havia regra para POSITIVO.
    expect(r.acao).toBe('AVANCAR');

    const proxima = await prisma.outboundMessage.findFirst({
      where: { leadId: lead.id, campaignStepId: etapas[1]!.id },
    });
    expect(proxima).not.toBeNull();
  });
});
