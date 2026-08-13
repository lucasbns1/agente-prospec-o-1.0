/**
 * E2E — o quadro de estado da campanha.
 *
 * O que este spec protege, e que nenhum teste de unidade pega: que o
 * numero no topo da coluna e o conteudo dela contam a MESMA historia na
 * tela de verdade. Um lead em intervencao aparecendo nas duas colunas
 * passaria em qualquer teste de API que olhasse uma coluna por vez.
 *
 * Requer `pnpm dev` rodando e o banco migrado com seed.
 */
import { test, expect } from '@playwright/test';
import { limparLeadsECampanhas } from './helpers';

const EMAIL = process.env.SEED_USER_EMAIL ?? 'admin@local';
const SENHA = process.env.SEED_USER_PASSWORD ?? 'prospector123';

/** Sufixo unico: a suite roda contra um banco compartilhado. */
const RUN = Date.now().toString(36);
const NOME_CAMPANHA = `E2E Quadro ${RUN}`;

/**
 * Monta a campanha direto no banco.
 *
 * Passar pela interface para criar campanha, etapas e leads sao outros
 * specs — repetir aqui tornaria este teste refem deles: uma mudanca no
 * formulario quebraria o spec do quadro, que nao tem nada com isso.
 */
async function prepararCenario(): Promise<void> {
  const { prisma } = await import('../../packages/database/src/index.js');

  const campanha = await prisma.campaign.create({
    data: { nome: NOME_CAMPANHA, status: 'ATIVA' },
  });

  const etapas = [];
  for (let i = 1; i <= 3; i += 1) {
    etapas.push(
      await prisma.campaignStep.create({
        data: {
          campaignId: campanha.id,
          ordem: i,
          nome: i === 3 ? 'Enviar a prévia' : null,
          texto: `Mensagem ${i}`,
          ativo: true,
        },
      })
    );
  }

  // Um lead por coluna, mais um extra na etapa 1 — assim uma coluna tem
  // contagem 2 e da para ver que o numero nao e sempre 1.
  const cenario: Array<[string, number | null]> = [
    ['PENDENTE', null],
    ['EM_ANDAMENTO', 0],
    ['EM_ANDAMENTO', 0],
    ['AGUARDANDO_RESPOSTA', 1],
    ['AGUARDANDO_INTERVENCAO', 1],
    ['OPT_OUT', 2],
  ];

  let n = 0;
  for (const [status, iEtapa] of cenario) {
    n += 1;
    const lead = await prisma.lead.create({
      data: {
        nomeCompleto: `Quadro ${RUN} ${n}`,
        empresa: `Empresa Quadro ${RUN} ${n}`,
        telefone: `(19) 98888-${String(1000 + n).slice(-4)}`,
        telefoneNormalizado: `551998${RUN.slice(-4)}${String(100 + n)}`,
        cidade: 'Campinas',
        estado: 'SP',
        websiteStatus: 'NAO_INFORMADO',
        status: 'IMPORTADO',
        optOut: status === 'OPT_OUT',
      },
    });

    await prisma.leadCampaign.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        status: status as never,
        etapaAtualId: iEtapa === null ? null : etapas[iEtapa]!.id,
      },
    });
  }

  await prisma.$disconnect();
}

test.beforeAll(async () => {
  await limparLeadsECampanhas();
  await prepararCenario();
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('o quadro mostra cada lead em uma coluna só', async ({ page }) => {
  await page.getByRole('link', { name: 'Estado das campanhas' }).click();
  await expect(
    page.getByRole('heading', { name: 'Estado das campanhas' })
  ).toBeVisible();

  await expect(page.getByRole('link', { name: NOME_CAMPANHA })).toBeVisible();
  await page.getByRole('link', { name: NOME_CAMPANHA }).click();

  await expect(page.getByRole('heading', { name: NOME_CAMPANHA })).toBeVisible();
  await expect(page.getByText('6 leads nesta campanha.')).toBeVisible();

  // --- As colunas existem, na ordem certa ---
  const naFila = page.getByRole('region', { name: /^Na fila:/ });
  const precisa = page.getByRole('region', { name: /^Precisa de você:/ });
  const encerrados = page.getByRole('region', { name: /^Encerrados:/ });

  await expect(naFila).toBeVisible();
  await expect(precisa).toBeVisible();
  await expect(encerrados).toBeVisible();

  // A etapa sem nome cai para "Mensagem N"; a nomeada usa o nome.
  await expect(page.getByRole('region', { name: /^Mensagem 1:/ })).toBeVisible();
  await expect(page.getByRole('region', { name: /^Mensagem 2:/ })).toBeVisible();
  await expect(
    page.getByRole('region', { name: /^Enviar a prévia:/ })
  ).toBeVisible();

  // --- As contagens ---
  await expect(page.getByRole('region', { name: 'Na fila: 1' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mensagem 1: 2' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mensagem 2: 1' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Precisa de você: 1' })
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Encerrados: 1' })).toBeVisible();

  // --- O que este spec existe para provar ---
  //
  // O lead em intervencao estava na etapa 2. Ele tem que aparecer em
  // "Precisa de você" e NAO na coluna da mensagem 2 — senao a soma das
  // colunas passaria do total de leads.
  //
  // Os leads 4 e 5 estao AMBOS na etapa 2. O 4 esta andando; o 5 caiu em
  // intervencao. A coluna da mensagem 2 fica com o 4 e SO com ele.
  const mensagem2 = page.getByRole('region', { name: /^Mensagem 2:/ });
  await expect(mensagem2).toContainText(`Empresa Quadro ${RUN} 4`);
  await expect(mensagem2).not.toContainText(`Empresa Quadro ${RUN} 5`);
  await expect(precisa).toContainText(`Empresa Quadro ${RUN} 5`);

  // O opt-out saiu da etapa 3 e foi para encerrados.
  await expect(
    page.getByRole('region', { name: /^Enviar a prévia:/ })
  ).toContainText('Ninguém aqui.');
  await expect(encerrados).toContainText(`Empresa Quadro ${RUN} 6`);

  // --- O cartao leva para a conversa do lead ---
  await naFila.getByText(`Empresa Quadro ${RUN} 1`).click();
  await expect(page).toHaveURL(/\/conversas\//);
});

test('o menu de ações permite pausar a campanha', async ({ page }) => {
  await page.getByRole('link', { name: 'Estado das campanhas' }).click();

  await page
    .getByRole('button', { name: `Ações da campanha ${NOME_CAMPANHA}` })
    .click();

  // Campanha ativa oferece pausar, nunca ativar.
  await expect(page.getByRole('menuitem', { name: /Pausar/ })).toBeVisible();
  await page.getByRole('menuitem', { name: /Pausar/ }).click();

  await expect(page.getByText('Pausada')).toBeVisible();

  // E o menu fecha ao escolher — nao pode ficar preso na tela.
  await expect(page.getByRole('menuitem', { name: /Pausar/ })).toHaveCount(0);
});
