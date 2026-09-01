/**
 * A ficha do dia, por nicho.
 *
 * ============================================================
 * O PEDIDO, LITERAL
 * ============================================================
 *   DIA: [data]  (o dia em que EU mandei)
 *   NICHO: [ex: estetica automotiva]
 *   Mandei: [n]
 *   Responderam: abordagem [n]
 *   Responderam: follow up 1 [n]
 *   Responderam: follow up 2 [n]
 *   Pediram previa/site: [n]
 *   Perguntaram preco: [n]
 *   Fecharam: [n]
 *   Objecao mais comum: [ex: "ja aparecao no Google"]
 *
 * ============================================================
 * O DIA E O DIA EM QUE VOCE MANDOU
 * ============================================================
 * O recorte e a TURMA de quem recebeu alguma coisa naquele dia. Tudo o
 * mais — respostas, previas, fechamentos — e sobre essas pessoas, em
 * qualquer data posterior.
 *
 * O outro recorte possivel seria "o que chegou naquele dia", e ele
 * responde uma pergunta diferente (e ja existe, no resumo do dia). Este
 * aqui responde "a leva que eu mandei na terca deu no que?" — que e o
 * que o pedido descreve ao dizer "o dia que mandei".
 *
 * ============================================================
 * A QUAL ETAPA A PESSOA RESPONDEU
 * ============================================================
 * Nao ha coluna dizendo "esta resposta e sobre a mensagem 2". A
 * atribuicao e por tempo: a resposta pertence a ULTIMA etapa que saiu
 * para aquele lead ANTES dela.
 *
 * E a unica leitura que sobrevive ao caso real. Uma pessoa que recebeu a
 * abordagem na segunda, o follow up na quarta, e respondeu na quinta,
 * esta respondendo ao follow up — nao a abordagem, ainda que a abordagem
 * tenha sido a primeira coisa que ela viu.
 *
 * Resposta que chegou antes de qualquer envio (a pessoa escreveu do
 * nada) nao e atribuida a etapa nenhuma, e conta so no total.
 *
 * FUNCAO PURA.
 */

import type {
  FichaDoDia,
  FichaDoNicho,
  PassouDaEtapa,
  RespostaPorEtapa,
} from '@prospector/shared';

export type { FichaDoDia, FichaDoNicho, PassouDaEtapa, RespostaPorEtapa };

/** Piso de confianca. O mesmo do resto do sistema. */
const CONFIANCA_MINIMA = 50;

const SEM_NICHO = 'Sem nicho';

// O rotulo do total e o MESMO da tabela por nicho do dashboard, e vem de
// la de proposito: duas telas escrevendo "Todos os nichos" por conta
// propria acabam divergindo numa delas.
import { ROTULO_TOTAL } from '../dashboard/por-nicho.js';

/** Categorias que significam "quero saber o preco". */
const PRECO = new Set(['PRECO']);

/**
 * Intents que significam "me mostra".
 *
 * `PREVIA` e um intent que so a IA produz — o dicionario nao tem termo
 * para isso, e por isso a linha "pediram previa" fica em zero enquanto o
 * Gemini estiver desligado. Melhor um zero honesto do que um numero
 * inventado de um sinonimo qualquer.
 */
const PEDIU_PREVIA = new Set(['PREVIA']);

/** Um envio, reduzido ao que a ficha precisa. */
export interface EnvioDaFicha {
  leadId: string;
  nicho: string | null;
  /** `null` quando a planilha nao informou. Nunca deduzir. */
  pais: string | null;
  ordem: number;
  etapaNome: string | null;
  quando: Date;
}

/** Uma resposta, reduzida ao que a ficha precisa. */
export interface RespostaDaFicha {
  leadId: string;
  /** Categoria do motor. */
  categoria: string | null;
  /** Intent granular da IA, quando ela rodou. */
  aiIntent: string | null;
  confianca: number;
  /**
   * A objecao que a IA extraiu, ja em forma curta e canonica
   * ("ja tenho site", "achei caro"). `null` quando nao ha, ou quando a
   * IA nao rodou naquela mensagem.
   */
  objecao: string | null;
  quando: Date;
}

/** O estado atual do lead — para "fecharam". */
export interface EstadoDaFicha {
  leadId: string;
  status: string;
}

/**
 * O pais do cartao, ou `null` quando ha mais de um.
 *
 * Afirmar "Brasil" num grupo que tem um portugues dentro e pior do que
 * nao afirmar nada: o numero da ficha passaria a descrever um recorte
 * que nao e o que a linha diz.
 */
