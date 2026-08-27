/**
 * A ficha do dia, por nicho.
 *
 * ============================================================
 * O PEDIDO
 * ============================================================
 *   DIA / NICHO / Mandei / Responderam: abordagem / follow up 1 /
 *   follow up 2 / Pediram prévia / Perguntaram preço / Fecharam /
 *   Objeção mais comum.
 *
 * ============================================================
 * A DECISÃO MAIS DISCUTÍVEL ESTÁ AQUI
 * ============================================================
 * "A qual etapa a pessoa respondeu" não existe como coluna. A atribuição
 * é por tempo: a resposta pertence à ÚLTIMA etapa que saiu ANTES dela.
 *
 * A alternativa — atribuir sempre à etapa 1, "a primeira que ela viu" —
 * faria a linha "responderam: abordagem" comer todas as outras, e o
 * relatório deixaria de responder o que foi perguntado.
 */
import { describe, expect, it } from 'vitest';
import {
  montarFichaDoDia,
  type EnvioDaFicha,
  type RespostaDaFicha,
} from '../packages/domain/src/index.js';

const DIA = new Date(2026, 0, 7, 0, 0, 0);
const as = (h: number) => new Date(2026, 0, 7, h, 0, 0);
const depoisAs = (dias: number, h: number) => new Date(2026, 0, 7 + dias, h, 0, 0);

const envio = (
  leadId: string,
  ordem: number,
  quando: Date,
  nicho: string | null = 'Estética automotiva'
): EnvioDaFicha => ({ leadId, nicho, ordem, etapaNome: null, quando });

const resposta = (
  leadId: string,
  quando: Date,
  over: Partial<RespostaDaFicha> = {}
): RespostaDaFicha => ({
  leadId,
  categoria: null,
  aiIntent: null,
  confianca: 90,
  objecao: null,
  quando,
  ...over,
});

const montar = (p: {
  envios: EnvioDaFicha[];
  historico?: EnvioDaFicha[];
  respostas?: RespostaDaFicha[];
  estados?: { leadId: string; status: string }[];
}) =>
  montarFichaDoDia({
    dia: DIA,
    envios: p.envios,
    // Sem histórico próprio, o do dia serve — é o caso comum.
    historicoDeEnvios: p.historico ?? p.envios,
    respostas: p.respostas ?? [],
    estados: p.estados ?? [],
  });

describe('Mandei', () => {
  it('conta mensagens, e "pessoas" conta gente', () => {
    const r = montar({
      envios: [envio('a', 1, as(9)), envio('a', 2, as(15)), envio('b', 1, as(9))],
    });

    expect(r.total.mandei).toBe(3);
    expect(r.total.pessoas).toBe(2);
  });
});

