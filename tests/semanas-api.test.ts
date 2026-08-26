/**
 * O relatório semanal, contra Postgres real.
 *
 * ============================================================
 * O QUE ESTES TESTES ADICIONAM
 * ============================================================
 * A CONTA já tem 19 testes puros em `relatorio-semana.test.ts`. O que
 * só o banco pode provar é a LEITURA: que o recorte de data pega a
 * semana certa, que o nicho sai mesmo da planilha de origem, que a
 * resposta atrasada é buscada sem recorte, e que a etapa da prévia é
 * inferida da etapa manual.
 *
 * Um erro em qualquer um desses passa por todos os testes puros — eles
 * recebem as linhas já prontas.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { FastifyInstance } from 'fastify';

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
  await prisma.captureSession.deleteMany();
});

/** Uma quarta-feira. A semana dela começa no domingo, dia 4. */
const QUARTA = new Date(2026, 0, 7, 14, 0, 0);
const DOMINGO = new Date(2026, 0, 4, 0, 0, 0);

let seq = 0;

async function lead(nicho: string | null = null) {
  seq += 1;
  let captureSessionId: string | null = null;
  if (nicho) {
    const s = await prisma.captureSession.create({
      data: { nicho, cidade: 'Campinas' },
    });
    captureSessionId = s.id;
  }
  return prisma.lead.create({
    data: {
      nomeCompleto: `Semana ${seq}`,
      empresa: `Semana ${seq}`,
      telefone: `(19) 99999-${String(3000 + seq).slice(-4)}`,
      telefoneNormalizado: `5519999${String(300000 + seq).slice(-6)}`,
      websiteStatus: 'NAO_INFORMADO',
      status: 'AGUARDANDO_RESPOSTA',
      captureSessionId,
    } as never,
  });
}

async function campanha(etapas: { ordem: number; manual?: boolean }[]) {
  seq += 1;
  const c = await prisma.campaign.create({
    data: { nome: `Semana ${seq}-${Date.now()}`, status: 'ATIVA' } as never,
  });
  const criadas = [];
  for (const e of etapas) {
    criadas.push(
      await prisma.campaignStep.create({
        data: {
          campaignId: c.id,
          ordem: e.ordem,
          texto: `Mensagem ${e.ordem}`,
          ativo: true,
          enviarAutomaticamente: !e.manual,
        },
      })
    );
  }
  return { c, etapas: criadas };
}

async function enviou(leadId: string, campanhaId: string, etapaId: string, quando: Date) {
  seq += 1;
  await prisma.outboundMessage.create({
    data: {
      leadId,
      campaignId: campanhaId,
      campaignStepId: etapaId,
      idempotencyKey: `sem-${seq}-${Date.now()}`,
      status: 'ENVIADA',
      textoRenderizado: 'oi',
      processedAt: quando,
      dryRun: false,
    },
  });
}

async function respondeu(
  leadId: string,
  campanhaId: string,
  quando: Date,
  categoria: string | null = 'POSITIVO',
  confianca = 90
) {
  seq += 1;
  const conversa = await prisma.conversation.upsert({
    where: { id: `${leadId}-${campanhaId}` },
    update: {},
    create: { id: `${leadId}-${campanhaId}`, leadId, campaignId: campanhaId },
  });
  await prisma.message.create({
    data: {
      conversationId: conversa.id,
      leadId,
      campaignId: campanhaId,
      direcao: 'RECEBIDA',
      status: 'ENTREGUE',
      texto: 'quero sim',
      categoria: categoria as never,
      confianca,
      recebidaEm: quando,
      whatsappMessageId: `wa-sem-${seq}-${Date.now()}`,
    },
  });
}

const chamar = (url: string) =>
  app.inject({ method: 'GET', url, headers: { cookie } });

const daSemana = async () =>
  (await chamar(`/api/semanas/${encodeURIComponent(DOMINGO.toISOString())}`)).json();