function paisUnico(envios: EnvioDaFicha[]): string | null {
  const vistos = new Set<string>();
  for (const e of envios) {
    const p = e.pais?.trim();
    if (p) vistos.add(p);
  }
  return vistos.size === 1 ? [...vistos][0]! : null;
}

function rotuloDaEtapa(ordem: number, nome: string | null): string {
  const proprio = nome?.trim();
  if (proprio) return proprio;
  // O vocabulario do pedido: a 1 e a abordagem, as seguintes sao follow
  // ups numerados a partir de 1.
  return ordem === 1 ? 'Abordagem' : `Follow up ${ordem - 1}`;
}

function fichaVazia(nicho: string): FichaDoNicho {
  return {
    nicho,
    pais: null,
    mandei: 0,
    pessoas: 0,
    responderam: 0,
    responderamPorEtapa: [],
    passaramDaEtapa: [],
    pediramPrevia: 0,
    perguntaramPreco: 0,
    fecharam: 0,
    objecaoMaisComum: null,
    objecoes: [],
  };
}

function montarUmaFicha(p: {
  nicho: string;
  envios: EnvioDaFicha[];
  /** Só as respostas dos leads desta ficha. */
  respostas: RespostaDaFicha[];
  /** TODOS os envios daqueles leads, e não só os do dia — a atribuição
   *  por tempo precisa das etapas anteriores para funcionar. */
  historicoDeEnvios: EnvioDaFicha[];
  estados: Map<string, string>;
}): FichaDoNicho {
  const f = fichaVazia(p.nicho);
  f.mandei = p.envios.length;
  f.pais = paisUnico(p.envios);

  const leads = new Set(p.envios.map((e) => e.leadId));
  f.pessoas = leads.size;

  // --- O histórico de envios por lead, em ordem de tempo ---
  const porLead = new Map<string, EnvioDaFicha[]>();
  for (const e of p.historicoDeEnvios) {
    if (!leads.has(e.leadId)) continue;
    porLead.set(e.leadId, [...(porLead.get(e.leadId) ?? []), e]);
  }
  for (const lista of porLead.values()) {
    lista.sort((a, b) => a.quando.getTime() - b.quando.getTime());
  }

  // --- Por etapa: quem respondeu a ela ---
  //
  // Por LEAD e não por resposta: alguém que mandou três mensagens
  // seguidas respondendo ao follow up 1 é uma pessoa, e não três.
  const respondeuEtapa = new Map<number, { rotulo: string; leads: Set<string> }>();
  const respondeuAlguma = new Set<string>();
  const pediuPrevia = new Set<string>();
  const perguntouPreco = new Set<string>();
  const objecoes = new Map<string, number>();

  for (const r of p.respostas) {
    if (!leads.has(r.leadId)) continue;
    respondeuAlguma.add(r.leadId);

    // A última etapa que saiu ANTES desta resposta.
    const historico = porLead.get(r.leadId) ?? [];
    let alvo: EnvioDaFicha | null = null;
    for (const e of historico) {
      if (e.quando.getTime() <= r.quando.getTime()) alvo = e;
      else break;
    }

    if (alvo) {
      const atual = respondeuEtapa.get(alvo.ordem) ?? {
        rotulo: rotuloDaEtapa(alvo.ordem, alvo.etapaNome),
        leads: new Set<string>(),
      };
      atual.leads.add(r.leadId);
      respondeuEtapa.set(alvo.ordem, atual);
    }

    // Abaixo do piso a leitura não vale — nem para o motor, nem para a
    // IA. Contar um "ok" de confiança 30 como pedido de prévia encheria
    // a ficha de intenções que ninguém declarou.
    if (r.confianca >= CONFIANCA_MINIMA) {
      if (r.categoria && PRECO.has(r.categoria)) perguntouPreco.add(r.leadId);
      if (r.aiIntent && PEDIU_PREVIA.has(r.aiIntent)) pediuPrevia.add(r.leadId);
    }

    // A objeção não passa pelo piso de confiança: ela é um texto que a
    // IA extraiu, e não uma classificação em que ela apostou. Se ela
    // escreveu "já tenho site", esse é o conteúdo da mensagem.
    const objecao = r.objecao?.trim();
    if (objecao) objecoes.set(objecao, (objecoes.get(objecao) ?? 0) + 1);
  }

  f.responderam = respondeuAlguma.size;
  f.responderamPorEtapa = [...respondeuEtapa.entries()]
    .map(([ordem, v]) => ({ ordem, rotulo: v.rotulo, leads: v.leads.size }))
    .sort((a, b) => a.ordem - b.ordem);

  // --- Quem PASSOU de cada etapa ---
  //
  // "Passou da 2" quer dizer "recebeu alguma etapa depois da 2". Nao e o
  // mesmo que ter respondido a 2: uma etapa que anda pelo relogio faz
  // gente passar sem responder, e uma que espera resposta faz gente
  // responder e nao passar, porque voce assumiu a conversa antes.
  //
  // A conta olha o historico INTEIRO daquele lead, e nao so o dia: o
  // recorte da ficha e a turma que recebeu algo naquele dia, e o que
  // aconteceu com ela depois e justamente o que se quer saber.
  const passou = new Map<number, { rotulo: string; leads: Set<string> }>();
  const rotulos = new Map<number, string>();
  for (const e of p.historicoDeEnvios) {
    if (!leads.has(e.leadId)) continue;
    if (!rotulos.has(e.ordem)) rotulos.set(e.ordem, rotuloDaEtapa(e.ordem, e.etapaNome));
  }

  for (const [leadId, historico] of porLead) {
    const maior = historico.reduce((m, e) => Math.max(m, e.ordem), 0);
    // Toda etapa ABAIXO da maior que ele recebeu foi ultrapassada.
    for (const ordem of rotulos.keys()) {
      if (ordem >= maior) continue;
      const atual = passou.get(ordem) ?? {
        rotulo: rotulos.get(ordem)!,
        leads: new Set<string>(),
      };
      atual.leads.add(leadId);
      passou.set(ordem, atual);
    }
  }

  f.passaramDaEtapa = [...passou.entries()]
    .map(([ordem, v]) => ({ ordem, rotulo: v.rotulo, leads: v.leads.size }))
    .sort((a, b) => a.ordem - b.ordem);

  f.pediramPrevia = pediuPrevia.size;
  f.perguntaramPreco = perguntouPreco.size;

  for (const leadId of leads) {
    if (p.estados.get(leadId) === 'CLIENTE') f.fecharam += 1;
  }

  f.objecoes = [...objecoes.entries()]
    .map(([texto, vezes]) => ({ texto, vezes }))
    // Empate no número: ordem alfabética, para a tela não dançar entre
    // recargas.
    .sort((a, b) => b.vezes - a.vezes || a.texto.localeCompare(b.texto));
  f.objecaoMaisComum = f.objecoes[0] ?? null;

  return f;
}

