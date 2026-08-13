/**
 * E2E — o ciclo da Fase 6A.
 *
 * mensagem chega -> aparece na caixa de entrada -> classificacao visivel
 *   -> assumir conversa -> retomar automacao
 *
 * A mensagem e injetada direto na fila, como o script
 * `pnpm --filter @prospector/worker simular` faz: nao ha celular
 * pareado num ambiente de teste.
 *
 * Requer `pnpm dev` (com o worker) e o banco migrado com seed.
 */
import { test, expect } from '@playwright/test';
import { limparLeadsECampanhas, criarLeadDeTeste, simularRecebida } from './helpers';

const EMAIL = process.env.SEED_USER_EMAIL ?? 'admin@local';
const SENHA = process.env.SEED_USER_PASSWORD ?? 'prospector123';

/**
 * Um lead por teste.
 *
 * Os testes compartilham o banco e o pipeline muda o estado do lead:
 * uma resposta classificada pode deixa-lo aguardando intervencao, e o
 * teste seguinte encontraria a tela noutro estado. Um telefone proprio
 * por caso torna cada um independente da ordem de execucao.
 */
const TELEFONE = '5519991230001';
const TELEFONE_ASSUMIR = '5519991230002';
const TELEFONE_OPTOUT = '5519991230003';

/**
 * Sufixo unico por execucao.
 *
 * O `jobId` do BullMQ e derivado do providerMessageId, e jobs concluidos
 * ficam retidos por 24h. Um id fixo faria a SEGUNDA execucao da suite ser
 * descartada como duplicata — a deduplicacao funcionando corretamente,
 * mas contra o teste. Cada rodada usa ids proprios.
 */
const RUN = Date.now().toString(36);

test.beforeAll(async () => {
  await limparLeadsECampanhas();

  for (const [nome, telefone] of [
    ['Clínica E2E Conversas', TELEFONE],
    ['Clínica E2E Assumir', TELEFONE_ASSUMIR],
    ['Clínica E2E Optout', TELEFONE_OPTOUT],
  ] as const) {
    await criarLeadDeTeste({
      nomeCompleto: nome,
      empresa: nome,
      telefoneNormalizado: telefone,
      telefone: `(19) ${telefone.slice(4, 9)}-${telefone.slice(9)}`,
    });
  }
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('mensagem recebida aparece na conversa com a classificação', async ({
  page,
}) => {
  await simularRecebida(TELEFONE, 'Tenho interesse sim, pode mandar', `e2e-conv-1-${RUN}`);

  await page.getByRole('link', { name: 'Conversas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Conversas' })).toBeVisible();

  // A conversa aparece sozinha, sem F5.
  const item = page.getByText('Clínica E2E Conversas').first();
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.click();

  // A mensagem e a interpretação do sistema ficam lado a lado.
  await expect(page.getByText('Tenho interesse sim, pode mandar')).toBeVisible();
  await expect(page.getByText(/confiança \d\.\d\d/).first()).toBeVisible();
});

test('a automação para sozinha e retomar exige confirmação', async ({ page }) => {
  // Sem mensagem nao ha conversa na lista: a caixa de entrada mostra quem
  // falou, e este lead precisa ter falado.
  //
  // "oi, bom dia" nao casa com nenhuma categoria: vira DESCONHECIDO, e o
  // motor trava a conversa para intervencao. E o comportamento correto —
  // na duvida, nao responder — e por isso o lead ja chega aqui com a
  // automacao parada, sem precisar de ninguem clicar em "assumir".
  await simularRecebida(TELEFONE_ASSUMIR, 'oi, bom dia', `e2e-conv-assumir-${RUN}`);
  await page.goto('/conversas');
  await page.getByText('Clínica E2E Assumir').first().click();

  await expect(page.getByText('automação parada')).toBeVisible({ timeout: 15_000 });

  // --- Retomar exige confirmação, não é um clique só ---
  await page.getByRole('button', { name: 'Retomar automação' }).click();
  await expect(page.getByText('Retomar automação deste lead?')).toBeVisible();

  // O lead não está em campanha nenhuma: o sistema recusa em vez de
  // fingir que retomou algo.
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText(/não está em nenhuma campanha/)).toBeVisible();
});

test('opt-out recebido para tudo e a tela deixa isso claro', async ({ page }) => {
  await simularRecebida(
    TELEFONE_OPTOUT,
    'pare de mandar mensagem, remova meu contato',
    `e2e-conv-optout-${RUN}`
  );

  await page.goto('/conversas');
  await page.getByText('Clínica E2E Optout').first().click();

  await expect(page.getByText('opt-out').first()).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText('Lead pediu para não receber mais mensagens')
  ).toBeVisible();

  // Um lead em opt-out não pode oferecer o botão de retomar.
  await expect(page.getByRole('button', { name: 'Retomar automação' })).toHaveCount(0);
});

test('número desconhecido não some — fica visível para decisão', async ({
  page,
}) => {
  await simularRecebida('5511999998888', 'oi, quem é?', `e2e-desconhecido-${RUN}`);

  await page.goto('/conversas');
  const botao = page.getByRole('button', { name: /de número desconhecido/ });
  await expect(botao).toBeVisible({ timeout: 15_000 });

  await botao.click();
  await expect(page.getByText('oi, quem é?')).toBeVisible();
  await expect(page.getByText(/Nenhum lead com o telefone/)).toBeVisible();
});

test('a tela do canal mostra o estado e a trava desta fase', async ({ page }) => {
  await page.getByRole('link', { name: 'WhatsApp', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'WhatsApp' })).toBeVisible();

  // A trava da fase precisa estar dita na tela, não só no código.
  await expect(page.getByText('Envio real bloqueado nesta fase')).toBeVisible();
  await expect(page.getByText(/FASE_PERMITE_ENVIO_REAL/)).toBeVisible();

  // O estado vem do worker, não de um valor fixo.
  await expect(page.getByText('Provedor')).toBeVisible();
});
