/**
 * O quadro da campanha, ponta a ponta — contra Postgres real.
 *
 * O que so o banco pode provar aqui: que as CONTAGENS batem com os
 * CARTOES. As contagens vem de um `groupBy` e os cartoes de consultas
 * separadas, uma por coluna. Se os dois criterios divergirem, a tela
 * mostra "12" no topo de uma coluna que tem 3 cartoes — e o numero
 * errado e o que voce usa para decidir.
 *
 * Requer Postgres no ar, `pnpm db:migrate` e `pnpm db:seed`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });
process.env.LOG_LEVEL = 'silent';

let app: FastifyInstance;
let cookie: string;
let prisma: typeof import('@prospector/database').prisma;

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
  await prisma.leadCampaign.deleteMany();
  await prisma.campaignStep.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.lead.deleteMany();
});

// ----------------------------------------------------------------- helpers
let n = 0;

async function criarLead() {
  n += 1;
  return prisma.lead.create({
    data: {
      nomeCompleto: `Lead ${n}`,
      primeiroNome: 'Lead',
      empresa: `Empresa ${n}`,
      telefone: `(19) 99999-${String(1000 + n).slice(-4)}`,
      telefoneNormalizado: `5519988${String(100000 + n).slice(-6)}`,
      cidade: 'Campinas',
      estado: 'SP',
      websiteStatus: 'NAO_INFORMADO',
      status: 'IMPORTADO',
    },
  });
}

async function criarCampanhaComEtapas(quantas = 3) {
  const campanha = await prisma.campaign.create({
    data: { nome: `Campanha ${Date.now()}-${n}`, status: 'ATIVA' },
  });
  const etapas = [];
  for (let i = 1; i <= quantas; i += 1) {
    etapas.push(
      await prisma.campaignStep.create({
        data: {
          campaignId: campanha.id,
          ordem: i,
          nome: i === 1 ? 'Abertura' : null,
          texto: `Mensagem ${i}`,
          ativo: true,
        },
      })
    );
  }
  return { campanha, etapas };
}

async function colocar(
  campaignId: string,
  status: string,
  etapaAtualId: string | null
) {
  const lead = await criarLead();
  await prisma.leadCampaign.create({
    data: {
      leadId: lead.id,
      campaignId,
      status: status as never,
      etapaAtualId,
      etapaAtualOrdem: null,
    },
  });
  return lead;
}

async function pegarQuadro(campaignId: string) {
  const r = await app.inject({
    method: 'GET',
    url: `/api/campaigns/${campaignId}/quadro`,
    headers: { cookie },
  });
  expect(r.statusCode).toBe(200);
  return r.json();
}

// ------------------------------------------------------------------ testes
describe('GET /api/campaigns/:id/quadro', () => {
  it('exige autenticacao', async () => {
    const { campanha } = await criarCampanhaComEtapas(1);
    const r = await app.inject({
      method: 'GET',
      url: `/api/campaigns/${campanha.id}/quadro`,
    });
    expect(r.statusCode).toBe(401);
  });

  it('404 para campanha inexistente', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/campaigns/00000000-0000-4000-8000-000000000000/quadro',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(404);
  });

  it('devolve uma coluna por etapa, mais as tres fixas', async () => {
    const { campanha } = await criarCampanhaComEtapas(3);
    const q = await pegarQuadro(campanha.id);

    expect(q.colunas).toHaveLength(6);
    expect(q.colunas.map((c: { tipo: string }) => c.tipo)).toEqual([
      'NA_FILA', 'ETAPA', 'ETAPA', 'ETAPA', 'PRECISA_DE_VOCE', 'ENCERRADO',
    ]);
  });

  it('as colunas vazias continuam existindo', async () => {
    // Some quando zera = some justamente a etapa que nao esta passando
    // ninguem, que e o que voce quer enxergar.
    const { campanha } = await criarCampanhaComEtapas(2);
    const q = await pegarQuadro(campanha.id);
    expect(q.colunas).toHaveLength(5);
    expect(q.colunas.every((c: { total: number }) => c.total === 0)).toBe(true);
  });

  it('ignora etapas desativadas', async () => {
    const { campanha, etapas } = await criarCampanhaComEtapas(3);
    await prisma.campaignStep.update({
      where: { id: etapas[1]!.id },
      data: { ativo: false },
    });
    const q = await pegarQuadro(campanha.id);
    expect(q.colunas.filter((c: { tipo: string }) => c.tipo === 'ETAPA')).toHaveLength(2);
  });

  it('lead sem etapa aparece em "Na fila", nao na etapa 1', async () => {
    const { campanha, etapas } = await criarCampanhaComEtapas(2);
    await colocar(campanha.id, 'PENDENTE', null);

    const q = await pegarQuadro(campanha.id);
    const fila = q.colunas.find((c: { tipo: string }) => c.tipo === 'NA_FILA');
    const etapa1 = q.colunas.find(
      (c: { etapaId: string | null }) => c.etapaId === etapas[0]!.id
    );

    expect(fila.total).toBe(1);
    expect(fila.leads).toHaveLength(1);
    expect(etapa1.total).toBe(0);
  });

  it('lead em intervencao sai da coluna da etapa', async () => {
    const { campanha, etapas } = await criarCampanhaComEtapas(2);
    await colocar(campanha.id, 'AGUARDANDO_INTERVENCAO', etapas[1]!.id);

    const q = await pegarQuadro(campanha.id);
    const precisa = q.colunas.find(
      (c: { tipo: string }) => c.tipo === 'PRECISA_DE_VOCE'
    );
    const etapa2 = q.colunas.find(
      (c: { etapaId: string | null }) => c.etapaId === etapas[1]!.id
    );

    expect(precisa.total).toBe(1);
    expect(etapa2.total).toBe(0);
  });

  it('opt-out vai para encerrados mesmo com etapa preenchida', async () => {
    const { campanha, etapas } = await criarCampanhaComEtapas(2);
    await colocar(campanha.id, 'OPT_OUT', etapas[0]!.id);

    const q = await pegarQuadro(campanha.id);
    const enc = q.colunas.find((c: { tipo: string }) => c.tipo === 'ENCERRADO');
    expect(enc.total).toBe(1);
    expect(
      q.colunas.find((c: { etapaId: string | null }) => c.etapaId === etapas[0]!.id)
        .total
    ).toBe(0);
  });

  it('cada lead conta em exatamente uma coluna', async () => {
    const { campanha, etapas } = await criarCampanhaComEtapas(3);

    await colocar(campanha.id, 'PENDENTE', null);
    await colocar(campanha.id, 'EM_ANDAMENTO', etapas[0]!.id);
    await colocar(campanha.id, 'AGUARDANDO_RESPOSTA', etapas[1]!.id);
    await colocar(campanha.id, 'AGENDADO', etapas[2]!.id);
    await colocar(campanha.id, 'AGUARDANDO_INTERVENCAO', etapas[1]!.id);
    await colocar(campanha.id, 'PAUSADO', etapas[0]!.id);
    await colocar(campanha.id, 'CONCLUIDO', etapas[2]!.id);
    await colocar(campanha.id, 'OPT_OUT', null);

    const q = await pegarQuadro(campanha.id);
    const soma = q.colunas.reduce(
      (s: number, c: { total: number }) => s + c.total,
      0
    );

    // A prova de que nenhum lead foi contado duas vezes nem sumiu.
    expect(soma).toBe(8);
    expect(q.totalLeads).toBe(8);
  });

  it('a contagem bate com os cartoes quando cabe tudo', async () => {
    const { campanha, etapas } = await criarCampanhaComEtapas(2);
    await colocar(campanha.id, 'EM_ANDAMENTO', etapas[0]!.id);
    await colocar(campanha.id, 'EM_ANDAMENTO', etapas[0]!.id);
    await colocar(campanha.id, 'AGUARDANDO_INTERVENCAO', etapas[0]!.id);

    const q = await pegarQuadro(campanha.id);
    for (const c of q.colunas) {
      expect(c.leads.length).toBe(c.total);
    }
  });

  it('o total continua exato quando os cartoes sao cortados', async () => {
    const { campanha, etapas } = await criarCampanhaComEtapas(1);
    for (let i = 0; i < 5; i += 1) {
      await colocar(campanha.id, 'EM_ANDAMENTO', etapas[0]!.id);
    }

    const r = await app.inject({
      method: 'GET',
      url: `/api/campaigns/${campanha.id}/quadro?porColuna=2`,
      headers: { cookie },
    });
    const q = r.json();
    const etapa1 = q.colunas.find(
      (c: { etapaId: string | null }) => c.etapaId === etapas[0]!.id
    );

    // O topo da coluna diz 5; a coluna mostra 2. O numero e a verdade.
    expect(etapa1.total).toBe(5);
    expect(etapa1.leads).toHaveLength(2);
  });

  it('o cartao traz o que a tela precisa mostrar', async () => {
    const { campanha, etapas } = await criarCampanhaComEtapas(1);
    await colocar(campanha.id, 'EM_ANDAMENTO', etapas[0]!.id);

    const q = await pegarQuadro(campanha.id);
    const cartao = q.colunas.find(
      (c: { etapaId: string | null }) => c.etapaId === etapas[0]!.id
    ).leads[0];

    expect(cartao.lead.nomeCompleto).toBeTruthy();
    expect(cartao.lead.empresa).toBeTruthy();
    expect(cartao.lead.telefone).toBeTruthy();
    expect(cartao.lead.id).toBeTruthy();
    expect(cartao.status).toBe('EM_ANDAMENTO');
  });

  it('nao mistura leads de outra campanha', async () => {
    const a = await criarCampanhaComEtapas(1);
    const b = await criarCampanhaComEtapas(1);
    await colocar(a.campanha.id, 'EM_ANDAMENTO', a.etapas[0]!.id);
    await colocar(b.campanha.id, 'EM_ANDAMENTO', b.etapas[0]!.id);

    const q = await pegarQuadro(a.campanha.id);
    expect(q.totalLeads).toBe(1);
  });

  it('usa o nome da etapa, e cai para "Mensagem N" quando nao ha', async () => {
    const { campanha } = await criarCampanhaComEtapas(2);
    const q = await pegarQuadro(campanha.id);
    const titulos = q.colunas
      .filter((c: { tipo: string }) => c.tipo === 'ETAPA')
      .map((c: { titulo: string }) => c.titulo);
    expect(titulos).toEqual(['Abertura', 'Mensagem 2']);
  });

  it('campanha sem etapa nenhuma nao quebra', async () => {
    const campanha = await prisma.campaign.create({
      data: { nome: `Vazia ${Date.now()}`, status: 'RASCUNHO' },
    });
    const q = await pegarQuadro(campanha.id);
    expect(q.colunas).toHaveLength(3);
    expect(q.totalLeads).toBe(0);
  });
});
