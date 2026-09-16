/**
 * Trocar de número de WhatsApp, pela rota de verdade.
 *
 * ============================================================
 * O QUE PRECISA SER VERDADE AQUI
 * ============================================================
 * Esta e a primeira rota que COMANDA o worker — todas as outras do
 * canal so leem. Tres coisas nao podem sair do lugar:
 *
 *   1. a escolha fica gravada (ela sobrevive a reinicio, e e por ela
 *      que o worker decide em qual numero acordar);
 *   2. o pedido chega ao worker (sem isso a tela troca sozinha e a
 *      conexao continua no numero antigo — a pior combinacao: a tela
 *      diz um numero e as mensagens saem do outro);
 *   3. as campanhas ativas sao pausadas, porque a cadencia e uma
 *      conversa e ela nao pode continuar por outro numero.
 *
 * Requer Postgres e Redis no ar.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { CANAL_COMANDO, CHAVE_SETTING_NUMERO_ATIVO } from '@prospector/shared';

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
  await prisma.setting.deleteMany({ where: { chave: CHAVE_SETTING_NUMERO_ATIVO } });
});

function trocar(numero: string) {
  return app.inject({
    method: 'POST',
    url: '/api/canal/numero',
    headers: { cookie },
    payload: { numero },
  });
}

describe('POST /api/canal/numero', () => {
  it('exige autenticacao', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/canal/numero',
      payload: { numero: '2' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('so aceita 1 e 2', async () => {
    for (const ruim of ['3', 'dois', '', 0]) {
      const r = await trocar(ruim as string);
      expect(r.statusCode, `aceitou ${JSON.stringify(ruim)}`).toBeGreaterThanOrEqual(400);
    }
  });

  it('grava a escolha, para o worker acordar no numero certo', async () => {
    const r = await trocar('2');
    expect(r.statusCode).toBe(200);
    expect(r.json().trocou).toBe(true);

    const s = await prisma.setting.findUnique({
      where: { chave: CHAVE_SETTING_NUMERO_ATIVO },
    });
    expect(s?.valor).toBe('2');
  });

  it('o padrao e o numero 1 — o que ja estava em uso', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/canal/numeros',
      headers: { cookie },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().ativo).toBe('1');
  });

  /**
   * Sem esta publicacao a tela trocaria sozinha e a conexao continuaria
   * no numero antigo: a tela dizendo um numero e as mensagens saindo do
   * outro. E o tipo de divergencia que so aparece na conversa do
   * cliente.
   */
  it('publica o pedido de troca para o worker', async () => {
    // A conexao vem do helper do worker: `ioredis` e dependencia dele, e
    // nao da raiz do monorepo.
    const { getPublicador, fecharPublicador } = await import(
      '../apps/worker/src/redis.js'
    );
    const ouvinte = getPublicador();

    try {
      const recebido = new Promise<string>((resolve, reject) => {
        const prazo = setTimeout(() => reject(new Error('nada publicado em 5s')), 5000);
        void ouvinte.subscribe(CANAL_COMANDO).then(() => {
          ouvinte.on('message', (_c, m) => {
            clearTimeout(prazo);
            resolve(m);
          });
          void trocar('2');
        });
      });

      expect(JSON.parse(await recebido)).toEqual({ tipo: 'trocar-numero', numero: '2' });
    } finally {
      await fecharPublicador();
    }
  });

  /**
   * Em FALHOU nao ha QR: ninguem esta tentando conectar, entao ninguem
   * esta pedindo codigo. Este pedido e a saida sem passar pelo terminal
   * — e ele NAO pode pausar campanha nem mexer no numero ativo, porque
   * nao esta trocando nada, so religando o mesmo.
   */
  it('reconectar pede ao worker sem mexer nas campanhas', async () => {
    await prisma.campaign.create({ data: { nome: 'Ativa', status: 'ATIVA' } });

    const r = await app.inject({
      method: 'POST',
      url: '/api/canal/reconectar',
      headers: { cookie },
      payload: { novoQr: true },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().novoQr).toBe(true);
    expect(await prisma.campaign.count({ where: { status: 'ATIVA' } })).toBe(1);
  });

  it('reconectar sem corpo nenhum nao apaga credencial', async () => {
    // O padrao precisa ser o passo CONSERVADOR: um pedido sem parametro
    // nao pode descartar a sessao salva e obrigar a escanear QR.
    const r = await app.inject({
      method: 'POST',
      url: '/api/canal/reconectar',
      headers: { cookie },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().novoQr).toBe(false);
  });

  it('pausa as campanhas ativas ao trocar', async () => {
    await prisma.campaign.create({ data: { nome: 'Ativa 1', status: 'ATIVA' } });
    await prisma.campaign.create({ data: { nome: 'Ativa 2', status: 'ATIVA' } });
    const parada = await prisma.campaign.create({
      data: { nome: 'Já pausada', status: 'PAUSADA' },
    });

    const r = await trocar('2');
    expect(r.json().campanhasPausadas).toBe(2);

    expect(await prisma.campaign.count({ where: { status: 'ATIVA' } })).toBe(0);
    // A que ja estava pausada continua pausada, e nao "repausada".
    const antes = await prisma.campaign.findUniqueOrThrow({ where: { id: parada.id } });
    expect(antes.status).toBe('PAUSADA');
  });

  /**
   * Pedir o numero que ja esta ativo nao pode pausar campanha nenhuma.
   * Um clique sem querer no botao aceso pararia a operacao inteira sem
   * nada ter mudado.
   */
  it('escolher o numero que ja esta ativo nao mexe em nada', async () => {
    await prisma.campaign.create({ data: { nome: 'Ativa', status: 'ATIVA' } });

    const r = await trocar('1');

    expect(r.json().trocou).toBe(false);
    expect(r.json().campanhasPausadas).toBe(0);
    expect(await prisma.campaign.count({ where: { status: 'ATIVA' } })).toBe(1);
  });
});