describe('GET /api/semanas — o calendário', () => {
  it('lista só as semanas que tiveram envio', async () => {
    // Listar todas as semanas desde a primeira encheria o calendário de
    // domingos vazios.
    const l = await lead();
    const { c, etapas } = await campanha([{ ordem: 1 }]);
    await enviou(l.id, c.id, etapas[0]!.id, QUARTA);

    const r = await chamar('/api/semanas');
    expect(r.statusCode).toBe(200);

    const { semanas } = r.json();
    expect(semanas).toHaveLength(1);
    expect(new Date(semanas[0].inicio).getTime()).toBe(DOMINGO.getTime());
    expect(semanas[0].enviadas).toBe(1);
    expect(semanas[0].abordados).toBe(1);
  });

  it('separa semanas diferentes', async () => {
    const a = await lead();
    const b = await lead();
    const { c, etapas } = await campanha([{ ordem: 1 }]);
    await enviou(a.id, c.id, etapas[0]!.id, QUARTA);
    // Duas semanas depois.
    await enviou(b.id, c.id, etapas[0]!.id, new Date(2026, 0, 21, 10, 0, 0));

    const { semanas } = (await chamar('/api/semanas')).json();
    expect(semanas).toHaveLength(2);
    // Mais recente primeiro.
    expect(new Date(semanas[0].inicio).getTime()).toBeGreaterThan(
      new Date(semanas[1].inicio).getTime()
    );
  });

  it('banco vazio devolve lista vazia, sem quebrar', async () => {
    const { semanas } = (await chamar('/api/semanas')).json();
    expect(semanas).toEqual([]);
  });
});

describe('GET /api/semanas/:inicio — o recorte de data', () => {
  it('qualquer dia da semana traz a mesma semana', async () => {
    // A rota normaliza para o domingo. Sem isso, uma hora de diferença
    // de fuso na tela puxaria a semana errada.
    const l = await lead();
    const { c, etapas } = await campanha([{ ordem: 1 }]);
    await enviou(l.id, c.id, etapas[0]!.id, QUARTA);

    const pelaQuarta = (
      await chamar(`/api/semanas/${encodeURIComponent(QUARTA.toISOString())}`)
    ).json();
    const peloDomingo = await daSemana();

    expect(pelaQuarta.inicio).toBe(peloDomingo.inicio);
    expect(pelaQuarta.enviadas).toBe(1);
  });

  it('envio de outra semana NÃO entra', async () => {
    const l = await lead();
    const { c, etapas } = await campanha([{ ordem: 1 }]);
    await enviou(l.id, c.id, etapas[0]!.id, new Date(2026, 0, 21, 10, 0, 0));

    const r = await daSemana();
    expect(r.enviadas).toBe(0);
    expect(r.funil.abordados).toBe(0);
  });

  it('cai no dia certo da semana', async () => {
    const l = await lead();
    const { c, etapas } = await campanha([{ ordem: 1 }]);
    await enviou(l.id, c.id, etapas[0]!.id, QUARTA);

    const r = await daSemana();
    expect(r.porDia).toHaveLength(7);
    // Domingo é 0; quarta é 3.
    expect(r.porDia[3].enviadas).toBe(1);
    expect(r.porDia[0].enviadas).toBe(0);
  });

  it('data inválida é recusada', async () => {
    const r = await chamar('/api/semanas/banana');
    expect(r.statusCode).toBe(422);
  });
});

describe('as respostas vêm sem recorte de data', () => {
  it('resposta que chegou DEPOIS da semana ainda conta', async () => {
    // A pergunta é "o que aconteceu com quem eu abordei naquela
    // semana". A resposta que chegou na terça seguinte é sobre aquela
    // abordagem — e é justamente o que um retrato congelado no domingo
    // perderia.
    const l = await lead();
    const { c, etapas } = await campanha([{ ordem: 1 }]);
    await enviou(l.id, c.id, etapas[0]!.id, QUARTA);
    await respondeu(l.id, c.id, new Date(2026, 0, 20, 9, 0, 0));

    const r = await daSemana();
    expect(r.funil.responderam).toBe(1);
    expect(r.funil.semResposta).toBe(0);
    expect(r.funil.interessados).toBe(1);
  });

  it('resposta com confiança baixa conta como resposta, mas não como intenção', async () => {
    const l = await lead();
    const { c, etapas } = await campanha([{ ordem: 1 }]);
    await enviou(l.id, c.id, etapas[0]!.id, QUARTA);
    await respondeu(l.id, c.id, QUARTA, 'POSITIVO', 35);

    const r = await daSemana();
    expect(r.funil.responderam).toBe(1);
    expect(r.funil.interessados).toBe(0);
    expect(r.funil.naoEntendidas).toBe(1);
  });

  it('resposta sem categoria nenhuma não quebra', async () => {
    // O eco e as mensagens antigas podem estar sem classificação.
    const l = await lead();
    const { c, etapas } = await campanha([{ ordem: 1 }]);
    await enviou(l.id, c.id, etapas[0]!.id, QUARTA);
    await respondeu(l.id, c.id, QUARTA, null, 0);

    const r = await daSemana();
    expect(r.funil.responderam).toBe(1);
    expect(r.funil.naoEntendidas).toBe(1);
  });
});

