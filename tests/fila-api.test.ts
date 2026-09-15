/**
 * A lista da fila — quantas linhas ela realmente devolve.
 *
 * ============================================================
 * A RECLAMACAO QUE ISTO FECHA
 * ============================================================
 * "Nao esta aparecendo os agendados" e "quero que apareca mais que 500".
 *
 * Os contadores contam a fila INTEIRA; a lista vinha cortada. E o corte
 * era pior do que o numero dizia: a rota aceitava `limite` ate 500, mas
 * a tela nunca mandava esse parametro — entao o que se via eram sempre
 * as 100 do padrao. Numa campanha de mil linhas, "Agendada: 700" com
 * cem na lista parece mensagem perdida.
 *
 * O que estes testes prendem no lugar: o padrao continua pequeno (nao
 * se traz mil linhas para quem so abriu a aba), o teto vai bem alem de
 * 500, e um pedido acima do teto e RECUSADO em vez de silenciosamente
 * reduzido — um limite que mente e pior que um limite baixo.
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
  await prisma.campaignStep.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.lead.deleteMany();
});

let n = 0;

/**
 * Uma campanha com `quantas` mensagens na fila, metade AGENDADA.
 *
 * As agendadas ficam DEPOIS na ordem (`scheduledAt` maior), que e
 * exatamente a situacao real: a lista ordena da mais antiga para a mais
 * nova, entao sao elas que caem fora de um corte pequeno.
 */
async function filaCom(quantas: number) {
  const campanha = await prisma.campaign.create({
    data: { nome: `Campanha ${Date.now()}-${(n += 1)}`, status: 'ATIVA' },
  });
  const etapa = await prisma.campaignStep.create({
    data: { campaignId: campanha.id, ordem: 1, texto: 'Oi', ativo: true },
  });

  const base = Date.now();
  for (let i = 0; i < quantas; i += 1) {
    n += 1;
    const lead = await prisma.lead.create({
      data: {
        nomeCompleto: `Lead ${n}`,
        empresa: `Empresa ${n}`,
        telefone: `(19) 99999-${String(1000 + n).slice(-4)}`,
        telefoneNormalizado: `5519988${String(100000 + n).slice(-6)}`,
        websiteStatus: 'NAO_INFORMADO',
        status: 'IMPORTADO',
      },
    });
    const agendada = i >= quantas / 2;
    await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapa.id,
        idempotencyKey: `fila-${n}-${base}`,
        status: agendada ? 'AGENDADA' : 'ENVIADA',
        scheduledAt: new Date(base + i * 60_000),
        textoRenderizado: 'Oi',
        dryRun: true,
      },
    });
  }

  return campanha;
}

function pegarFila(campaignId: string, query = '') {
  return app.inject({
    method: 'GET',
    url: `/api/campaigns/${campaignId}/fila${query}`,
    headers: { cookie },
  });
}

describe('GET /api/campaigns/:id/fila — o tamanho da lista', () => {
  it('exige autenticacao', async () => {
    const campanha = await filaCom(2);
    const r = await app.inject({
      method: 'GET',
      url: `/api/campaigns/${campanha.id}/fila`,
    });
    expect(r.statusCode).toBe(401);
  });

  it('sem limite pedido, devolve o padrao de 100', async () => {
    const campanha = await filaCom(120);
    const r = await pegarFila(campanha.id);

    expect(r.statusCode).toBe(200);
    expect(r.json().mensagens).toHaveLength(100);
  });

  it('aceita limite acima de 500 — era o teto antigo', async () => {
    const campanha = await filaCom(520);
    const r = await pegarFila(campanha.id, '?limite=520');

    expect(r.statusCode).toBe(200);
    expect(r.json().mensagens).toHaveLength(520);
  });

  /**
   * O teto existe porque cada linha traz o texto renderizado inteiro.
   * Pedir acima dele e um erro visivel, e nao um corte calado: se a API
   * devolvesse 5000 para quem pediu 9000, a tela diria "mostrando
   * todas" sobre uma lista incompleta.
   */
  it('recusa um limite acima do teto em vez de reduzir calado', async () => {
    const campanha = await filaCom(2);
    const r = await pegarFila(campanha.id, '?limite=9000');

    expect(r.statusCode).toBeGreaterThanOrEqual(400);
  });

  /**
   * O caso do print: contador dizendo "Agendada: N" e a lista sem
   * nenhuma agendada, porque as enviadas ocupavam o corte inteiro.
   */
  it('filtrando por AGENDADA, as agendadas aparecem mesmo com muitas enviadas antes', async () => {
    const campanha = await filaCom(300);

    const semFiltro = await pegarFila(campanha.id);
    const agendadasNoCorte = semFiltro
      .json()
      .mensagens.filter((m: { status: string }) => m.status === 'AGENDADA');
    // As 100 mais antigas sao todas enviadas: e por isso que a tela
    // parecia nao ter agendadas.
    expect(agendadasNoCorte).toHaveLength(0);

    const filtrado = await pegarFila(campanha.id, '?status=AGENDADA&limite=500');
    const corpo = filtrado.json();

    expect(corpo.mensagens).toHaveLength(150);
    // O contador continua contando a fila inteira, e nao o recorte.
    expect(corpo.contagem.AGENDADA).toBe(150);
    expect(corpo.contagem.ENVIADA).toBe(150);
  });
});
