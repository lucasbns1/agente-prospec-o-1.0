/**
 * O CONTRATO com o Gemini.
 *
 * ============================================================
 * POR QUE ISTO E TAO RIGIDO
 * ============================================================
 * Um modelo de linguagem devolve texto. Texto pode vir com markdown em
 * volta, com um campo a mais que ele achou util, com um valor de enum
 * que ele inventou porque parecia razoavel. Nada disso pode chegar perto
 * do banco.
 *
 * Este arquivo e a fronteira: do lado de fora e texto de um modelo, do
 * lado de dentro e um objeto tipado que o resto do sistema pode usar. O
 * `.strict()` do Zod recusa campo extra, e os enums recusam valor
 * inventado. Se algo nao passar por aqui, o sistema cai no motor
 * deterministico — nunca improvisa.
 *
 * NAO HA I/O AQUI. Entra string, sai objeto ou erro.
 */
import { z } from 'zod';

/**
 * Os intents que o modelo pode devolver.
 *
 * Sao 14, e propositalmente mais granulares que as 8 categorias do
 * `RespostaCategoria`. A conversao acontece em `mapear-intent.ts`.
 *
 * POR QUE NAO REUSAR AS 8 DIRETO: perguntar ao modelo em categorias
 * grossas joga fora informacao que ele tem. "Quero fechar, me manda o
 * contrato" e "quanto custa?" viram os dois POSITIVO/PRECO no motor,
 * mas sao momentos muito diferentes da conversa. Guardamos o intent
 * granular cru para auditoria e para o dia em que ele for util.
 */
export const INTENT_IA = [
  'INTERESSE',
  'ACEITE',
  'DUVIDA',
  'PRECO',
  'INFORMACAO',
  'NEGOCIACAO',
  'AGENDAMENTO',
  'OBJECAO',
  'NEGATIVO',
  'OPT_OUT',
  'DESCONHECIDO',
  'SPAM',
  'SUPORTE',
  'INTERVENCAO',
] as const;
export type IntentIA = (typeof INTENT_IA)[number];

/**
 * As acoes que o modelo pode PEDIR. Note o verbo: pedir, nao fazer.
 *
 * Nenhuma delas toca o WhatsApp. `SEND_STEP` significa "crie a ordem de
 * envio da etapa" — quem envia continua sendo o worker, atras das
 * quatro barreiras.
 */
export const ACAO_IA = [
  /** Criar a ordem de envio de uma etapa. NAO envia. */
  'SEND_STEP',
  /** Nao fazer nada agora; o relogio ainda nao chegou la. */
  'WAIT',
  /** Mover o lead de etapa sem enviar (raro; usado apos liberacao). */
  'ADVANCE_STEP',
  /** Congelar a sequencia. */
  'PAUSE',
  /** Congelar + criar tarefa + avisar o operador. */
  'CREATE_INTERVENTION',
  /** So avisar, sem congelar. */
  'NOTIFY_OPERATOR',
  /** Encerrar a sequencia para este lead. */
  'STOP_CAMPAIGN',
  /** Retomar depois de uma pausa. */
  'RESUME',
  /** Reenviar uma etapa que falhou de verdade. */
  'RETRY_SEND',
] as const;
export type AcaoIA = (typeof ACAO_IA)[number];

/**
 * O JSON que o modelo devolve, exatamente como vem do fio.
 *
 * Os nomes dos campos estao em ingles porque e o que o modelo produz
 * melhor e o que o `responseSchema` da SDK declara. A traducao para o
 * vocabulario do sistema acontece logo abaixo, em `DecisaoIA`.
 *
 * `.strict()` E ESSENCIAL: sem ele, o modelo pode devolver
 * `{"action":"WAIT","also_send":true}` e o campo extra passaria calado.
 */
export const esquemaRespostaIA = z
  .object({
    intent: z.enum(INTENT_IA),
    action: z.enum(ACAO_IA),
    /** 0 a 100. Inteiro: casa com o `confianca` do motor. */
    confidence: z.number().int().min(0).max(100),
    needs_human: z.boolean(),
    opt_out: z.boolean(),
    /** Justificativa curta. Vai para o painel, entao o operador le. */
    reason: z.string().min(1).max(500),
    /** Ordem da etapa alvo (1-based). null quando a acao nao tem alvo. */
    next_step: z.number().int().positive().nullable(),
    /** Quantos segundos esperar, quando a acao e WAIT. Teto de 7 dias. */
    wait_seconds: z.number().int().min(0).max(604_800).nullable(),
  })
  .strict();

export type RespostaIA = z.infer<typeof esquemaRespostaIA>;

/** A decisao ja traduzida para o vocabulario do sistema. */
export interface DecisaoIA {
  intent: IntentIA;
  acao: AcaoIA;
  /** Ordem da etapa alvo, 1-based. */
  etapaOrdem: number | null;
  confianca: number;
  precisaHumano: boolean;
  optOut: boolean;
  motivo: string;
  esperarSegundos: number | null;
}

export type ResultadoInterpretacao =
  | { ok: true; decisao: DecisaoIA }
  | { ok: false; erro: string };

/**
 * Tira a cerca de markdown que os modelos gostam de por em volta do
 * JSON, mesmo quando voce pede JSON puro.
 *
 * Nao e frescura: com `responseMimeType: application/json` isso quase
 * nunca acontece, mas "quase nunca" nao e "nunca", e a alternativa e
 * cair no fallback por causa de tres crases.
 */
function descascar(bruto: string): string {
  const texto = bruto.trim();
  if (!texto.startsWith('```')) return texto;

  const semAbertura = texto.replace(/^```(?:json)?\s*/i, '');
  const fim = semAbertura.lastIndexOf('```');
  return (fim === -1 ? semAbertura : semAbertura.slice(0, fim)).trim();
}

/**
 * Converte o texto cru do modelo em `DecisaoIA`, ou explica por que
 * nao deu.
 *
 * NUNCA lanca. Quem chama precisa poder cair no motor deterministico
 * sem try/catch, porque falhar aqui e um evento esperado, nao uma
 * excecao.
 */
export function interpretarRespostaIA(bruto: string): ResultadoInterpretacao {
  let json: unknown;
  try {
    json = JSON.parse(descascar(bruto));
  } catch {
    return { ok: false, erro: 'Resposta do modelo nao e JSON valido' };
  }

  const r = esquemaRespostaIA.safeParse(json);
  if (!r.success) {
    const problemas = r.error.issues
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('; ');
    return { ok: false, erro: `JSON fora do contrato — ${problemas}` };
  }

  return {
    ok: true,
    decisao: {
      intent: r.data.intent,
      acao: r.data.action,
      etapaOrdem: r.data.next_step,
      confianca: r.data.confidence,
      precisaHumano: r.data.needs_human,
      optOut: r.data.opt_out,
      motivo: r.data.reason,
      esperarSegundos: r.data.wait_seconds,
    },
  };
}
