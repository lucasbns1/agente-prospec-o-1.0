/**
 * A prospecção separada por nicho.
 *
 * ============================================================
 * O PEDIDO
 * ============================================================
 * "Quero que tenha um total — todos os nichos mandados — e as
 * informações de quantos mandaram e etc de cada nicho também."
 *
 * ============================================================
 * AS DECISÕES QUE ESTES TESTES TRAVAM
 * ============================================================
 *   - "abordado" é ter RECEBIDO mensagem, não estar numa campanha;
 *   - a taxa de resposta é sobre os abordados, não sobre a lista;
 *   - sem ninguém abordado a taxa é `null`, e não 0%;
 *   - o total é calculado sobre todos os leads, não somando as linhas;
 *   - lead sem etiqueta não some — vai para "Sem nicho".
 */
import { describe, expect, it } from 'vitest';
import {
  montarResumoPorNicho,
  ROTULO_TOTAL,
  SEM_NICHO,
  type LeadDoNicho,
} from '../packages/domain/src/index.js';

const lead = (over: Partial<LeadDoNicho> = {}): LeadDoNicho => ({
  leadId: `l${Math.random()}`,
  nicho: 'Estética automotiva',
  temperatura: 'FRIO',
  status: 'PRONTO',
  optOut: false,
  enviadas: 0,
  respondeu: false,
  ...over,
});

describe('quantos eu mandei', () => {
  it('"abordado" é ter recebido mensagem, e não estar na campanha', () => {
    // Um lead enfileirado que ainda não teve nada enviado não testou
    // nada. Contá-lo estragaria a taxa de resposta do nicho inteiro.
    const r = montarResumoPorNicho([
      lead({ enviadas: 1 }),
      lead({ enviadas: 0 }),
      lead({ enviadas: 0 }),
    ]);

    expect(r.total.leads).toBe(3);
    expect(r.total.abordados).toBe(1);
    expect(r.total.naFila).toBe(2);
  });

  it('mensagens e pessoas são números diferentes', () => {
    // Um lead que recebeu três etapas é UMA pessoa abordada e TRÊS
    // mensagens. Juntar os dois faria a taxa de resposta parecer três
    // vezes pior do que é.
    const r = montarResumoPorNicho([lead({ enviadas: 3 })]);

    expect(r.total.abordados).toBe(1);
    expect(r.total.enviadas).toBe(3);
  });
});

describe('a taxa de resposta', () => {
  it('é sobre quem foi abordado, e não sobre a lista inteira', () => {
    // 1 resposta em 2 abordados é 50%, ainda que a planilha tenha 10
    // nomes. Dividir pela lista mediria o quanto você ainda não mandou.
    const r = montarResumoPorNicho([
      lead({ enviadas: 1, respondeu: true }),
      lead({ enviadas: 1 }),
      ...Array.from({ length: 8 }, () => lead()),
    ]);

    expect(r.total.abordados).toBe(2);
    expect(r.total.responderam).toBe(1);
    expect(r.total.semResposta).toBe(1);
    expect(r.total.taxaResposta).toBe(50);
  });

  it('sem ninguém abordado a taxa é null, e não 0%', () => {
    // "0% de resposta" é uma afirmação sobre um teste que não foi feito.
    const r = montarResumoPorNicho([lead(), lead()]);
    expect(r.total.taxaResposta).toBeNull();
  });

  it('quem respondeu sem nunca ter recebido não conta', () => {
    // Alguém que escreveu do nada não é resposta a uma abordagem que
    // não houve — e inflaria a taxa de um nicho sem ter sido abordado.
    const r = montarResumoPorNicho([lead({ enviadas: 0, respondeu: true })]);

    expect(r.total.abordados).toBe(0);
    expect(r.total.responderam).toBe(0);
  });
});