describe('a qual etapa a pessoa respondeu', () => {
  it('é a última etapa que saiu ANTES da resposta', () => {
    // Recebeu a abordagem às 9h e o follow up às 15h; respondeu às 16h.
    // Está respondendo ao follow up, e não à abordagem.
    const r = montar({
      envios: [envio('a', 1, as(9)), envio('a', 2, as(15))],
      respostas: [resposta('a', as(16))],
    });

    expect(r.total.responderamPorEtapa).toEqual([
      { ordem: 2, rotulo: 'Follow up 1', leads: 1 },
    ]);
  });

  it('a etapa 1 se chama Abordagem; as outras, Follow up N', () => {
    // O vocabulário do pedido.
    const r = montar({
      envios: [envio('a', 1, as(9)), envio('b', 3, as(9))],
      respostas: [resposta('a', as(10)), resposta('b', as(10))],
    });

    expect(r.total.responderamPorEtapa.map((e) => e.rotulo)).toEqual([
      'Abordagem',
      'Follow up 2',
    ]);
  });

  it('o nome próprio da etapa vence o rótulo padrão', () => {
    const r = montar({
      envios: [{ ...envio('a', 2, as(9)), etapaNome: 'Proposta' }],
      respostas: [resposta('a', as(10))],
    });
    expect(r.total.responderamPorEtapa[0]!.rotulo).toBe('Proposta');
  });

  it('conta PESSOAS, e não mensagens', () => {
    // Três mensagens seguidas respondendo ao mesmo follow up é uma
    // pessoa.
    const r = montar({
      envios: [envio('a', 1, as(9))],
      respostas: [resposta('a', as(10)), resposta('a', as(11)), resposta('a', as(12))],
    });

    expect(r.total.responderamPorEtapa[0]!.leads).toBe(1);
    expect(r.total.responderam).toBe(1);
  });

  it('resposta anterior a qualquer envio não é atribuída a etapa nenhuma', () => {
    // A pessoa escreveu do nada. Ela respondeu — conta no total — mas
    // não respondeu a nenhuma etapa.
    const r = montar({
      envios: [envio('a', 1, as(15))],
      respostas: [resposta('a', as(9))],
    });

    expect(r.total.responderam).toBe(1);
    expect(r.total.responderamPorEtapa).toEqual([]);
  });

  it('a etapa pode ter saído num dia anterior', () => {
    // A turma é de quem recebeu HOJE; a etapa a que a pessoa respondeu
    // pode ser de ontem. Por isso o histórico entra separado.
    const ontem = new Date(2026, 0, 6, 10, 0, 0);
    const r = montar({
      envios: [envio('a', 2, as(9))],
      historico: [envio('a', 1, ontem), envio('a', 2, as(9))],
      respostas: [resposta('a', new Date(2026, 0, 6, 18, 0, 0))],
    });

    expect(r.total.responderamPorEtapa).toEqual([
      { ordem: 1, rotulo: 'Abordagem', leads: 1 },
    ]);
  });
});

describe('as linhas que dependem do que foi dito', () => {
  it('perguntaram preço vem da categoria do motor', () => {
    const r = montar({
      envios: [envio('a', 1, as(9))],
      respostas: [resposta('a', as(10), { categoria: 'PRECO' })],
    });
    expect(r.total.perguntaramPreco).toBe(1);
  });

  it('pediram prévia vem do intent da IA', () => {
    // O dicionário não tem termo para "me manda um exemplo". Este número
    // fica em zero enquanto o Gemini não ler.
    const r = montar({
      envios: [envio('a', 1, as(9))],
      respostas: [resposta('a', as(10), { aiIntent: 'PREVIA' })],
    });
    expect(r.total.pediramPrevia).toBe(1);
  });

  it('confiança baixa não vira nem preço nem prévia', () => {
    const r = montar({
      envios: [envio('a', 1, as(9)), envio('b', 1, as(9))],
      respostas: [
        resposta('a', as(10), { categoria: 'PRECO', confianca: 30 }),
        resposta('b', as(10), { aiIntent: 'PREVIA', confianca: 30 }),
      ],
    });

    expect(r.total.perguntaramPreco).toBe(0);
    expect(r.total.pediramPrevia).toBe(0);
    // Mas as duas continuam contando como resposta.
    expect(r.total.responderam).toBe(2);
  });

  it('fecharam vem do status atual do lead', () => {
    const r = montar({
      envios: [envio('a', 1, as(9)), envio('b', 1, as(9))],
      estados: [
        { leadId: 'a', status: 'CLIENTE' },
        { leadId: 'b', status: 'EM_CONVERSA' },
      ],
    });
    expect(r.total.fecharam).toBe(1);
  });
});