/**
 * Monta a ficha do dia, com um cartao por nicho e o total.
 *
 * Como na tabela por nicho do dashboard, o TOTAL e calculado sobre todos
 * os leads de uma vez, e nao somando os cartoes. As duas contas batem
 * enquanto cada lead pertence a um nicho so — e e a divergencia, se
 * aparecer, que denuncia uma suposicao quebrada.
 */
export function montarFichaDoDia(dados: {
  dia: Date;
  /** O que saiu NAQUELE dia. Define a turma. */
  envios: EnvioDaFicha[];
  /** Todos os envios daqueles leads, em qualquer data. */
  historicoDeEnvios: EnvioDaFicha[];
  /** Todas as respostas daqueles leads, em qualquer data. */
  respostas: RespostaDaFicha[];
  estados: EstadoDaFicha[];
}): FichaDoDia {
  const dia = new Date(dados.dia);
  dia.setHours(0, 0, 0, 0);

  const estados = new Map(dados.estados.map((e) => [e.leadId, e.status]));

  // --- Agrupa os envios do dia por nicho ---
  const porNicho = new Map<string, EnvioDaFicha[]>();
  for (const e of dados.envios) {
    const chave = e.nicho?.trim() || SEM_NICHO;
    porNicho.set(chave, [...(porNicho.get(chave) ?? []), e]);
  }

  const nichos = [...porNicho.entries()]
    .map(([nicho, envios]) =>
      montarUmaFicha({
        nicho,
        envios,
        respostas: dados.respostas,
        historicoDeEnvios: dados.historicoDeEnvios,
        estados,
      })
    )
    .sort((a, b) => b.mandei - a.mandei || a.nicho.localeCompare(b.nicho));

  return {
    dia: dia.toISOString(),
    total: montarUmaFicha({
      nicho: ROTULO_TOTAL,
      envios: dados.envios,
      respostas: dados.respostas,
      historicoDeEnvios: dados.historicoDeEnvios,
      estados,
    }),
    nichos,
  };
}
