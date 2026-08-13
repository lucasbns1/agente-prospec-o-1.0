import { defineConfig, devices } from '@playwright/test';

/**
 * Testes E2E.
 *
 * Pressupoem API e frontend ja rodando (`pnpm dev`), Docker de pe e o
 * banco migrado com seed. Nao subimos os servidores daqui de proposito:
 * o `webServer` do Playwright reiniciaria os processos a cada execucao,
 * o que e lento e atrapalha quem esta desenvolvendo com o `pnpm dev`
 * aberto em outro terminal.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'pt-BR',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // O Chromium ja vem instalado no ambiente; nao baixar outro.
        launchOptions: process.env.CHROME_E2E_PATH
          ? { executablePath: process.env.CHROME_E2E_PATH }
          : {},
      },
    },
  ],
});
