/**
 * O relatório semanal.
 *
 * ============================================================
 * AS DECISÕES QUE ESTES TESTES TRAVAM
 * ============================================================
 * A conta é cheia de escolhas discutíveis, e cada uma muda o número que
 * você vai olhar para decidir o que fazer na semana seguinte:
 *
 *   - "abordado" é por LEAD, não por mensagem;
 *   - "respondeu" conta respostas de qualquer data, não só da semana;
 *   - as linhas do funil se sobrepõem de propósito;
 *   - "onde travou" é a maior etapa que chegou, não a última resposta;
 *   - resposta com confiança baixa não vira categoria nenhuma.
 */
import { describe, expect, it } from 'vitest';
import {
  montarRelatorioSemana,
  inicioDaSemana,
  fimDaSemana,
  type EnvioDaSemana,
  type RespostaDaSemana,
} from '../packages/domain/src/index.js';

/** Domingo, 4 de janeiro de 2026, 00:00 local. */
const DOMINGO = new Date(2026, 0, 4);

const envio = (
  leadId: string,
  ordem: number,
  diaDaSemana = 0,
  nicho: string | null = 'Estética automotiva'
): EnvioDaSemana => {
  const d = new Date(DOMINGO);
  d.setDate(d.getDate() + diaDaSemana);
  d.setHours(10, 0, 0, 0);
  return { leadId, nicho, ordem, etapaNome: null, enviadaEm: d };
};

const resp = (
  leadId: string,
  categoria: string,
  confianca = 90
): RespostaDaSemana => ({
  leadId,
  categoria,
  confianca,
  recebidaEm: new Date(DOMINGO),
});

const montar = (p: {
  envios: EnvioDaSemana[];
  respostas?: RespostaDaSemana[];
  estados?: { leadId: string; nicho: string | null; status: string }[];
  ordemDaPrevia?: number | null;
}) =>
  montarRelatorioSemana({
    inicio: DOMINGO,
    envios: p.envios,
    respostas: p.respostas ?? [],
    estados: p.estados ?? [],
    // `??` cairia no 3 também quando `null` é passado de propósito — e
    // `null` ("não há etapa de prévia") é justamente um dos casos.
    ordemDaPrevia: 'ordemDaPrevia' in p ? (p.ordemDaPrevia ?? null) : 3,
  });

describe('a semana começa no domingo', () => {
  it('qualquer dia cai no domingo daquela semana', () => {
    const quarta = new Date(2026, 0, 7);
    expect(inicioDaSemana(quarta).getTime()).toBe(DOMINGO.getTime());
  });

  it('o próprio domingo é o início dele mesmo', () => {
    expect(inicioDaSemana(DOMINGO).getTime()).toBe(DOMINGO.getTime());
  });

  it('o fim é o domingo seguinte, e ele NÃO entra', () => {
    const fim = fimDaSemana(DOMINGO);
    expect(fim.getDate()).toBe(11);
    // O domingo seguinte pertence à próxima semana: um envio nunca cai
    // em duas.
    expect(inicioDaSemana(fim).getTime()).toBe(fim.getTime());
  });
});

describe('volume', () => {
  it('os sete dias aparecem, inclusive os vazios', () => {
    // Omitir o dia vazio esconderia a rajada: quatro dias parados e um
    // com tudo tem a mesma soma de cinco dias regulares.
    const r = montar({ envios: [envio('a', 1, 0), envio('b', 1, 3)] });

    expect(r.porDia).toHaveLength(7);
    expect(r.porDia[0]!.enviadas).toBe(1);
    expect(r.porDia[1]!.enviadas).toBe(0);
    expect(r.porDia[3]!.enviadas).toBe(1);
    expect(r.enviadas).toBe(2);
  });

  it('o mesmo lead em três etapas conta 3 envios e 1 abordado', () => {
    // Contar mensagens no lugar de pessoas faria a taxa de resposta
    // parecer três vezes pior do que é.
    const r = montar({
      envios: [envio('a', 1, 0), envio('a', 2, 1), envio('a', 3, 2)],
    });

    expect(r.enviadas).toBe(3);
    expect(r.funil.abordados).toBe(1);
  });
});

