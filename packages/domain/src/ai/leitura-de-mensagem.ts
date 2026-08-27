/**
 * A LEITURA de uma resposta pela IA.
 *
 * ============================================================
 * ISTO NAO E A ORQUESTRACAO DA CADENCIA
 * ============================================================
 * `decisao-ia.ts` pergunta ao modelo "o que EU faco agora?" — e a
 * resposta dele vira acao: enfileirar, pausar, encerrar. Por isso ela
 * passa por uma guarda inteira antes de tocar no banco.
 *
 * Isto aqui pergunta outra coisa: "o que esta pessoa DISSE?". A resposta
 * nao aciona nada — ela e gravada ao lado da mensagem e usada para
 * contar. O pior erro possivel e uma linha errada num relatorio, e nao
 * uma mensagem enviada para quem pediu para parar.
 *
 * Sao contratos separados de proposito. Juntar os dois faria uma
 * releitura de historico passar pela porta que autoriza envio.
 *
 * ============================================================
 * O QUE ELA EXTRAI, E POR QUE ESSES DOIS
 * ============================================================
 * O pedido pede duas coisas que o dicionario nao sabe dar:
 *
 *   "Pediram previa/site: [n]"
 *   "Objecao mais comum: [ex: 'ja aparecao no Google']"
 *
 * A primeira e um INTENT que nao existe no dicionario — nao ha lista de
 * termos para "me manda um exemplo", "quero ver como ficaria", "manda o
 * link". A segunda nao e classificacao nenhuma: e o TEXTO do que
 * impede, e so um modelo de linguagem extrai isso de uma frase solta.
 *
 * ============================================================
 * A OBJECAO PRECISA SE REPETIR PARA SERVIR
 * ============================================================
 * "Objecao mais comum" so existe se as frases agruparem. Se o modelo
 * devolver a frase do lead ao pe da letra, cada lead vira uma objecao
 * unica e a linha nunca sai de "1 vez".
 *
 * Por isso o prompt pede uma forma CURTA e CANONICA, e oferece uma lista
 * de rotulos conhecidos. O modelo pode criar um novo quando nada
 * encaixa — o que evita o outro erro, que e forcar toda objecao dentro
 * de uma lista fechada e perder a que voce ainda nao conhecia.
 *
 * FUNCAO PURA: monta prompt, interpreta resposta. A chamada de rede vive
 * em @prospector/integrations.
 */
import { z } from 'zod';

/**
 * Os rotulos que o prompt SUGERE.
 *
 * Nao e uma lista fechada: o modelo pode devolver outro. Ela existe para
 * puxar as frases parecidas para o mesmo balde — sem ela, "ja tenho um
 * site", "tenho site ja" e "possuo site" viram tres objecoes distintas.
 */
export const OBJECOES_CONHECIDAS = [
  'já tenho site',
  'já apareço no Google',
  'já tenho quem cuide disso',
  'achei caro',
  'sem tempo agora',
  'não é prioridade',
  'preciso pensar',
  'não confio / parece golpe',
  'uso só redes sociais',
] as const;

/** O que o modelo devolve sobre UMA mensagem. */
export const LeituraSchema = z.object({
  /**
   * true quando a pessoa pediu para ver alguma coisa: uma previa, um
   * exemplo, o site, "como ficaria".
   */
  pediu_previa: z.boolean(),
  /**
   * A objecao em forma curta, ou null quando nao ha objecao nenhuma.
   * Nem toda resposta traz uma — "quero sim" nao tem.
   */
  objecao: z.string().trim().min(1).max(60).nullable(),
  /** 0 a 100. Abaixo do piso a leitura e descartada por quem chamou. */
  confianca: z.number().int().min(0).max(100),
});

export type LeituraDaMensagem = {
  pediuPrevia: boolean;
  objecao: string | null;
  confianca: number;
};

export interface ResultadoLeitura {
  ok: boolean;
  leitura?: LeituraDaMensagem;
  erro?: string;
}

/**
 * Interpreta o JSON do modelo.
 *
 * Devolve `ok: false` em vez de lancar: uma leitura que falhou nao pode
 * derrubar o lote inteiro — sao dezenas de mensagens por dia, e uma
 * malformada nao vale perder as outras.
 */
export function interpretarLeitura(bruto: unknown): ResultadoLeitura {
  const r = LeituraSchema.safeParse(bruto);
  if (!r.success) {
    return { ok: false, erro: r.error.issues.map((i) => i.message).join('; ') };
  }

  return {
    ok: true,
    leitura: {
      pediuPrevia: r.data.pediu_previa,
      objecao: r.data.objecao,
      confianca: r.data.confianca,
    },
  };
}

/** Uma mensagem a ser lida, com o mínimo de contexto que a torna legível. */
export interface MensagemParaLer {
  /** O que a pessoa escreveu. */
  texto: string;
  /** O que o sistema tinha mandado antes — sem isso, "sim" não diz nada. */
  ultimaMensagemEnviada: string | null;
  /** Nome do estabelecimento, quando há. */
  empresa: string | null;
}

/**
 * Monta o prompt de leitura.
 *
 * Curto de proposito: sao dezenas de chamadas por dia, e cada palavra do
 * prompt e paga em todas elas. O contexto entra so na medida em que ele
 * muda a leitura — sem a mensagem anterior, "sim" e ilegivel; com o
 * historico inteiro, o custo triplicaria sem melhorar a extracao.
 */
export function montarPromptDeLeitura(m: MensagemParaLer): string {
  const linhas: string[] = [];

  linhas.push(
    'Você lê UMA resposta de WhatsApp recebida numa prospecção de criação de sites.'
  );
  linhas.push('Extraia dois sinais. Não decida nada, não sugira ação.');
  linhas.push('');

  if (m.empresa) linhas.push(`ESTABELECIMENTO: ${m.empresa}`);
  if (m.ultimaMensagemEnviada) {
    linhas.push(`O QUE FOI ENVIADO ANTES: ${m.ultimaMensagemEnviada.slice(0, 300)}`);
  }
  linhas.push(`RESPOSTA DA PESSOA: ${m.texto.slice(0, 500)}`);
  linhas.push('');

  linhas.push('1. pediu_previa: true se a pessoa pediu para VER algo —');
  linhas.push('   uma prévia, um exemplo, o site, "como ficaria", "manda aí".');
  linhas.push('   Aceitar a conversa não é pedir prévia: "pode falar" é false.');
  linhas.push('');

  linhas.push('2. objecao: o que IMPEDE, em forma curta, ou null se não houver.');
  linhas.push('   Use um destes rótulos quando encaixar:');
  for (const o of OBJECOES_CONHECIDAS) linhas.push(`     - ${o}`);
  linhas.push('   Se nenhum encaixar, escreva um rótulo curto seu (até 6 palavras),');
  linhas.push('   em minúsculas, descrevendo a objeção — e não a frase inteira dela.');
  linhas.push('   Uma resposta pode ter objeção E interesse ao mesmo tempo.');
  linhas.push('');

  linhas.push('3. confianca: 0 a 100, o quanto você tem certeza da leitura.');
  linhas.push('');
  linhas.push('Responda SOMENTE com JSON:');
  linhas.push('{"pediu_previa": boolean, "objecao": string|null, "confianca": number}');

  return linhas.join('\n');
}
