/**
 * "Já cuidei disso" em "Precisa da sua atenção".
 *
 * ============================================================
 * POR QUE UMA DISPENSA COM CARIMBO DE TEMPO
 * ============================================================
 * A lista não é uma tabela — ela é recalculada a cada carga, de seis
 * consultas. Não há linha para apagar: um lead quente está ali porque a
 * coluna `temperatura` diz QUENTE.
 *
 * A saída óbvia seria o botão MUDAR o dado que colocou o lead ali. A
 * lista encolheria e o histórico passaria a mentir: o lead REALMENTE
 * perguntou preço, o envio REALMENTE falhou.
 *
 * Então a dispensa é um evento com hora, e ela esconde as pendências
 * mais VELHAS que ela. É o que faz o lead VOLTAR quando algo novo
 * acontece — e esse é o comportamento que estes testes travam.
 */
import { describe, expect, it } from 'vitest';
import {
  peneirarResolvidos,
  type CandidatoAtencao,
} from '../packages/domain/src/index.js';

const ONTEM = new Date(2026, 7, 25, 10, 0, 0);
const HOJE = new Date(2026, 7, 26, 10, 0, 0);

const cand = (
  leadId: string,
  em: Date,
  motivo: CandidatoAtencao['motivo'] = 'LEAD_QUENTE'
): CandidatoAtencao => ({
  leadId,
  nome: `Lead ${leadId}`,
  categoria: null,
  bairro: null,
  cidade: null,
  temperatura: 'QUENTE',
  status: 'EM_CONVERSA',
  motivo,
  ultimaMensagem: null,
  etapaAtual: null,
  em,
});

describe('o que a dispensa esconde', () => {
  it('a pendência mais velha que a dispensa some', () => {
    const r = peneirarResolvidos(
      [cand('a', ONTEM)],
      new Map([['a', HOJE]])
    );
    expect(r).toHaveLength(0);
  });

  it('nascida no MESMO instante conta como coberta', () => {
    // O contrário faria uma tarefa criada no mesmo segundo do clique
    // sobreviver, e o lead voltaria sem nada ter acontecido de novo.
    const r = peneirarResolvidos([cand('a', HOJE)], new Map([['a', HOJE]]));
    expect(r).toHaveLength(0);
  });

  it('esconde TODOS os motivos daquele lead de uma vez', () => {
    // O mesmo lead pode estar na lista por vários motivos ao mesmo
    // tempo. Se a dispensa cobrisse só o motivo exibido, o lead voltaria
    // na hora com o segundo, e o botão pareceria quebrado.
    const r = peneirarResolvidos(
      [
        cand('a', ONTEM, 'LEAD_QUENTE'),
        cand('a', ONTEM, 'PEDIDO_PRECO'),
        cand('a', ONTEM, 'TAREFA_ATRASADA'),
      ],
      new Map([['a', HOJE]])
    );
    expect(r).toHaveLength(0);
  });
});

describe('o que a dispensa NÃO esconde', () => {
  it('uma pendência mais nova traz o lead de volta', () => {
    // Se o lead responder de novo amanhã, ele volta — porque aquilo
    // aconteceu depois de você dizer que tinha cuidado.
    const amanha = new Date(2026, 7, 27, 9, 0, 0);
    const r = peneirarResolvidos(
      [cand('a', amanha)],
      new Map([['a', HOJE]])
    );
    expect(r).toHaveLength(1);
  });

  it('a dispensa de um lead não atinge outro', () => {
    const r = peneirarResolvidos(
      [cand('a', ONTEM), cand('b', ONTEM)],
      new Map([['a', HOJE]])
    );
    expect(r.map((c) => c.leadId)).toEqual(['b']);
  });

  it('lead sem dispensa nenhuma passa inteiro', () => {
    const r = peneirarResolvidos([cand('a', ONTEM)], new Map());
    expect(r).toHaveLength(1);
  });

  it('sem dispensa nenhuma, devolve a lista original', () => {
    // Atalho para o caso comum: nada a filtrar, nada a percorrer.
    const lista = [cand('a', ONTEM), cand('b', HOJE)];
    expect(peneirarResolvidos(lista, new Map())).toBe(lista);
  });
});

describe('borda', () => {
  it('lista vazia não quebra', () => {
    expect(peneirarResolvidos([], new Map([['a', HOJE]]))).toEqual([]);
  });
});