describe('o funil', () => {
  it('sem resposta e respondeu são mutuamente exclusivos e somam o total', () => {
    const r = montar({
      envios: [envio('a', 1), envio('b', 1), envio('c', 1)],
      respostas: [resp('a', 'POSITIVO')],
    });

    expect(r.funil.abordados).toBe(3);
    expect(r.funil.semResposta).toBe(2);
    expect(r.funil.responderam).toBe(1);
    expect(r.funil.semResposta + r.funil.responderam).toBe(r.funil.abordados);
  });

  it('as demais linhas SE SOBREPÕEM de propósito', () => {
    // Quem perguntou preço e depois fechou aparece nas duas. Não são
    // fatias de uma pizza: são perguntas diferentes sobre o mesmo grupo.
    const r = montar({
      envios: [envio('a', 1)],
      respostas: [resp('a', 'PRECO'), resp('a', 'POSITIVO')],
      estados: [{ leadId: 'a', nicho: null, status: 'CLIENTE' }],
    });

    expect(r.funil.perguntaramPreco).toBe(1);
    expect(r.funil.interessados).toBe(1);
    expect(r.funil.fecharam).toBe(1);
    expect(r.funil.responderam).toBe(1);
  });

  it('negativo e opt-out contam como "não"', () => {
    const r = montar({
      envios: [envio('a', 1), envio('b', 1)],
      respostas: [resp('a', 'NEGATIVO'), resp('b', 'OPT_OUT')],
    });
    expect(r.funil.negativos).toBe(2);
  });

  it('resposta com confiança baixa não vira categoria nenhuma', () => {
    // "ok" com 35 pode ser "ok, manda" ou "ok, deixa pra lá". Contá-la
    // como interesse inflaria o funil com uma leitura que o sistema não
    // fez de verdade.
    const r = montar({
      envios: [envio('a', 1)],
      respostas: [resp('a', 'POSITIVO', 35)],
    });

    expect(r.funil.responderam).toBe(1);
    expect(r.funil.interessados).toBe(0);
    // E entra no número que justifica a releitura pela IA.
    expect(r.funil.naoEntendidas).toBe(1);
  });

  it('responder DEPOIS da semana ainda conta', () => {
    // A pergunta é "o que aconteceu com quem eu abordei naquela semana".
    // A resposta que chegou na terça seguinte é sobre aquela abordagem.
    const depois = new Date(2026, 0, 20);
    const r = montar({
      envios: [envio('a', 1)],
      respostas: [{ ...resp('a', 'POSITIVO'), recebidaEm: depois }],
    });

    expect(r.funil.responderam).toBe(1);
    expect(r.funil.semResposta).toBe(0);
  });

  it('"recebeu a prévia" é ter chegado na etapa dela', () => {
    const r = montar({
      envios: [envio('a', 2), envio('b', 3)],
      ordemDaPrevia: 3,
    });

    expect(r.funil.receberamPrevia).toBe(1);
  });

  it('sem etapa de prévia configurada, ninguém recebeu', () => {
    const r = montar({ envios: [envio('a', 5)], ordemDaPrevia: null });
    expect(r.funil.receberamPrevia).toBe(0);
  });
});

describe('por nicho', () => {
  it('separa os números e ordena pelo maior volume', () => {
    const r = montar({
      envios: [
        envio('a', 1, 0, 'Beleza'),
        envio('b', 1, 0, 'Estética automotiva'),
        envio('c', 1, 0, 'Estética automotiva'),
      ],
      respostas: [resp('b', 'POSITIVO')],
    });

    expect(r.porNicho[0]!.nicho).toBe('Estética automotiva');
    expect(r.porNicho[0]!.enviadas).toBe(2);
    expect(r.porNicho[0]!.funil.responderam).toBe(1);
    expect(r.porNicho[1]!.nicho).toBe('Beleza');
    expect(r.porNicho[1]!.funil.responderam).toBe(0);
  });

  it('lead sem nicho não some — vai para "Sem nicho"', () => {
    const r = montar({ envios: [envio('a', 1, 0, null)] });
    expect(r.porNicho.map((n) => n.nicho)).toContain('Sem nicho');
  });

  it('a soma dos nichos bate com o total', () => {
    const r = montar({
      envios: [
        envio('a', 1, 0, 'Beleza'),
        envio('b', 1, 0, 'Psicólogo'),
        envio('c', 1, 0, null),
      ],
    });

    const soma = r.porNicho.reduce((t, n) => t + n.enviadas, 0);
    expect(soma).toBe(r.enviadas);
  });
});

describe('onde travou', () => {
  it('cada lead entra na MAIOR etapa que chegou nele', () => {
    // Não é onde ele respondeu pela última vez: é até onde a sua
    // sequência foi. Contá-lo em toda etapa que recebeu diria que todo
    // mundo travou na 1.
    const r = montar({
      envios: [envio('a', 1), envio('a', 2), envio('b', 1)],
    });

    expect(r.travou).toEqual([
      { ordem: 1, rotulo: 'Mensagem 1', leads: 1 },
      { ordem: 2, rotulo: 'Mensagem 2', leads: 1 },
    ]);
  });

  it('usa o nome da etapa quando ela tem um', () => {
    const r = montar({
      envios: [{ ...envio('a', 2), etapaNome: 'Proposta' }],
    });
    expect(r.travou[0]!.rotulo).toBe('Proposta');
  });

  it('a soma dos travados é o total de abordados', () => {
    const r = montar({
      envios: [envio('a', 1), envio('a', 3), envio('b', 2), envio('c', 1)],
    });

    const soma = r.travou.reduce((t, e) => t + e.leads, 0);
    expect(soma).toBe(r.funil.abordados);
  });
});

describe('semana vazia', () => {
  it('não quebra e devolve tudo zerado', () => {
    const r = montar({ envios: [] });

    expect(r.enviadas).toBe(0);
    expect(r.porDia).toHaveLength(7);
    expect(r.funil.abordados).toBe(0);
    expect(r.porNicho).toEqual([]);
    expect(r.travou).toEqual([]);
  });
});
