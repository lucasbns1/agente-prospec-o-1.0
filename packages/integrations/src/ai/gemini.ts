/**
 * O cliente do Gemini.
 *
 * ============================================================
 * O UNICO ARQUIVO DO SISTEMA QUE FALA COM O GOOGLE
 * ============================================================
 * Mesma disciplina do `provedor-whatsapp-web.ts`: a biblioteca externa
 * entra por UM arquivo, com import dinamico, e nao e reexportada do
 * indice do package. Assim nenhuma outra parte do codigo consegue
 * alcanca-la por engano — e trocar de SDK depois nao vira uma caca por
 * todo o repositorio.
 *
 * ============================================================
 * O QUE ESTE ARQUIVO NAO FAZ
 * ============================================================
 * Nao decide nada. Nao le banco. Nao valida a decisao (isso e a guarda,
 * em `validar-decisao.ts`). Ele monta a chamada, espera com prazo,
 * interpreta o texto e devolve — ou explica por que nao deu.
 *
 * ============================================================
 * A CHAVE
 * ============================================================
 * Entra por parametro, vinda do processo do worker. Nao e lida de
 * `process.env` aqui, nao e guardada em variavel de modulo, nao aparece
 * em nenhuma mensagem de erro e nao entra no prompt. O `redigir()` no
 * fim do arquivo existe para o caso de a propria SDK devolver a chave
 * dentro de um texto de erro — ja aconteceu com outras bibliotecas.
 */
import {
  interpretarRespostaIA,
  montarPrompt,
  INSTRUCAO_SISTEMA,
  INTENT_IA,
  ACAO_IA,
  type ContextoCadencia,
} from '@prospector/domain';
import type { AnalisadorDeCadencia, OrigemDaFalha, ResultadoAnalise } from './analisador.js';

export interface OpcoesGemini {
  apiKey: string;
  /** Ex: "gemini-3.6-flash". */
  modelo: string;
  /** Prazo total da chamada. Padrao 8000 ms. */
  timeoutMs?: number;
}

/**
 * O schema que a SDK impoe na resposta.
 *
 * ============================================================
 * POR QUE DECLARAR O SCHEMA E DEPOIS VALIDAR COM ZOD DE NOVO
 * ============================================================
 * Nao e desconfianca gratuita. O `responseSchema` faz o modelo produzir
 * a forma certa quase sempre, o que reduz muito o numero de quedas no
 * fallback. Mas "quase sempre" nao e garantia contratual: a API pode
 * truncar por limite de token, devolver vazio, ou mudar de comportamento
 * numa versao nova.
 *
 * O schema aqui e otimizacao. A garantia e o Zod, do outro lado.
 */
const SCHEMA_RESPOSTA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: [...INTENT_IA] },
    action: { type: 'string', enum: [...ACAO_IA] },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    needs_human: { type: 'boolean' },
    opt_out: { type: 'boolean' },
    reason: { type: 'string' },
    next_step: { type: 'integer', nullable: true },
    wait_seconds: { type: 'integer', nullable: true },
  },
  required: [
    'intent',
    'action',
    'confidence',
    'needs_human',
    'opt_out',
    'reason',
    'next_step',
    'wait_seconds',
  ],
} as const;

/**
 * Espera com prazo.
 *
 * A SDK aceita `abortSignal`, mas nao ha garantia de que toda falha de
 * rede respeite o sinal em tempo habil. O `Promise.race` e o prazo que
 * de fato vale: passou de 8 segundos, o orquestrador segue com o motor
 * deterministico. Uma cadencia nao pode parar porque um modelo remoto
 * ficou lento.
 */
async function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let id: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_, rejeitar) => {
        id = setTimeout(() => rejeitar(new Error(`Tempo esgotado (${ms}ms)`)), ms);
      }),
    ]);
  } finally {
    if (id) clearTimeout(id);
  }
}

export class AnalisadorGemini implements AnalisadorDeCadencia {
  readonly modelo: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  /** Instanciado uma vez, na primeira chamada. */
  private cliente: unknown = null;

