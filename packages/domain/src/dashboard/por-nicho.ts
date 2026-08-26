/**
 * A prospeccao separada por nicho, mais o total de tudo.
 *
 * ============================================================
 * O PEDIDO
 * ============================================================
 * "Quero que tenha um total — todos os nichos mandados — e as
 * informacoes de quantos mandaram e etc de cada nicho tambem."
 *
 * O nicho existia no banco desde a importacao ("psicologos em
 * Campinas" vira uma CaptureSession que etiqueta cada lead do lote), e
 * nao aparecia em tela nenhuma. Todo numero do painel era a soma de
 * tudo, e a soma de tudo esconde exatamente a decisao que a semana
 * seguinte pede: qual lista vale continuar.
 *
 * Estetica automotiva com 40% de resposta e psicologo com 4% davam um
 * unico "22% de resposta" — um numero que nao descreve nenhum dos dois.
 *
 * ============================================================
 * O TOTAL NAO E UMA LINHA A MAIS
 * ============================================================
 * Ele e calculado sobre TODOS os leads de uma vez, e nao somando as
 * linhas por nicho. As duas contas dao o mesmo resultado enquanto cada
 * lead pertence a exatamente um nicho — e e justamente por isso que
 * calcular por fora e util: se um dia divergirem, e porque uma suposicao
 * quebrou, e o teste que compara as duas pega isso.
 *
 * ============================================================
 * FUNCAO PURA
 * ============================================================
 * Recebe as linhas ja lidas do banco. Sem I/O — as definicoes de
 * "abordado" e "respondeu" sao discutiveis, e precisam poder ser
 * conferidas sem subir banco.
 */

import type { ResumoDoNicho, ResumoPorNicho } from '@prospector/shared';

// O contrato mora em `shared` porque o frontend precisa dele:
// `apps/web` depende de `shared` e nao de `domain`.
export type { ResumoDoNicho, ResumoPorNicho };

/** O rotulo de quem entrou sem lote identificado. */
export const SEM_NICHO = 'Sem nicho';

/** Um lead, reduzido ao que a contagem precisa. */
export interface LeadDoNicho {
  leadId: string;
  /** `null` quando o lead nao veio de uma planilha etiquetada. */
  nicho: string | null;
  temperatura: string;
  status: string;
  optOut: boolean;
  /** Quantas mensagens REAIS sairam para ele. Zero = nunca abordado. */
  enviadas: number;
  /** true se ele respondeu qualquer coisa, uma vez que seja. */
  respondeu: boolean;
}

/** O rotulo do total. Fica aqui para a tela e o teste concordarem. */
export const ROTULO_TOTAL = 'Todos os nichos';

function contar(rotulo: string, leads: LeadDoNicho[]): ResumoDoNicho {
  let abordados = 0;
  let enviadas = 0;
  let responderam = 0;
  let quentes = 0;
  let clientes = 0;
  let optOuts = 0;

  for (const l of leads) {
    enviadas += l.enviadas;

    // "Abordado" e ter recebido mensagem, e nao estar numa campanha.
    // Um lead enfileirado que ainda nao teve nada enviado nao testou
    // nada, e conta-lo estragaria a taxa de resposta do nicho inteiro.
    if (l.enviadas > 0) {
      abordados += 1;
      // "Respondeu" so faz sentido sobre quem foi abordado. Alguem que
      // escreveu do nada, sem nunca ter recebido, nao e uma resposta a
      // uma abordagem que nao houve.
      if (l.respondeu) responderam += 1;
    }

    if (l.temperatura === 'QUENTE') quentes += 1;
    if (l.status === 'CLIENTE') clientes += 1;
    if (l.optOut) optOuts += 1;
  }

  return {
    nicho: rotulo,
    leads: leads.length,
    abordados,
    naFila: leads.length - abordados,
    enviadas,
    responderam,
    semResposta: abordados - responderam,
    taxaResposta:
      abordados === 0 ? null : Math.round((responderam / abordados) * 100),
    quentes,
    clientes,
    optOuts,
  };
}

/**
 * Monta o total e a quebra por nicho.
 *
 * A ordem dos nichos e por ENVIOS, do maior para o menor: a lista onde
 * voce mais gastou mensagem e a que mais merece uma decisao. Empate no
 * volume, ordem alfabetica, so para a tela nao dancar entre recargas.
 */
export function montarResumoPorNicho(leads: LeadDoNicho[]): ResumoPorNicho {
  const porNicho = new Map<string, LeadDoNicho[]>();

  for (const l of leads) {
    const chave = l.nicho?.trim() || SEM_NICHO;
    porNicho.set(chave, [...(porNicho.get(chave) ?? []), l]);
  }

  const nichos = [...porNicho.entries()]
    .map(([nicho, doNicho]) => contar(nicho, doNicho))
    .sort((a, b) => b.enviadas - a.enviadas || a.nicho.localeCompare(b.nicho));

  return { total: contar(ROTULO_TOTAL, leads), nichos };
}