describe('a separação por nicho', () => {
  it('nichos diferentes não se misturam', () => {
    // O caso que motivou tudo: 100% e 0% davam um "50%" que não
    // descreve nenhum dos dois.
    const r = montarResumoPorNicho([
      lead({ nicho: 'Estética automotiva', enviadas: 1, respondeu: true }),
      lead({ nicho: 'Psicólogo', enviadas: 1 }),
    ]);

    const estetica = r.nichos.find((n) => n.nicho === 'Estética automotiva')!;
    const psi = r.nichos.find((n) => n.nicho === 'Psicólogo')!;

    expect(estetica.taxaResposta).toBe(100);
    expect(psi.taxaResposta).toBe(0);
    expect(r.total.taxaResposta).toBe(50);
  });

  it('ordena pelo maior volume de envios', () => {
    // A lista onde você mais gastou mensagem é a que mais merece uma
    // decisão.
    const r = montarResumoPorNicho([
      lead({ nicho: 'Beleza', enviadas: 1 }),
      lead({ nicho: 'Psicólogo', enviadas: 5 }),
    ]);

    expect(r.nichos.map((n) => n.nicho)).toEqual(['Psicólogo', 'Beleza']);
  });

  it('lead sem etiqueta não some — vai para "Sem nicho"', () => {
    const r = montarResumoPorNicho([lead({ nicho: null, enviadas: 1 })]);
    expect(r.nichos.map((n) => n.nicho)).toEqual([SEM_NICHO]);
  });

  it('nicho só de espaços conta como sem nicho', () => {
    const r = montarResumoPorNicho([lead({ nicho: '   ' })]);
    expect(r.nichos[0]!.nicho).toBe(SEM_NICHO);
  });
});

describe('o total', () => {
  it('é rotulado, e vem calculado sobre todos os leads', () => {
    const r = montarResumoPorNicho([
      lead({ nicho: 'A', enviadas: 2, respondeu: true }),
      lead({ nicho: 'B', enviadas: 3 }),
      lead({ nicho: null }),
    ]);

    expect(r.total.nicho).toBe(ROTULO_TOTAL);
    expect(r.total.leads).toBe(3);
    expect(r.total.enviadas).toBe(5);
  });

  it('bate com a soma dos nichos', () => {
    // As duas contas são feitas por caminhos diferentes de propósito. Se
    // divergirem, é porque uma suposição quebrou — e é este teste que
    // pega isso.
    const leads = [
      lead({ nicho: 'A', enviadas: 2, respondeu: true }),
      lead({ nicho: 'A', enviadas: 1 }),
      lead({ nicho: 'B', enviadas: 4, respondeu: true }),
      lead({ nicho: null, enviadas: 0 }),
    ];
    const r = montarResumoPorNicho(leads);

    const soma = (f: (n: (typeof r.nichos)[number]) => number) =>
      r.nichos.reduce((t, n) => t + f(n), 0);

    expect(soma((n) => n.leads)).toBe(r.total.leads);
    expect(soma((n) => n.enviadas)).toBe(r.total.enviadas);
    expect(soma((n) => n.abordados)).toBe(r.total.abordados);
    expect(soma((n) => n.responderam)).toBe(r.total.responderam);
    expect(soma((n) => n.naFila)).toBe(r.total.naFila);
  });
});

describe('os outros números', () => {
  it('quentes, clientes e opt-outs contam mesmo sem envio', () => {
    // Diferente de "abordado": um lead pode ter virado cliente por um
    // caminho que não passou pela sequência, e apagá-lo daqui faria o
    // painel esconder um fechamento.
    const r = montarResumoPorNicho([
      lead({ temperatura: 'QUENTE' }),
      lead({ status: 'CLIENTE' }),
      lead({ optOut: true }),
    ]);

    expect(r.total.quentes).toBe(1);
    expect(r.total.clientes).toBe(1);
    expect(r.total.optOuts).toBe(1);
  });
});

describe('borda', () => {
  it('banco vazio não quebra', () => {
    const r = montarResumoPorNicho([]);

    expect(r.nichos).toEqual([]);
    expect(r.total.leads).toBe(0);
    expect(r.total.taxaResposta).toBeNull();
  });
});
