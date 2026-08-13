/**
 * Simula uma mensagem recebida, como se tivesse vindo do WhatsApp.
 *
 * ============================================================
 * PARA QUE SERVE
 * ============================================================
 * Exercitar o pipeline de recebimento inteiro — identificacao do lead,
 * classificacao, efeitos, CRM — sem celular pareado e sem QR. E o unico
 * jeito de testar o fluxo num ambiente headless, e continua util depois
 * para reproduzir um caso especifico sem pedir para alguem digitar no
 * WhatsApp.
 *
 * Uso:
 *   pnpm --filter @prospector/worker simular 5519999998888 "Pode mandar"
 *
 * O worker precisa estar rodando: quem processa e ele.
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Queue } from 'bullmq';
import { QUEUES } from '@prospector/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../../.env') });

const [telefone, texto, idFornecido] = process.argv.slice(2);

if (!telefone || !texto) {
  console.error(
    'Uso: pnpm --filter @prospector/worker simular <telefone-e164> "<texto>" [providerMessageId]\n' +
      'Ex.:  pnpm --filter @prospector/worker simular 5519999998888 "Pode mandar"'
  );
  process.exit(1);
}

// Repetir o mesmo id de proposito e como se testa a idempotencia.
const providerMessageId = idFornecido ?? `simulada-${Date.now()}`;

const fila = new Queue(QUEUES.PROCESS_INCOMING_MESSAGE, {
  connection: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  },
});

await fila.add(
  'processar',
  {
    mensagem: {
      providerMessageId,
      chatId: `${telefone}@c.us`,
      telefone,
      texto,
      nomeContato: null,
      recebidaEmISO: new Date().toISOString(),
      tipo: 'chat',
      temMidia: false,
    },
  },
  { jobId: `inbound-${providerMessageId}` }
);

console.log(`Enfileirada: ${providerMessageId}`);
console.log(`  de ${telefone}: "${texto}"`);
console.log('Veja o log do worker para o resultado.');

await fila.close();
