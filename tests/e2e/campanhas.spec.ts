/**
 * E2E — o fluxo completo da Fase 4.
 *
 * importar leads -> criar campanha com filtros -> escrever a etapa
 *   -> ver a prévia -> ativar -> enfileirar -> conferir a fila
 *
 * ============================================================
 * ESTE TESTE NAO PODE ENVIAR MENSAGEM
 * ============================================================
 * Ele vai ate o fim do fluxo de proposito, incluindo o enfileiramento —
 * porque e exatamente ai que um bug enviaria de verdade. As asercoes
 * confirmam que tudo termina em dry-run.
 *
 * Requer `pnpm dev` rodando e o banco migrado com seed.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { limparLeadsECampanhas } from './helpers';

// Fixture propria, com telefones que nao colidem com os de leads.csv.
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'leads-campanha.csv');

const EMAIL = process.env.SEED_USER_EMAIL ?? 'admin@local';
const SENHA = process.env.SEED_USER_PASSWORD ?? 'prospector123';

/** Nome unico por execucao: a suite nao limpa campanhas antigas. */
const NOME_CAMPANHA = `E2E Psicólogos ${Date.now()}`;

test.beforeAll(limparLeadsECampanhas);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('fluxo completo: criar campanha, ver prévia e enfileirar em dry-run', async ({
  page,
}) => {
  // --- Garante que existem leads para a campanha pegar ---
  //
  // Se a fixture ja foi importada numa execucao anterior, a deduplicacao
  // deixa o botao desabilitado com "Importar 0 leads" — e esta tudo
  // certo, os leads que precisamos ja estao la. O teste nao pode
  // depender de um banco limpo.
  await page.getByRole('link', { name: 'Importar', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Analisar arquivo' }).click();
  await expect(
    page.getByRole('heading', { name: 'Prévia da importação' })
  ).toBeVisible();

  const botaoImportar = page.getByRole('button', { name: /Importar \d+ lead/ });
  if (await botaoImportar.isEnabled()) {
    await botaoImportar.click();
    await expect(
      page.getByRole('heading', { name: 'Importação concluída' })
    ).toBeVisible();
  }

  // --- Criar a campanha ---
  await page.getByRole('link', { name: 'Campanhas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Campanhas' })).toBeVisible();

  await page.getByRole('button', { name: 'Nova campanha' }).first().click();
  await expect(
    page.getByRole('heading', { name: 'Nova campanha' })
  ).toBeVisible();

  await page.getByLabel('Nome da campanha').fill(NOME_CAMPANHA);
  await page.getByLabel('Cidades').fill('Campinas');
  await page.getByRole('checkbox', { name: 'Só quem NÃO tem site próprio' }).check();

  // O contador ao vivo precisa reagir ao filtro — e o que impede o
  // usuario de criar uma campanha para um publico vazio sem perceber.
  await expect(page.getByText(/leads correspondem a estes filtros/)).toBeVisible();

  await page.getByRole('button', { name: 'Criar campanha' }).click();

  // --- Abrir a campanha recem-criada ---
  const cartao = page.locator('div').filter({ hasText: NOME_CAMPANHA });
  await expect(cartao.first()).toBeVisible();
  await cartao.getByRole('link', { name: 'Abrir' }).first().click();

  await expect(page.getByRole('heading', { name: NOME_CAMPANHA })).toBeVisible();
  // Toda campanha nasce rascunho e em dry-run.
  await expect(page.getByText('Rascunho')).toBeVisible();
  await expect(page.getByText('Dry-run').first()).toBeVisible();

  // --- Escrever a etapa ---
  await page
    .getByLabel('Texto da etapa 1')
    .fill('Olá, {{nome}}! Vi a {{empresa}} em {{cidade}}. Posso te mostrar uma ideia?');
  await page.getByRole('button', { name: 'Salvar etapas' }).click();
  await expect(page.getByText('Etapas salvas.')).toBeVisible();

  // --- Prévia: nao grava nada ---
  await page.getByRole('tab', { name: 'Prévia' }).click();
  await expect(page.getByText(/não grava nada/)).toBeVisible();
  await expect(page.getByText('Template da primeira etapa')).toBeVisible();

  // A previa mostra o texto ja renderizado, sem placeholder sobrando.
  const previa = page.getByText(/Vi a .+ em Campinas/).first();
  await expect(previa).toBeVisible();
  await expect(previa).not.toContainText('{{');

  // Enquanto a campanha for rascunho, enfileirar fica bloqueado.
  await expect(
    page.getByRole('button', { name: /Enfileirar/ })
  ).toBeDisabled();
  await expect(page.getByText('Ative a campanha para poder enfileirar.')).toBeVisible();

  // --- Ativar e enfileirar ---
  await page.getByRole('button', { name: 'Ativar' }).click();
  await expect(page.getByText('Ativa')).toBeVisible();

  await page.getByRole('tab', { name: 'Prévia' }).click();
  const botaoEnfileirar = page.getByRole('button', { name: /Enfileirar/ });
  await expect(botaoEnfileirar).toBeEnabled();
  await botaoEnfileirar.click();
  await expect(page.getByText(/criadas/)).toBeVisible();

  // --- Fila: tudo em dry-run, nada enviado de verdade ---
  await page.getByRole('tab', { name: 'Fila' }).click();
  await expect(page.getByText(/Agendada|Simulada/).first()).toBeVisible();
  await expect(page.getByText('Dry-run').first()).toBeVisible();

  // A barra superior precisa continuar avisando que nada sai.
  await expect(page.getByText(/MODO SIMULAÇÃO/)).toBeVisible();
});
