/**
 * "Onde os leads estão."
 *
 * ============================================================
 * O NÚMERO QUE FALTAVA
 * ============================================================
 * Pedido: "coloque também: clientes etapa tal / clientes etapa tal".
 *
 * O painel sabia dizer quantos leads existem, quantos estão quentes e
 * quantos fecharam — e não sabia dizer a coisa mais simples de todas:
 * até onde a sequência foi. Vinte pessoas paradas na mensagem 1 e vinte
 * espalhadas até a 4 são duas semanas completamente diferentes, e as
 * métricas que a tela mostrava eram idênticas nos dois casos.
 *
 * ============================================================
 * A DECISÃO QUE ESTES TESTES TRAVAM
 * ============================================================
 * "Está na etapa N" é a MAIOR etapa que saiu, e o lead entra em UMA
 * linha só. Contá-lo em toda etapa que recebeu colocaria todo mundo na
 * etapa 1 — a única por onde todos passaram — e a lista deixaria de
 * mostrar movimento.
 */
import { describe, expect, it } from 'vitest';
import {
  contarLeadsPorEtapa,
  type EnvioPorEtapa,
} from '../packages/domain/src/index.js';

const envio = (
  leadId: string,
  ordem: number,
  etapaNome: string | null = null
): EnvioPorEtapa => ({ leadId, ordem, etapaNome });

describe('conta por posição na sequência', () => {
  it('cada lead entra na MAIOR etapa que chegou nele', () => {
    const r = contarLeadsPorEtapa([
      envio('a', 1),
      envio('a', 2),
      envio('a', 3),
      envio('b', 1),
    ]);

    expect(r).toEqual([
      { ordem: 1, rotulo: 'Mensagem 1', leads: 1 },
      { ordem: 3, rotulo: 'Mensagem 3', leads: 1 },
    ]);
  });

  it('a soma é o total de leads, e não de mensagens', () => {
    // Se somasse mensagens, três etapas para o mesmo lead diriam que a
    // prospecção alcançou três pessoas.
    const r = contarLeadsPorEtapa([
      envio('a', 1),
      envio('a', 2),
      envio('b', 1),
      envio('c', 2),
    ]);

    expect(r.reduce((t, e) => t + e.leads, 0)).toBe(3);
  });

  it('em ordem crescente — a leitura é "como a fila anda"', () => {
    const r = contarLeadsPorEtapa([envio('a', 4), envio('b', 1), envio('c', 2)]);
    expect(r.map((e) => e.ordem)).toEqual([1, 2, 4]);
  });

  it('usa o nome da etapa quando ela tem um', () => {
    const r = contarLeadsPorEtapa([envio('a', 2, 'Prévia do site')]);
    expect(r[0]!.rotulo).toBe('Prévia do site');
  });

  it('nome só de espaços cai no rótulo padrão', () => {
    const r = contarLeadsPorEtapa([envio('a', 2, '   ')]);
    expect(r[0]!.rotulo).toBe('Mensagem 2');
  });

  it('etapa por onde ninguém passou não aparece', () => {
    // Uma linha "Mensagem 5: 0" numa campanha que nunca chegou lá é
    // ruído, não informação.
    const r = contarLeadsPorEtapa([envio('a', 1), envio('b', 3)]);
    expect(r.map((e) => e.ordem)).toEqual([1, 3]);
  });

  it('nada enviado devolve lista vazia, sem quebrar', () => {
    expect(contarLeadsPorEtapa([])).toEqual([]);
  });
});
