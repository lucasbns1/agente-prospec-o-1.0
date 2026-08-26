/**
 * O resumo de UM dia.
 *
 * ============================================================
 * POR QUE O DIA MERECE TELA PROPRIA
 * ============================================================
 * A semana responde "a abordagem funciona?". O dia responde outra
 * pergunta, e ela e operacional: "o que saiu na terca, e o que voltou?".
 *
 * E a pergunta que voce faz quando um numero da semana parece errado —
 * uma rajada de 40 mensagens num dia so, uma quinta sem nada, tres
 * respostas concentradas numa tarde. Sem poder abrir o dia, esses
 * numeros ficam sendo mistério.
 *
 * ============================================================
 * O DIA E LOCAL, E NAO UTC
 * ============================================================
 * O corte e 00:00 a 23:59:59 no fuso da maquina — o mesmo criterio da
 * semana. Um envio das 22h em Sao Paulo pertence aquele dia, e nao ao
 * seguinte, ainda que em UTC ja seja o dia seguinte.
 *
 * Parece detalhe e nao e: com o corte em UTC, toda mensagem enviada
 * depois das 21h migraria para o dia seguinte no relatorio, e o grafico
 * da semana passaria a discordar do que voce viu acontecer.
 *
 * FUNCAO PURA. Recebe as linhas ja lidas, devolve o resumo.
 */

import type { ResumoDoDia, EnvioDoDia, RespostaDoDia } from '@prospector/shared';

// O contrato mora em `shared` porque a tela precisa dele.
export type { ResumoDoDia, EnvioDoDia, RespostaDoDia };

/** Piso de confianca. O mesmo do resto do sistema. */
const CONFIANCA_MINIMA = 50;

const SEM_NICHO = 'Sem nicho';

/** 00:00:00.000 local do dia em que `d` cai. */
export function inicioDoDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** 00:00:00.000 local do dia seguinte — o fim exclusivo. */
export function fimDoDia(inicio: Date): Date {
  const x = new Date(inicio);
  x.setDate(x.getDate() + 1);
  return x;
}

/**
 * Monta o resumo.
 *
 * ============================================================
 * AS DUAS LISTAS SAO INDEPENDENTES
 * ============================================================
 * "Sairam" e "voltaram" NAO se referem as mesmas pessoas. A resposta que
 * chegou hoje quase sempre e sobre uma mensagem de ontem ou da semana
 * passada — e e por isso que as duas aparecem lado a lado em vez de
 * viradas numa taxa.
 *
 * Uma "taxa de resposta do dia" (respostas de hoje / envios de hoje)
 * seria um numero sem significado nenhum: nada garante que as duas
 * pontas falem do mesmo grupo. Ela nao existe aqui de proposito.
 */
export function montarResumoDoDia(dados: {
  dia: Date;
  envios: EnvioDoDia[];
  respostas: RespostaDoDia[];
}): ResumoDoDia {
  const inicio = inicioDoDia(dados.dia);

  // --- Quantas mensagens, para quantas pessoas ---
  const leadsAbordados = new Set(dados.envios.map((e) => e.leadId));

  // --- Por nicho, so o volume ---
  const porNicho = new Map<string, number>();
  for (const e of dados.envios) {
    const n = e.nicho?.trim() || SEM_NICHO;
    porNicho.set(n, (porNicho.get(n) ?? 0) + 1);
  }

  // --- Por etapa, so o volume ---
  const porEtapa = new Map<number, { ordem: number; rotulo: string; enviadas: number }>();
  for (const e of dados.envios) {
    const atual = porEtapa.get(e.ordem) ?? {
      ordem: e.ordem,
      rotulo: e.etapaNome?.trim() || `Mensagem ${e.ordem}`,
      enviadas: 0,
    };
    atual.enviadas += 1;
    porEtapa.set(e.ordem, atual);
  }

  // --- As respostas ---
  //
  // Abaixo do piso a categoria nao vale: "ok" com 35 pode ser "ok,
  // manda" ou "ok, deixa pra la", e mostrar um rotulo que o sistema nao
  // sustenta e pior do que mostrar "não entendida".
  const respostas = dados.respostas.map((r) => ({
    ...r,
    categoria: r.confianca >= CONFIANCA_MINIMA ? r.categoria : null,
  }));

  return {
    dia: inicio.toISOString(),
    enviadas: dados.envios.length,
    pessoasAbordadas: leadsAbordados.size,
    respostas: respostas.length,
    porNicho: [...porNicho.entries()]
      .map(([nicho, enviadas]) => ({ nicho, enviadas }))
      .sort((a, b) => b.enviadas - a.enviadas || a.nicho.localeCompare(b.nicho)),
    porEtapa: [...porEtapa.values()].sort((a, b) => a.ordem - b.ordem),
    // Mais recentes por ultimo, nos dois: e a ordem em que o dia
    // aconteceu, e e assim que se le uma linha do tempo.
    envios: [...dados.envios].sort(
      (a, b) => a.quando.getTime() - b.quando.getTime()
    ),
    listaRespostas: respostas.sort(
      (a, b) => a.quando.getTime() - b.quando.getTime()
    ),
  };
}