describe('o nicho vem da planilha de origem', () => {
  it('separa os nichos e soma igual ao total', async () => {
    const a = await lead('Estética automotiva');
    const b = await lead('Psicólogo');
    const { c, etapas } = await campanha([{ ordem: 1 }]);
    await enviou(a.id, c.id, etapas[0]!.id, QUARTA);
    await enviou(b.id, c.id, etapas[0]!.id, QUARTA);

    const r = await daSemana();
    expect(r.porNicho.map((n: { nicho: string }) => n.nicho).sort()).toEqual([
      'Estética automotiva',
      'Psicólogo',
    ]);
    const soma = r.porNicho.reduce(
      (t: number, n: { enviadas: number }) => t + n.enviadas,
      0
    );
    expect(soma).toBe(r.enviadas);
  });

  it('lead sem planilha etiquetada vai para "Sem nicho"', async () => {
    const l = await lead(null);
    const { c, etapas } = await campanha([{ ordem: 1 }]);
    await enviou(l.id, c.id, etapas[0]!.id, QUARTA);

    const r = await daSemana();
    expect(r.porNicho.map((n: { nicho: string }) => n.nicho)).toContain('Sem nicho');
  });
});

describe('a etapa da prévia é inferida da etapa manual', () => {
  it('quem chegou na etapa manual recebeu a prévia', async () => {
    // Não existe campo "esta é a etapa da prévia". O que existe é
    // `enviarAutomaticamente: false` — e o schema explica: "usado na MSG
    // 3, que depende do preview ficar pronto".
    const a = await lead();
    const b = await lead();
    const { c, etapas } = await campanha([
      { ordem: 1 },
      { ordem: 2 },
      { ordem: 3, manual: true },
    ]);
    await enviou(a.id, c.id, etapas[2]!.id, QUARTA);
    await enviou(b.id, c.id, etapas[0]!.id, QUARTA);

    const r = await daSemana();
    expect(r.funil.receberamPrevia).toBe(1);
  });

  it('sem etapa manual, ninguém recebeu prévia', async () => {
    const l = await lead();
    const { c, etapas } = await campanha([{ ordem: 1 }, { ordem: 2 }]);
    await enviou(l.id, c.id, etapas[1]!.id, QUARTA);

    const r = await daSemana();
    expect(r.funil.receberamPrevia).toBe(0);
  });
});

describe('onde a conversa parou', () => {
  it('cada lead entra na MAIOR etapa que chegou nele', async () => {
    const l = await lead();
    const { c, etapas } = await campanha([{ ordem: 1 }, { ordem: 2 }]);
    await enviou(l.id, c.id, etapas[0]!.id, QUARTA);
    await enviou(l.id, c.id, etapas[1]!.id, QUARTA);

    const r = await daSemana();
    // Três mensagens não viram três pessoas.
    expect(r.enviadas).toBe(2);
    expect(r.funil.abordados).toBe(1);
    expect(r.travou).toHaveLength(1);
    expect(r.travou[0].ordem).toBe(2);
  });
});

describe('o que fica de fora', () => {
  it('SIMULADA não conta — um ensaio não abordou ninguém', async () => {
    const l = await lead();
    const { c, etapas } = await campanha([{ ordem: 1 }]);
    seq += 1;
    await prisma.outboundMessage.create({
      data: {
        leadId: l.id,
        campaignId: c.id,
        campaignStepId: etapas[0]!.id,
        idempotencyKey: `simu-${seq}-${Date.now()}`,
        status: 'SIMULADA',
        textoRenderizado: 'oi',
        processedAt: QUARTA,
        dryRun: true,
      },
    });

    const r = await daSemana();
    expect(r.enviadas).toBe(0);
  });

  it('semana sem envio devolve tudo zerado, com os sete dias', async () => {
    const r = await daSemana();
    expect(r.enviadas).toBe(0);
    expect(r.porDia).toHaveLength(7);
    expect(r.funil.abordados).toBe(0);
    expect(r.porNicho).toEqual([]);
    expect(r.travou).toEqual([]);
  });
});
