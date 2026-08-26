/**
 * O relatorio de uma semana.
 *
 * ============================================================
 * O QUE ESTE ARQUIVO E, E O QUE ELE NAO E
 * ============================================================
 * Ele TRANSFORMA. Recebe as linhas cruas ja lidas do banco e devolve os
 * numeros da semana. Nao consulta, nao grava, nao sabe o que e Prisma.
 *
 * Isso importa porque a conta e cheia de decisoes discutiveis — o que
 * conta como "respondeu", em que dia entra uma mensagem enviada 23h59,
 * onde vai um lead que perguntou preco E depois sumiu — e cada uma delas
 * precisa poder ser lida e conferida sem subir banco.
 *
 * ============================================================
 * A SEMANA COMECA NO DOMINGO
 * ============================================================
 * De domingo 00:00 ate o domingo seguinte 00:00, sem incluir o segundo.
 * O retrato e congelado exatamente na virada.
 *
 * Domingo e nao segunda porque foi assim que o pedido veio ("salve
 * quando acabar cada semana no domingo 00:00"), e porque e a convencao de
 * calendario brasileira. Um mesmo envio nunca cai em duas semanas.
 */

import type {
  DiaDaSemana,
  FunilSemana,
  TravaEtapa,
  ResumoNicho,
  RelatorioSemana,
} from '@prospector/shared';

// O contrato de SAIDA mora em `shared` porque a tela precisa dele:
// `apps/web` depende de `shared` e nao de `domain`. As tres interfaces
// de ENTRADA ficam aqui — elas descrevem linhas cruas do banco, e o
// frontend nunca as ve.
export type {
  DiaDaSemana,
  FunilSemana,
  TravaEtapa,
  ResumoNicho,
  RelatorioSemana,
};

/** Uma mensagem que saiu, com o que ela precisa para ser contada. */
export interface EnvioDaSemana {
  leadId: string;
  /** Nicho da planilha de origem. `null` quando o lead nao veio de uma. */
  nicho: string | null;
  /** Ordem da etapa. E ela que diz "ate onde a conversa foi". */
  ordem: number;
  /** Nome da etapa, para o rotulo de "onde travou". */
  etapaNome: string | null;
  enviadaEm: Date;
}

/** Uma resposta do lead, com a leitura que o sistema fez dela. */
export interface RespostaDaSemana {
  leadId: string;
  categoria: string;
  /** 0 a 100. Abaixo do piso, o sistema nao entendeu. */
  confianca: number;
  recebidaEm: Date;
}

/** O estado atual do lead — para "fechou" e "desistiu". */
export interface EstadoDoLead {
  leadId: string;
  nicho: string | null;
  status: string;
}






/** Piso de confianca. O mesmo do resto do sistema. */
const CONFIANCA_MINIMA = 50;

/** Categorias que significam "nao". */
const NEGATIVAS = new Set(['NEGATIVO', 'OPT_OUT']);
/** Categorias que significam "quero saber mais". */
const INTERESSADAS = new Set(['POSITIVO', 'INTERESSE', 'AGENDAMENTO']);

const SEM_NICHO = 'Sem nicho';

/** O domingo 00:00 da semana em que `d` cai. */
export function inicioDaSemana(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // getDay(): 0 = domingo
  return x;
}

/** O domingo 00:00 seguinte — o fim exclusivo. */
export function fimDaSemana(inicio: Date): Date {
  const x = new Date(inicio);
  x.setDate(x.getDate() + 7);
  return x;
}

function funilVazio(): FunilSemana {
  return {
    abordados: 0,
    semResposta: 0,
    responderam: 0,
    negativos: 0,
    interessados: 0,
    perguntaramPreco: 0,
    receberamPrevia: 0,
    fecharam: 0,
    naoEntendidas: 0,
  };
}

/**
 * Monta o relatorio.
 *
 * ============================================================
 * AS DECISOES QUE VALE CONFERIR
 * ============================================================
 * "Abordado" e por LEAD, e nao por mensagem. Quem recebeu tres etapas na
 * mesma semana conta uma vez. Contar mensagens no lugar de pessoas faria
 * a taxa de resposta parecer tres vezes pior.
 *
 * "Respondeu" olha QUALQUER resposta do lead — inclusive depois do fim da
 * semana. O que se quer saber e "o que aconteceu com quem eu abordei
 * naquela semana", e a resposta que chegou na terca seguinte e sobre a
 * abordagem daquela semana.
 *
 * Um lead cai em VARIAS linhas do funil de proposito: quem perguntou
 * preco e depois fechou aparece nas duas. Elas nao sao fatias de uma
 * pizza, sao perguntas diferentes sobre o mesmo grupo. As unicas
 * mutuamente exclusivas sao `semResposta` e `responderam`.
 *
 * "Onde travou" e a MAIOR etapa que chegou no lead. Nao e onde ele
 * respondeu pela ultima vez: e ate onde a sua sequencia foi.
 */
