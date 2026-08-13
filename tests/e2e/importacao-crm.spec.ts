/**
 * E2E — o fluxo completo da Fase 2.
 *
 * login -> Importar -> escolher arquivo -> prévia -> importar
 *       -> Leads -> filtrar SEM SITE -> abrir o detalhe do lead
 *
 * Requer `pnpm dev` rodando e o banco migrado com seed.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

// O Playwright carrega os specs como CommonJS, entao usamos __dirname
// em vez de import.meta.url.
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'leads.csv');

const EMAIL = process.env.SEED_USER_EMAIL ?? 'admin@local';
const SENHA = process.env.SEED_USER_PASSWORD ?? 'prospector123';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('fluxo completo: importar CSV, ver prévia, confirmar e filtrar no CRM', async ({
  page,
}) => {
  // --- Importar ---
  await page.getByRole('link', { name: 'Importar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Importar leads' })).toBeVisible();

  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await expect(page.getByText('leads.csv')).toBeVisible();

  // --- Prévia: nada gravado ainda ---
  await page.getByRole('button', { name: 'Analisar arquivo' }).click();
  await expect(page.getByRole('heading', { name: 'Prévia da importação' })).toBeVisible();
  await expect(page.getByText('Nada foi gravado ainda')).toBeVisible();

  // A prévia precisa mostrar o motivo de cada linha ignorada.
  await expect(page.getByText('Duplicado no arquivo').first()).toBeVisible();
  await expect(page.getByText('Inválido').first()).toBeVisible();
  await expect(page.getByText(/mesmo telefone/).first()).toBeVisible();

  // --- Confirmar ---
  await page.getByRole('button', { name: /Importar \d+ lead/ }).click();
  await expect(page.getByRole('heading', { name: 'Importação concluída' })).toBeVisible();
  await expect(page.getByText(/lead\(s\) criado\(s\) no CRM/)).toBeVisible();

  // O relatório precisa listar os problemas, não escondê-los.
  await expect(page.getByText(/Problemas encontrados/)).toBeVisible();

  // --- CRM ---
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Leads', exact: true })).toBeVisible();
  await expect(page.getByText('Psicóloga Maria Silva')).toBeVisible();

  // --- Filtrar SEM SITE ---
  await page.getByRole('tab', { name: /Sem site/ }).click();
  await expect(page.getByText(/4 lead\(s\) nesta visão/)).toBeVisible();

  // Instagram e Facebook contam como sem site.
  await expect(page.getByText('Rede social').first()).toBeVisible();
  // Nenhum lead com site próprio pode aparecer nesta visão.
  await expect(page.getByText('Tem site')).toHaveCount(0);

  // --- Detalhe do lead ---
  await page.locator('tbody tr').first().click();
  const painel = page.getByRole('dialog', { name: 'Detalhe do lead' });
  await expect(painel).toBeVisible();
  await expect(painel.getByText('CONTATO')).toBeVisible();
  await expect(painel.getByText(/HISTÓRICO/)).toBeVisible();
  // O badge de status...
  await expect(painel.getByText('sem site próprio', { exact: true })).toBeVisible();
  // ...e o evento correspondente no histórico append-only.
  await expect(painel.getByText(/Classificado como SEM SITE PRÓPRIO/)).toBeVisible();
  await expect(painel.getByText(/Importado de leads\.csv/)).toBeVisible();

  // Esc fecha o painel (navegação por teclado).
  await page.keyboard.press('Escape');
  await expect(painel).not.toBeVisible();
});

test('busca por nome filtra a tabela', async ({ page }) => {
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await page.getByLabel('Buscar leads').fill('Maria');
  await page.getByLabel('Buscar leads').press('Enter');

  await expect(page.getByText('Psicóloga Maria Silva')).toBeVisible();
  await expect(page.getByText('Psicóloga Ana Costa')).toHaveCount(0);
});

test('o dashboard reflete os leads importados', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Sem site próprio')).toBeVisible();
  await expect(page.getByText('MODO SIMULAÇÃO — nada é enviado')).toBeVisible();
});

test('nenhuma mensagem pode ser enviada nesta fase', async ({ page }) => {
  // O indicador de dry-run precisa estar sempre visível.
  await expect(page.getByText('MODO SIMULAÇÃO — nada é enviado')).toBeVisible();
  await expect(page.getByText('WhatsApp desconectado')).toBeVisible();
});
