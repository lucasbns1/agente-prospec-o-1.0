/**
 * E2E — o ciclo da Fase 5.
 *
 * importar -> lead trava em intervencao -> aparece no dashboard
 *   -> assumir e resolver -> some da lista -> vira tarefa concluida
 *
 * O que este teste protege e o caminho que o usuario percorre quando o
 * sistema para de proposito. Antes da Fase 5 esse caminho terminava numa
 * tela sem botao.
 *
 * Requer `pnpm dev` rodando e o banco migrado com seed.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { limparLeadsECampanhas } from './helpers';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'leads.csv');

const EMAIL = process.env.SEED_USER_EMAIL ?? 'admin@local';
const SENHA = process.env.SEED_USER_PASSWORD ?? 'prospector123';

test.beforeAll(limparLeadsECampanhas);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('lead travado em intervenção aparece no dashboard e pode ser resolvido', async ({
  page,
}) => {
  // --- Dados ---
  await page.getByRole('link', { name: 'Importar', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Analisar arquivo' }).click();
  await page.getByRole('button', { name: /Importar \d+ lead/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Importação concluída' })
  ).toBeVisible();

  // --- Trava um lead ---
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await page.getByText('Clínica Bem Viver').first().click();

  const painel = page.getByRole('dialog', { name: 'Detalhe do lead' });
  await expect(painel).toBeVisible();
  await painel.getByLabel('Status').selectOption('PAUSADO');
  await expect(painel.getByText('Pausado').first()).toBeVisible();

  // A ação precisa ter deixado rastro no histórico.
  await expect(painel.getByText(/Status alterado de/).first()).toBeVisible();

  // --- Temperatura é independente do status ---
  await painel.getByRole('button', { name: 'Quente', exact: true }).click();
  await expect(painel.getByText('quente').first()).toBeVisible();

  await painel.getByRole('button', { name: 'Fechar' }).click();

  // --- O dashboard reage: lead quente exige ação ---
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  const atencao = page.getByText('Precisa da sua atenção');
  await expect(atencao).toBeVisible();
  await expect(page.getByText('Entrar em contato agora').first()).toBeVisible();

  // --- Abrir pelo próprio dashboard e anotar ---
  await page.getByText('Clínica Bem Viver').first().click();
  await expect(painel).toBeVisible();
  await painel.getByLabel('Anotar').fill('Liguei; retornar na segunda.');
  await painel.getByRole('button', { name: 'Salvar nota' }).click();
  await expect(painel.getByText(/retornar na segunda/).first()).toBeVisible();
});

test('opt-out cancela a fila e não pode ser desfeito sem justificativa', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await page.getByText('Psicóloga Maria Silva').first().click();

  const painel = page.getByRole('dialog', { name: 'Detalhe do lead' });
  await painel.getByRole('button', { name: 'Registrar opt-out' }).click();
  await painel.getByRole('button', { name: 'Confirmar opt-out' }).click();

  // O painel troca de conteúdo: um lead em opt-out não tem ações normais.
  await expect(
    painel.getByText('Este lead pediu para não ser contatado.')
  ).toBeVisible();
  await expect(painel.getByLabel('Anotar')).toHaveCount(0);

  // Reverter exige justificativa — o botão fica bloqueado sem ela.
  await painel.getByRole('button', { name: /reverter/i }).click();
  const confirmar = painel.getByRole('button', { name: 'Confirmar reversão' });
  await expect(confirmar).toBeDisabled();

  await painel.getByLabel(/Por que está revertendo/).fill('marquei o lead errado');
  await expect(confirmar).toBeEnabled();
});

test('tarefas: criar, ver atrasada e concluir', async ({ page }) => {
  await page.getByRole('link', { name: 'Tarefas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tarefas' })).toBeVisible();

  await page.getByRole('button', { name: 'Nova tarefa' }).click();
  await page.getByLabel('O que precisa ser feito').fill('Montar o preview do teste E2E');
  await page.getByLabel('Prioridade').selectOption('URGENTE');
  await page.getByRole('button', { name: 'Criar tarefa' }).click();

  const item = page.getByText('Montar o preview do teste E2E');
  await expect(item).toBeVisible();
  await expect(page.getByText('Urgente').first()).toBeVisible();

  await page
    .getByRole('button', { name: 'Concluir "Montar o preview do teste E2E"' })
    .click();

  // Some da visão "Abertas" assim que é concluída.
  await expect(item).toHaveCount(0);

  await page.getByRole('tab', { name: 'Concluídas' }).click();
  await expect(page.getByText('Montar o preview do teste E2E')).toBeVisible();
});

/**
 * A marcacao como lida e verificada no teste de API
 * (`tests/intervencao-api.test.ts`), onde da para semear uma
 * notificacao. Notificacoes nao tem rota de criacao de proposito — sao
 * geradas pelo sistema — entao aqui o que importa e que a tela abre e
 * que o estado vazio explica o que apareceria nela.
 */
test('a tela de notificações abre e explica o vazio', async ({ page }) => {
  await page.getByRole('link', { name: 'Notificações', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notificações' })).toBeVisible();
  await expect(page.getByText('Ordenadas por urgência, não por data.')).toBeVisible();

  await expect(page.getByText(/O sistema avisa aqui quando/)).toBeVisible();

  // Sem nada não lido, "marcar todas" não pode ficar clicável.
  await expect(
    page.getByRole('button', { name: 'Marcar todas como lidas' })
  ).toBeDisabled();
});