export function montarRelatorioSemana(dados: {
  inicio: Date;
  envios: EnvioDaSemana[];
  /** Todas as respostas dos leads abordados, sem recorte de data. */
  respostas: RespostaDaSemana[];
  estados: EstadoDoLead[];
  /** Ordem da etapa que mostra a previa. `null` quando nao ha. */
  ordemDaPrevia: number | null;
}): RelatorioSemana {
  const inicio = inicioDaSemana(dados.inicio);
  const fim = fimDaSemana(inicio);

  // --- Os sete dias, inclusive os vazios ---
  //
  // Um dia sem envio precisa aparecer como zero. Omitir a linha faria o
  // grafico "pular" o dia e esconder justamente a rajada: quatro dias
  // parados e um com tudo tem a mesma soma de cinco dias regulares.
  const porDia: DiaDaSemana[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(inicio);
    d.setDate(d.getDate() + i);
    porDia.push({ dia: d.toISOString(), enviadas: 0 });
  }

  for (const e of dados.envios) {
    const indice = Math.floor(
      (e.enviadaEm.getTime() - inicio.getTime()) / 86_400_000
    );
    if (indice >= 0 && indice < 7) porDia[indice]!.enviadas += 1;
  }

  // --- Por lead: nicho, ate onde foi ---
  const nichoDoLead = new Map<string, string>();
  const maiorEtapa = new Map<string, EnvioDaSemana>();

  for (const e of dados.envios) {
    nichoDoLead.set(e.leadId, e.nicho ?? SEM_NICHO);
    const atual = maiorEtapa.get(e.leadId);
    if (!atual || e.ordem > atual.ordem) maiorEtapa.set(e.leadId, e);
  }

  const estadoDoLead = new Map(dados.estados.map((s) => [s.leadId, s]));

  // --- Por lead: o que ele disse ---
  const respostasDoLead = new Map<string, RespostaDaSemana[]>();
  for (const r of dados.respostas) {
    respostasDoLead.set(r.leadId, [...(respostasDoLead.get(r.leadId) ?? []), r]);
  }

  const contar = (leads: string[]): FunilSemana => {
    const f = funilVazio();
    f.abordados = leads.length;

    for (const leadId of leads) {
      const rs = respostasDoLead.get(leadId) ?? [];

      if (rs.length === 0) {
        f.semResposta += 1;
      } else {
        f.responderam += 1;

        const categorias = new Set(
          rs.filter((r) => r.confianca >= CONFIANCA_MINIMA).map((r) => r.categoria)
        );

        if ([...categorias].some((c) => NEGATIVAS.has(c))) f.negativos += 1;
        if ([...categorias].some((c) => INTERESSADAS.has(c))) f.interessados += 1;
        if (categorias.has('PRECO')) f.perguntaramPreco += 1;

        // Nenhuma resposta entendida = o dicionario ficou cego neste
        // lead. E o numero que justifica a releitura pela IA.
        if (categorias.size === 0) f.naoEntendidas += 1;
      }

      const ate = maiorEtapa.get(leadId);
      if (
        dados.ordemDaPrevia !== null &&
        ate !== undefined &&
        ate.ordem >= dados.ordemDaPrevia
      ) {
        f.receberamPrevia += 1;
      }

      if (estadoDoLead.get(leadId)?.status === 'CLIENTE') f.fecharam += 1;
    }

    return f;
  };

  const todos = [...maiorEtapa.keys()];

  // --- Por nicho ---
  const leadsPorNicho = new Map<string, string[]>();
  for (const leadId of todos) {
    const n = nichoDoLead.get(leadId) ?? SEM_NICHO;
    leadsPorNicho.set(n, [...(leadsPorNicho.get(n) ?? []), leadId]);
  }

  const enviadasPorNicho = new Map<string, number>();
  for (const e of dados.envios) {
    const n = e.nicho ?? SEM_NICHO;
    enviadasPorNicho.set(n, (enviadasPorNicho.get(n) ?? 0) + 1);
  }

  const porNicho: ResumoNicho[] = [...leadsPorNicho.entries()]
    .map(([nicho, leads]) => ({
      nicho,
      enviadas: enviadasPorNicho.get(nicho) ?? 0,
      funil: contar(leads),
    }))
    .sort((a, b) => b.enviadas - a.enviadas);

  // --- Onde travou ---
  const travas = new Map<number, TravaEtapa>();
  for (const leadId of todos) {
    const ate = maiorEtapa.get(leadId)!;
    const t = travas.get(ate.ordem) ?? {
      ordem: ate.ordem,
      rotulo: ate.etapaNome?.trim() || `Mensagem ${ate.ordem}`,
      leads: 0,
    };
    t.leads += 1;
    travas.set(ate.ordem, t);
  }

  return {
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    enviadas: dados.envios.length,
    porDia,
    funil: contar(todos),
    porNicho,
    travou: [...travas.values()].sort((a, b) => a.ordem - b.ordem),
  };
}