  constructor(opcoes: OpcoesGemini) {
    this.modelo = opcoes.modelo;
    this.apiKey = opcoes.apiKey;
    this.timeoutMs = opcoes.timeoutMs ?? 8_000;
  }

  private async obterCliente(): Promise<{
    models: {
      generateContent: (p: unknown) => Promise<{ text?: string }>;
    };
  }> {
    if (this.cliente) return this.cliente as never;

    // Import dinamico: sem isto, importar qualquer coisa de
    // @prospector/integrations carregaria a SDK do Google junto — e a
    // API e o frontend nao tem nada que ver com ela.
    const { GoogleGenAI } = await import('@google/genai');
    this.cliente = new GoogleGenAI({ apiKey: this.apiKey });
    return this.cliente as never;
  }

  async analisar(contexto: ContextoCadencia): Promise<ResultadoAnalise> {
    const comeco = Date.now();

    try {
      const cliente = await this.obterCliente();

      const resposta = await comPrazo(
        cliente.models.generateContent({
          model: this.modelo,
          contents: montarPrompt(contexto),
          config: {
            systemInstruction: INSTRUCAO_SISTEMA,
            responseMimeType: 'application/json',
            responseSchema: SCHEMA_RESPOSTA,
            // Zero de proposito: a mesma conversa no mesmo estado deve
            // produzir a mesma decisao. Criatividade aqui e defeito —
            // isto decide se uma mensagem sai para um cliente seu.
            temperature: 0,
          },
        }),
        this.timeoutMs
      );

      const latenciaMs = Date.now() - comeco;
      const texto = resposta.text;

      if (!texto || texto.trim() === '') {
        return {
          ok: false,
          erro: 'O modelo devolveu resposta vazia',
          modelo: this.modelo,
          latenciaMs,
          origem: 'RESPOSTA',
        };
      }

      const r = interpretarRespostaIA(texto);
      if (!r.ok) {
        return {
          ok: false,
          erro: r.erro,
          modelo: this.modelo,
          latenciaMs,
          origem: 'RESPOSTA',
        };
      }

      return { ok: true, decisao: r.decisao, modelo: this.modelo, latenciaMs };
    } catch (err) {
      // Nao relanca: quem chama precisa poder cair no motor sem
      // try/catch. Falhar aqui e um evento previsto do sistema.
      const origem = classificar(err);
      return {
        ok: false,
        erro: redigir(err instanceof Error ? err.message : String(err), this.apiKey),
        modelo: this.modelo,
        latenciaMs: Date.now() - comeco,
        origem,
        // A pilha so acompanha bug nosso. Numa falha de API ela sempre
        // aponta para dentro da SDK e nao ajuda ninguem.
        ...(origem === 'CODIGO' && err instanceof Error && err.stack
          ? { pilha: redigir(err.stack, this.apiKey) }
          : {}),
      };
    }
  }
}

/**
 * "A API recusou" ou "quebrou aqui dentro"?
 *
 * ============================================================
 * A REGRA E POR EXCLUSAO, E DE PROPOSITO
 * ============================================================
 * `TypeError`, `ReferenceError` e `RangeError` sao, na pratica, sempre
 * bug de programa: um campo que faltou no objeto, uma funcao que nao
 * existe, um indice fora. Nenhum servidor remoto produz isso do outro
 * lado do fio.
 *
 * O resto — `ApiError` da SDK, erro de rede, o nosso "Tempo esgotado" —
 * cai em API. Errar para o lado de API e o erro barato: a pessoa confere
 * chave e internet e nao acha nada, e volta. Errar para o lado de CODIGO
 * mandaria alguem cacar um bug que nao existe.
 */
function classificar(err: unknown): OrigemDaFalha {
  if (err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError) {
    return 'CODIGO';
  }
  return 'API';
}

/**
 * Tira a chave de um texto, caso a SDK a tenha colocado la.
 *
 * A mensagem de erro vai para o log e para a coluna `erro` de
 * `ai_decisions`. Uma chave que vaza para um log fica no disco, no
 * backup e em qualquer print que alguem mande depois pedindo ajuda.
 */
function redigir(texto: string, chave: string): string {
  if (!chave) return texto;
  return texto.split(chave).join('***');
}
