/**
 * Leitura e validacao das variaveis de ambiente.
 *
 * O processo NAO SOBE com configuracao invalida. Falhar no boot com uma
 * mensagem clara e muito melhor do que descobrir no meio de uma campanha
 * que o SESSION_SECRET estava vazio.
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL e obrigatoria. Copie o .env.example para .env.'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  API_PORT: z.coerce.number().int().default(3333),
  API_HOST: z.string().default('127.0.0.1'),

  SESSION_SECRET: z
    .string()
    .min(
      32,
      'SESSION_SECRET precisa ter no minimo 32 caracteres. ' +
        'Gere com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    ),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).default(30),

  WEB_ORIGIN: z.string().default('http://localhost:5173'),

  /**
   * Qual canal usar para CONECTAR.
   *
   * - `simulado`: nao abre navegador, nao conecta em lugar nenhum. E o
   *   padrao e o que roda em teste e em CI.
   * - `whatsapp-web`: conecta de verdade no WhatsApp Web, pede QR e
   *   RECEBE mensagens reais.
   *
   * Conectar e enviar sao coisas separadas: mesmo com
   * `whatsapp-web`, o envio continua bloqueado pela guarda de fase
   * (ver packages/integrations/src/whatsapp/guarda-envio.ts).
   */
  WHATSAPP_CANAL: z.enum(['simulado', 'whatsapp-web']).default('simulado'),

  // Qualquer valor diferente de "live" cai em dry-run. Ver factory.ts.
  WHATSAPP_MODE: z.string().default('dry-run'),
  WHATSAPP_SESSION_PATH: z.string().default('./data/whatsapp'),
  CHROME_PATH: z.string().optional(),

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function carregarEnv(fonte: NodeJS.ProcessEnv = process.env): Env {
  const resultado = envSchema.safeParse(fonte);

  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `\n[CONFIGURACAO INVALIDA]\n\n${problemas}\n\n` +
        'Verifique o arquivo .env na raiz do projeto.\n' +
        'Se ele nao existe: copie o .env.example.\n'
    );
  }

  return resultado.data;
}

export const modoDryRun = (env: Env): boolean =>
  env.WHATSAPP_MODE.trim().toLowerCase() !== 'live';
