/**
 * A ultima resposta do lead libera a proxima mensagem?
 *
 * ============================================================
 * POR QUE ISTO PRECISOU EXISTIR
 * ============================================================
 * O fallback do orquestrador era grosso: se a IA nao respondia e a
 * proxima acao ENVIARIA alguma coisa, tudo virava intervencao. Seguro,
 * e caro — cada timeout do Gemini congelava um lead que o motor
 * deterministico saberia conduzir sozinho.
 *
 * O motor nao e chute. Ele classifica a resposta contra um dicionario
 * com centenas de termos e devolve uma confianca. E as regras de cada
 * etapa — POSITIVO -> AVANCAR, PRECO -> AGUARDAR_INTERVENCAO — sao as
 * que VOCE configurou na tela.
 *
 * Entao o fallback deixou de ignorar tudo isso. Ele passou a fazer a
 * pergunta certa: "o que o operador mandou fazer com uma resposta
 * desta?".
 *
 * ============================================================
 * O QUE CONTINUA SEM PASSAR
 * ============================================================
 * Tres coisas, e nenhuma delas e configuravel para menos:
 *
 *   1. Resposta que o motor NAO entendeu. Confianca abaixo do piso vira
 *      intervencao, qualquer que seja a regra. "ok" com 35 de confianca
 *      pode ser "ok, manda" ou "ok, deixa pra la" — e a diferenca entre
 *      as duas e uma mensagem enviada para quem nao queria.
 *
 *   2. OPT_OUT e NEGATIVO. Param sempre, mesmo sem regra configurada.
 *      Nao ha leitura de "nao quero" que autorize a proxima mensagem.
 *
 *   3. Categoria sem regra nenhuma. Sem instrucao, o sistema pergunta em
 *      vez de inventar.
 *
 * ============================================================
 * FUNCAO PURA
 * ============================================================
 * Sem I/O e sem relogio: recebe a resposta e as regras, devolve o
 * veredicto. E a decisao mais delicada do fallback, e ela precisa ser
 * testavel linha a linha.
 */

/**
 * Piso de confianca para o motor agir sozinho.
 *
 * Abaixo disto ele nao entendeu o suficiente. O mesmo numero que o
 * pipeline de recebimento ja usa para chamar o operador — manter os dois
 * alinhados evita o caso absurdo de o motor pedir intervencao numa ponta
 * e mandar seguir na outra, para a MESMA resposta.
 */
export const CONFIANCA_MINIMA_DO_MOTOR = 50;

/** Categorias que param a sequencia, com ou sem regra configurada. */
const CATEGORIAS_QUE_PARAM = new Set(['OPT_OUT', 'NEGATIVO']);

export type VeredictoResposta =
  | { permite: true }
  | { permite: false; acao: 'STOP_CAMPAIGN' | 'CREATE_INTERVENTION'; motivo: string };

export interface RespostaDoMotor {
  categoriaDoMotor: string;
  confiancaDoMotor: number;
}

export function respostaPermiteAvancar(
  resposta: RespostaDoMotor | undefined,
  regras: { categoria: string; acao: string }[]
): VeredictoResposta {
  // Sem resposta nenhuma, esta funcao nao tem opiniao: quem decide se a
  // sequencia anda e o relogio, mais acima.
  if (!resposta) return { permite: true };

  const categoria = resposta.categoriaDoMotor;

  // --- 1. Parar vence tudo ---
  if (CATEGORIAS_QUE_PARAM.has(categoria)) {
    return {
      permite: false,
      acao: 'STOP_CAMPAIGN',
      motivo: `O lead respondeu ${categoria}. A sequencia para aqui.`,
    };
  }

  // --- 2. O motor entendeu? ---
  if (resposta.confiancaDoMotor < CONFIANCA_MINIMA_DO_MOTOR) {
    return {
      permite: false,
      acao: 'CREATE_INTERVENTION',
      motivo:
        `O motor classificou a resposta como ${categoria} com apenas ` +
        `${resposta.confiancaDoMotor} de confianca (minimo ${CONFIANCA_MINIMA_DO_MOTOR}). ` +
        'Sem a IA para ler a frase inteira, a cadencia parou para voce decidir.',
    };
  }

  // --- 3. O que a regra da etapa manda fazer ---
  const regra = regras.find((r) => r.categoria === categoria);

  if (!regra) {
    return {
      permite: false,
      acao: 'CREATE_INTERVENTION',
      motivo:
        `Nao ha regra configurada para ${categoria} nesta etapa. ` +
        'Sem instrucao, o sistema prefere perguntar a inventar.',
    };
  }

  switch (regra.acao) {
    case 'AVANCAR':
    case 'IR_PARA_ETAPA':
      return { permite: true };

    case 'PARAR':
      return {
        permite: false,
        acao: 'STOP_CAMPAIGN',
        motivo: `A regra desta etapa manda PARAR quando a resposta e ${categoria}.`,
      };

    case 'AGUARDAR_INTERVENCAO':
      return {
        permite: false,
        acao: 'CREATE_INTERVENTION',
        motivo: `A regra desta etapa pede intervencao quando a resposta e ${categoria}.`,
      };

    // SNOOZE e NENHUMA nao mandam avancar. Tratar "adiar" como "pode
    // enviar" seria inverter a instrucao.
    default:
      return {
        permite: false,
        acao: 'CREATE_INTERVENTION',
        motivo:
          `A regra desta etapa para ${categoria} e ${regra.acao}, que nao ` +
          'autoriza a proxima mensagem.',
      };
  }
}
