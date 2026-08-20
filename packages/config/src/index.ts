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

  // ---------------------------------------------------------------------------
  // GEMINI (Fase 9)
  // ---------------------------------------------------------------------------
  //
  // A CHAVE SO E LIDA NO PROCESSO DO WORKER. A API nao precisa dela, o
  // frontend nunca a ve, e ela nao e gravada no banco nem em log.
  //
  // Todos os padroes sao os seguros: com o .env de antes da Fase 9, a IA
  // fica desligada e o sistema se comporta exatamente como antes.

  /** Vazio = IA desligada, sem erro. Rodar sem ela e um modo suportado. */
  GEMINI_API_KEY: z.string().optional(),

  /**
   * Liga a consulta ao modelo. Desligado por padrao: ninguem deve passar
   * a gastar chamadas de API por ter feito um `git pull`.
   */
  GEMINI_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v.trim().toLowerCase() === 'true'),

  /**
   * MODO SOMBRA. `true` = a IA analisa e recomenda, mas quem comanda a
   * cadencia continua sendo o motor deterministico.
   *
   * O padrao e `false`: ligar o Gemini significa dar o comando a ele.
   * Quem quiser observar antes de liberar poe `true` explicitamente e
   * acompanha a tabela `ai_decisions` — o modo sombra continua inteiro,
   * so deixou de ser o padrao.
   *
   * Isto so tem efeito com GEMINI_ENABLED=true. Sem chave, o valor daqui
   * e irrelevante e o motor deterministico conduz tudo.
   */
  AI_ANALYSIS_ONLY: z
    .string()
    .default('false')
    .transform((v) => v.trim().toLowerCase() === 'true'),

  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

  /** Passou disto, o motor deterministico assume. */
  GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(8_000),

  /** Teto de decisoes encadeadas numa execucao. Trava contra laco infinito. */
  GEMINI_MAX_STEPS: z.coerce.number().int().min(1).max(10).default(3),
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

/**
 * A IA esta de fato operante?
 *
 * Ligada E com chave. Ligar sem chave nao e erro de configuracao — e um
 * meio-caminho comum (alguem liga a flag antes de conseguir a chave), e
 * derrubar o worker por isso seria pior do que seguir sem IA.
 */
export const iaAtiva = (env: Env): boolean =>
  env.GEMINI_ENABLED && Boolean(env.GEMINI_API_KEY?.trim());
