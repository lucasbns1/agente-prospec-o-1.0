/**
 * A porta de entrada do analisador.
 *
 * ============================================================
 * MESMO PADRAO DO `criarWhatsAppAdapter`
 * ============================================================
 * `gemini.ts` e o unico arquivo que importa a SDK do Google, e ele nao e
 * exportado do indice do package. Quem precisa de um analisador chama
 * esta factory, que faz o import dinamico la dentro.
 *
 * O ganho e concreto: com a IA desligada — o padrao — a SDK do Google
 * nunca e carregada. Nada de puxar megabytes de dependencia e abrir
 * conexao para um recurso que o usuario nao ligou.
 */
import type { AnalisadorDeCadencia } from './analisador.js';

export interface ConfiguracaoIA {
  GEMINI_ENABLED?: boolean;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_TIMEOUT_MS?: number;
}

/**
 * Devolve o analisador, ou null quando a IA esta desligada.
 *
 * null NAO e erro: rodar sem IA e um modo suportado e e o padrao. Ligar
 * a flag sem ter a chave tambem devolve null, porque e um meio-caminho
 * comum e derrubar o worker por isso seria pior do que seguir sem ela.
 */
export async function criarAnalisador(
  cfg: ConfiguracaoIA
): Promise<AnalisadorDeCadencia | null> {
  if (!cfg.GEMINI_ENABLED) return null;
  if (!cfg.GEMINI_API_KEY || cfg.GEMINI_API_KEY.trim() === '') return null;

  const { AnalisadorGemini } = await import('./gemini.js');
  return new AnalisadorGemini({
    apiKey: cfg.GEMINI_API_KEY,
    modelo: cfg.GEMINI_MODEL ?? 'gemini-3.6-flash',
    timeoutMs: cfg.GEMINI_TIMEOUT_MS,
  });
}
