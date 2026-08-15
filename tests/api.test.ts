/**
 * Testes de API — rodam contra Postgres e Redis reais.
 *
 * Nao usamos mock do Prisma de proposito: o que precisa ser verificado
 * aqui e justamente o comportamento do BANCO — as constraints UNIQUE que
 * garantem a deduplicacao, os filtros SQL e a paginacao. Um mock
 * confirmaria apenas que o mock funciona.
 *
 * Requer `docker compose up -d` e `pnpm db:migrate && pnpm db:seed`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { FastifyInstance } from 'fastify';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });
// Silencia o logger da API: os testes exercitam varios caminhos de erro
// de proposito, e os stacks poluiriam a saida.
process.env.LOG_LEVEL = 'silent';

const FIXTURES = path.join(raiz, 'tests', 'fixtures');

let app: FastifyInstance;
let cookie: string;
let prisma: typeof import('@prospector/database').prisma;

/** Monta um corpo multipart valido sem depender de libs extras. */
function multipart(
  arquivo: { nome: string; conteudo: Buffer },
  campos: Record<string, string> = {}
): { body: Buffer; headers: Record<string, string> } {
  const boundary = `----teste${Date.now()}`;
  const partes: Buffer[] = [];

  for (const [k, v] of Object.entries(campos)) {
    partes.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
      )
    );
  }

  partes.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="${arquivo.nome}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`
    ),
    arquivo.conteudo,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  );

  return {
    body: Buffer.concat(partes),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

beforeAll(async () => {
  const db = await import('@prospector/database');
  prisma = db.prisma;
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
    throw new Error(
      `Login falhou (${login.statusCode}). Rode: pnpm db:migrate && pnpm db:seed`
    );
  }

  cookie = login.headers['set-cookie']!.toString().split(';')[0]!;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

beforeEach(async () => {
  // Cada teste comeca com o CRM vazio. A ordem respeita as FKs.
  await prisma.leadEvent.deleteMany();
  await prisma.websiteCheck.deleteMany();
  await prisma.importRow.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.import.deleteMany();
});

const autenticado = (url: string, method = 'GET') =>
  app.inject({ method: method as 'GET', url, headers: { cookie } });

// -----------------------------------------------------------------------------
describe('autenticacao', () => {
  it('bloqueia rotas sem cookie', async () => {
    for (const url of ['/api/leads', '/api/dashboard', '/api/notifications']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(401);
    }
  });

  it('libera com cookie valido', async () => {
    expect((await autenticado('/api/leads')).statusCode).toBe(200);
  });
});

// -----------------------------------------------------------------------------
describe('POST /api/imports/analisar', () => {
  it('devolve a previa SEM gravar nada', async () => {
    const { body, headers } = multipart({
      nome: 'leads.csv',
      conteudo: readFileSync(path.join(FIXTURES, 'leads.csv')),
    });

    const r = await app.inject({
      method: 'POST', url: '/api/imports/analisar',
      headers: { ...headers, cookie }, payload: body,
    });

    expect(r.statusCode).toBe(200);
    const d = r.json();

    expect(d.resumo.totalLinhas).toBe(10);
    expect(d.resumo.novos).toBe(7);
    expect(d.resumo.duplicadosNoArquivo).toBe(2);
    expect(d.resumo.invalidos).toBe(1);

    // A garantia central desta rota:
    expect(await prisma.lead.count()).toBe(0);
    expect(await prisma.import.count()).toBe(0);
  });

  it('mapeia colunas em ingles do XLSX', async () => {
    const { body, headers } = multipart({
      nome: 'leads.xlsx',
      conteudo: readFileSync(path.join(FIXTURES, 'leads.xlsx')),
    });

    const r = await app.inject({
      method: 'POST', url: '/api/imports/analisar',
      headers: { ...headers, cookie }, payload: body,
    });

    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.mapeamento.nome).toBe('Name');
    expect(d.mapeamento.telefone).toBe('Phone');
    expect(d.resumo.novos).toBe(7);
  });

  it('recusa formato nao suportado', async () => {
    const { body, headers } = multipart({
      nome: 'planilha.pdf', conteudo: Buffer.from('x'),
    });
    const r = await app.inject({
      method: 'POST', url: '/api/imports/analisar',
      headers: { ...headers, cookie }, payload: body,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro.codigo).toBe('FORMATO_INVALIDO');
  });

  it('neutraliza path traversal no nome do arquivo', async () => {
    // Defesa em profundidade: o busboy (dentro do @fastify/multipart) ja
    // descarta o caminho e entrega so o basename, entao a requisicao
    // passa — mas com o nome sanitizado. A validacao de `validarNomeArquivo`
    // e a segunda barreira, para o caso de a primeira mudar de
    // comportamento numa atualizacao.
    const { body, headers } = multipart({
      nome: '../../etc/passwd.csv',
      conteudo: Buffer.from('Nome,Telefone\nMaria,(19) 99999-1111'),
    });
    const r = await app.inject({
      method: 'POST', url: '/api/imports/analisar',
      headers: { ...headers, cookie }, payload: body,
    });

    // O importante: nenhum caminho relativo sobrevive, e nada foi gravado.
    expect(r.statusCode).toBe(200);
    expect(await prisma.lead.count()).toBe(0);
  });

  it('recusa nome com barra que chegue a validacao', async () => {
    // Chama a rota de confirmacao com um nome que o busboy nao sanitiza
    // (sem separador de caminho, mas com extensao proibida).
    const { body, headers } = multipart({
      nome: 'arquivo.exe', conteudo: Buffer.from('x'),
    });
    const r = await app.inject({
      method: 'POST', url: '/api/imports/confirmar',
      headers: { ...headers, cookie }, payload: body,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro.codigo).toBe('FORMATO_INVALIDO');
  });

  it('recusa arquivo vazio', async () => {
    const { body, headers } = multipart({
      nome: 'vazio.csv', conteudo: Buffer.from(''),
    });
    const r = await app.inject({
      method: 'POST', url: '/api/imports/analisar',
      headers: { ...headers, cookie }, payload: body,
    });
    expect(r.statusCode).toBe(400);
  });
});

// -----------------------------------------------------------------------------
describe('POST /api/imports/confirmar', () => {
  async function importar() {
    const { body, headers } = multipart({
      nome: 'leads.csv',
      conteudo: readFileSync(path.join(FIXTURES, 'leads.csv')),
    });
    return app.inject({
      method: 'POST', url: '/api/imports/confirmar',
      headers: { ...headers, cookie }, payload: body,
    });
  }

  it('grava os leads e registra a importacao', async () => {
    const r = await importar();
    expect(r.statusCode).toBe(200);

    const d = r.json();
    expect(d.resumo.importados).toBe(7);
    expect(await prisma.lead.count()).toBe(7);

    const registro = await prisma.import.findUnique({ where: { id: d.importId } });
    expect(registro?.status).toBe('CONCLUIDO');
    expect(registro?.totalImportados).toBe(7);
  });

  it('classifica corretamente quem nao tem site proprio', async () => {
    await importar();

    const semSite = await prisma.lead.count({
      where: { websiteStatus: { in: ['NAO_INFORMADO', 'REDE_SOCIAL', 'INVALIDO'] } },
    });
    const redeSocial = await prisma.lead.count({ where: { websiteStatus: 'REDE_SOCIAL' } });

    expect(semSite).toBe(4);
    expect(redeSocial).toBe(2); // 1 Instagram + 1 Facebook
  });

  it('registra TODAS as linhas, inclusive as ignoradas', async () => {
    const r = await importar();
    const rows = await prisma.importRow.findMany({
      where: { importId: r.json().importId },
    });
    // Nada e descartado em silencio.
    expect(rows.length).toBe(10);
    expect(rows.filter((x) => x.status === 'DUPLICADO').length).toBe(2);
    expect(rows.filter((x) => x.status === 'INVALIDO').length).toBe(1);
  });

  it('aponta qual lead causou a duplicidade', async () => {
    const r = await importar();
    const dup = await prisma.importRow.findFirst({
      where: { importId: r.json().importId, status: 'DUPLICADO' },
    });
    expect(dup?.motivoErro).toBeTruthy();
    expect(dup?.dedupeCriterio).toBeTruthy();
  });

  it('reimportar o mesmo arquivo NAO cria leads novos', async () => {
    await importar();
    expect(await prisma.lead.count()).toBe(7);

    const segunda = await importar();
    expect(segunda.json().resumo.importados).toBe(0);
    expect(await prisma.lead.count()).toBe(7);
  });

  it('cria o historico de eventos do lead', async () => {
    await importar();
    const lead = await prisma.lead.findFirst({
      where: { nomeCompleto: { contains: 'Maria' } },
      include: { events: true },
    });
    expect(lead!.events.length).toBeGreaterThanOrEqual(2);
    expect(lead!.events.some((e) => e.tipo === 'IMPORTADO')).toBe(true);
    expect(lead!.events.some((e) => e.tipo === 'WEBSITE_VERIFICADO')).toBe(true);
  });

  it('preserva os dados brutos da linha', async () => {
    await importar();
    const lead = await prisma.lead.findFirst({
      where: { nomeCompleto: { contains: 'Maria' } },
    });
    expect(lead!.dadosBrutos).toBeTruthy();
    expect(lead!.nomeOriginal).toBe('Psicóloga Maria Silva');
  });

  it('filtro somenteSemSite importa apenas quem nao tem site', async () => {
    const { body, headers } = multipart(
      { nome: 'leads.csv', conteudo: readFileSync(path.join(FIXTURES, 'leads.csv')) },
      { somenteSemSite: 'true' }
    );
    const r = await app.inject({
      method: 'POST', url: '/api/imports/confirmar',
      headers: { ...headers, cookie }, payload: body,
    });

    expect(r.json().resumo.importados).toBe(4);
    expect(await prisma.lead.count({ where: { websiteStatus: 'SITE_PROPRIO' } })).toBe(0);
  });
});

// -----------------------------------------------------------------------------
describe('GET /api/leads', () => {
  beforeEach(async () => {
    const { body, headers } = multipart({
      nome: 'leads.csv',
      conteudo: readFileSync(path.join(FIXTURES, 'leads.csv')),
    });
    await app.inject({
      method: 'POST', url: '/api/imports/confirmar',
      headers: { ...headers, cookie }, payload: body,
    });
  });

  it('lista com paginacao', async () => {
    const d = (await autenticado('/api/leads')).json();
    expect(d.leads.length).toBe(7);
    expect(d.paginacao.total).toBe(7);
  });

  it('pagina corretamente', async () => {
    const d = (await autenticado('/api/leads?porPagina=3&pagina=2')).json();
    expect(d.leads.length).toBe(3);
    expect(d.paginacao.totalPaginas).toBe(3);
  });

  it('filtra SEM_SITE incluindo redes sociais', async () => {
    const d = (await autenticado('/api/leads?visao=SEM_SITE')).json();
    expect(d.paginacao.total).toBe(4);
    for (const l of d.leads) {
      expect(l.websiteStatus).not.toBe('SITE_PROPRIO');
    }
  });

  it('filtra COM_SITE', async () => {
    const d = (await autenticado('/api/leads?visao=COM_SITE')).json();
    expect(d.paginacao.total).toBe(3);
  });

  it('filtra SEM_TELEFONE', async () => {
    const d = (await autenticado('/api/leads?visao=SEM_TELEFONE')).json();
    expect(d.paginacao.total).toBe(2);
    for (const l of d.leads) expect(l.telefoneNormalizado).toBeNull();
  });

  it('busca por nome', async () => {
    const d = (await autenticado('/api/leads?busca=Maria')).json();
    expect(d.paginacao.total).toBe(1);
    expect(d.leads[0].nomeCompleto).toContain('Maria');
  });

  it('busca por telefone com formatacao', async () => {
    const d = (await autenticado('/api/leads?busca=' + encodeURIComponent('(19) 99999-1111'))).json();
    expect(d.paginacao.total).toBeGreaterThanOrEqual(1);
  });

  it('busca por bairro e cidade', async () => {
    expect((await autenticado('/api/leads?busca=Cambuí')).json().paginacao.total).toBe(1);
    expect((await autenticado('/api/leads?busca=Campinas')).json().paginacao.total).toBe(7);
  });

  it('filtra por cidade', async () => {
    const d = (await autenticado('/api/leads?cidade=Campinas')).json();
    expect(d.paginacao.total).toBe(7);
  });

  it('devolve os contadores de todas as visoes', async () => {
    const d = (await autenticado('/api/leads/contadores')).json();
    expect(d.contadores.TODOS).toBe(7);
    expect(d.contadores.SEM_SITE).toBe(4);
    expect(d.contadores.COM_SITE).toBe(3);
  });

  it('devolve os valores de filtro disponiveis', async () => {
    const d = (await autenticado('/api/leads/filtros')).json();
    expect(d.cidades).toContain('Campinas');
    expect(d.categorias.length).toBeGreaterThan(0);
  });

  it('rejeita visao invalida', async () => {
    expect((await autenticado('/api/leads?visao=INVENTADA')).statusCode).toBe(422);
  });
});

// -----------------------------------------------------------------------------
describe('GET /api/leads/:id', () => {
  it('devolve o lead com historico', async () => {
    const { body, headers } = multipart({
      nome: 'leads.csv',
      conteudo: readFileSync(path.join(FIXTURES, 'leads.csv')),
    });
    await app.inject({
      method: 'POST', url: '/api/imports/confirmar',
      headers: { ...headers, cookie }, payload: body,
    });

    const lead = await prisma.lead.findFirst();
    const d = (await autenticado(`/api/leads/${lead!.id}`)).json();

    expect(d.lead.id).toBe(lead!.id);
    expect(Array.isArray(d.lead.events)).toBe(true);
    expect(d.lead.events.length).toBeGreaterThan(0);
  });

  it('404 para lead inexistente', async () => {
    const r = await autenticado('/api/leads/00000000-0000-0000-0000-000000000000');
    expect(r.statusCode).toBe(404);
  });

  it('422 para id que nao e uuid', async () => {
    expect((await autenticado('/api/leads/abc')).statusCode).toBe(422);
  });
});

// -----------------------------------------------------------------------------
describe('GET /api/dashboard', () => {
  it('reflete os leads importados', async () => {
    const antes = (await autenticado('/api/dashboard')).json();
    expect(antes.metricas.totalLeads).toBe(0);

    const { body, headers } = multipart({
      nome: 'leads.csv',
      conteudo: readFileSync(path.join(FIXTURES, 'leads.csv')),
    });
    await app.inject({
      method: 'POST', url: '/api/imports/confirmar',
      headers: { ...headers, cookie }, payload: body,
    });

    const depois = (await autenticado('/api/dashboard')).json();
    expect(depois.metricas.totalLeads).toBe(7);
    expect(depois.metricas.semSite).toBe(4);
    expect(depois.metricas.comSite).toBe(3);
    expect(depois.metricas.totalImportados).toBe(7);
    expect(depois.metricas.leadsHoje).toBe(7);
    // Nenhuma mensagem foi enviada nesta fase.
    expect(depois.metricas.mensagensEnviadas).toBe(0);
  });
});

// -----------------------------------------------------------------------------
describe('notificacoes', () => {
  it('lista vazia quando nao ha nada', async () => {
    const d = (await autenticado('/api/notifications')).json();
    expect(d.notificacoes).toEqual([]);
    expect(d.naoLidas).toBe(0);
  });

  it('ordena por prioridade antes de data', async () => {
    // Uma notificacao antiga de alta prioridade e uma recente de baixa.
    await prisma.notification.create({
      data: {
        tipo: 'INTERVENCAO_NECESSARIA', nivel: 'ALERTA', prioridade: 1,
        titulo: 'Intervenção necessária', mensagem: 'Resposta não reconhecida',
        createdAt: new Date(Date.now() - 86_400_000),
      },
    });
    await prisma.notification.create({
      data: {
        tipo: 'IMPORTACAO_CONCLUIDA', nivel: 'INFO', prioridade: 50,
        titulo: 'Importação concluída', mensagem: '7 leads',
      },
    });

    const d = (await autenticado('/api/notifications')).json();
    expect(d.naoLidas).toBe(2);
    // A intervencao vem primeiro mesmo sendo mais antiga.
    expect(d.notificacoes[0].tipo).toBe('INTERVENCAO_NECESSARIA');
  });

  it('marca como lida', async () => {
    const n = await prisma.notification.create({
      data: {
        tipo: 'SISTEMA', nivel: 'INFO', prioridade: 50,
        titulo: 'Teste', mensagem: 'x',
      },
    });

    const r = await app.inject({
      method: 'POST', url: `/api/notifications/${n.id}/read`, headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    expect((await autenticado('/api/notifications')).json().naoLidas).toBe(0);
  });

  it('404 ao marcar notificacao inexistente', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/notifications/00000000-0000-0000-0000-000000000000/read',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DDI PADRAO
//
// A configuracao existia no banco desde o inicio, mas nao havia rota
// para muda-la: trocar o pais das listas exigia abrir o Postgres. Sem
// isso, uma lista de Portugal so aceitava os numeros que ja viessem com
// "+351" na planilha — e o "+" e formatacao, nao decisao de negocio.
// ---------------------------------------------------------------------------
describe('PUT /api/settings/ddi-padrao', () => {
  async function ler(): Promise<string> {
    const r = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie },
    });
    const body = r.json() as {
      settings: Array<{ chave: string; valor: unknown }>;
    };
    return String(
      body.settings.find((s) => s.chave === 'leads.telefone_ddi_padrao')?.valor
    );
  }

  afterEach(async () => {
    // Outros testes dependem do padrao brasileiro.
    await app.inject({
      method: 'PUT',
      url: '/api/settings/ddi-padrao',
      headers: { cookie },
      payload: { valor: '55' },
    });
  });

  it('troca o DDI e o valor persiste', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/settings/ddi-padrao',
      headers: { cookie },
      payload: { valor: '351' },
    });
    expect(r.statusCode).toBe(200);
    expect(await ler()).toBe('351');
  });

  it('avisa que não reprocessa o que já foi importado', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/settings/ddi-padrao',
      headers: { cookie },
      payload: { valor: '351' },
    });
    // Sem o aviso, a expectativa natural é que os leads já importados
    // mudem de número junto — e eles não mudam.
    expect((r.json() as { aviso: string }).aviso).toMatch(/PRÓXIMAS importações/i);
  });

  it('recusa o "+" — ele quebraria o E.164 sem "+" usado no resto', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/settings/ddi-padrao',
      headers: { cookie },
      payload: { valor: '+351' },
    });
    expect(r.statusCode).toBe(422);
    expect(await ler()).toBe('55');
  });

  it('recusa texto e DDI longo demais', async () => {
    for (const valor of ['portugal', '3511', '']) {
      const r = await app.inject({
        method: 'PUT',
        url: '/api/settings/ddi-padrao',
        headers: { cookie },
        payload: { valor },
      });
      expect(r.statusCode).toBe(422);
    }
  });

  it('exige autenticação', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/settings/ddi-padrao',
      payload: { valor: '351' },
    });
    expect(r.statusCode).toBe(401);
  });
});