describe('a objeção mais comum', () => {
  it('é a mais repetida', () => {
    const r = montar({
      envios: [envio('a', 1, as(9)), envio('b', 1, as(9)), envio('c', 1, as(9))],
      respostas: [
        resposta('a', as(10), { objecao: 'já apareço no Google' }),
        resposta('b', as(10), { objecao: 'já apareço no Google' }),
        resposta('c', as(10), { objecao: 'achei caro' }),
      ],
    });

    expect(r.total.objecaoMaisComum).toEqual({
      texto: 'já apareço no Google',
      vezes: 2,
    });
    expect(r.total.objecoes).toHaveLength(2);
  });

  it('sem objeção nenhuma é null, e não uma string vazia', () => {
    const r = montar({
      envios: [envio('a', 1, as(9))],
      respostas: [resposta('a', as(10))],
    });
    expect(r.total.objecaoMaisComum).toBeNull();
  });

  it('NÃO passa pelo piso de confiança', () => {
    // A objeção é um texto que a IA extraiu, e não uma classificação em
    // que ela apostou. Se a pessoa escreveu "já tenho site", esse é o
    // conteúdo da mensagem.
    const r = montar({
      envios: [envio('a', 1, as(9))],
      respostas: [resposta('a', as(10), { objecao: 'já tenho site', confianca: 20 })],
    });
    expect(r.total.objecaoMaisComum?.texto).toBe('já tenho site');
  });
});

describe('por nicho', () => {
  it('separa os cartões e ordena pelo maior volume', () => {
    const r = montar({
      envios: [
        envio('a', 1, as(9), 'Psicólogo'),
        envio('b', 1, as(9), 'Estética automotiva'),
        envio('c', 1, as(9), 'Estética automotiva'),
      ],
    });

    expect(r.nichos.map((n) => n.nicho)).toEqual([
      'Estética automotiva',
      'Psicólogo',
    ]);
    expect(r.nichos[0]!.mandei).toBe(2);
  });

  it('a objeção é por nicho, e não global', () => {
    // É a leitura que decide qual lista continuar: "já tenho site" em
    // psicólogo e "achei caro" em estética são dois problemas
    // diferentes.
    const r = montar({
      envios: [envio('a', 1, as(9), 'Psicólogo'), envio('b', 1, as(9), 'Estética')],
      respostas: [
        resposta('a', as(10), { objecao: 'já tenho site' }),
        resposta('b', as(10), { objecao: 'achei caro' }),
      ],
    });

    const psi = r.nichos.find((n) => n.nicho === 'Psicólogo')!;
    const est = r.nichos.find((n) => n.nicho === 'Estética')!;
    expect(psi.objecaoMaisComum?.texto).toBe('já tenho site');
    expect(est.objecaoMaisComum?.texto).toBe('achei caro');
  });

  it('lead sem etiqueta vai para "Sem nicho"', () => {
    const r = montar({ envios: [envio('a', 1, as(9), null)] });
    expect(r.nichos[0]!.nicho).toBe('Sem nicho');
  });

  it('o total bate com a soma dos nichos', () => {
    const r = montar({
      envios: [
        envio('a', 1, as(9), 'A'),
        envio('b', 1, as(9), 'B'),
        envio('b', 2, as(15), 'B'),
      ],
    });

    const soma = r.nichos.reduce((t, n) => t + n.mandei, 0);
    expect(soma).toBe(r.total.mandei);
  });
});

describe('borda', () => {
  it('dia sem envio devolve tudo zerado', () => {
    const r = montar({ envios: [] });

    expect(r.total.mandei).toBe(0);
    expect(r.nichos).toEqual([]);
    expect(r.total.objecaoMaisComum).toBeNull();
  });

  it('resposta de quem NÃO está na turma é ignorada', () => {
    // O recorte é a turma do dia. Uma resposta de outro lead não pode
    // entrar na conta de um nicho que não é o dele.
    const r = montar({
      envios: [envio('a', 1, as(9))],
      respostas: [resposta('a', as(10)), resposta('zzz', as(10))],
    });
    expect(r.total.responderam).toBe(1);
  });

  it('resposta que chegou dias depois ainda conta', () => {
    const r = montar({
      envios: [envio('a', 1, as(9))],
      respostas: [resposta('a', depoisAs(5, 11))],
    });

    expect(r.total.responderam).toBe(1);
    expect(r.total.responderamPorEtapa[0]!.ordem).toBe(1);
  });
});
