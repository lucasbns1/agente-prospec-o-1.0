import { describe, it, expect } from 'vitest';
import {
  posicaoNoQuadro,
  chaveDaColuna,
  montarColunas,
  STATUS_ENCERRADOS,
  STATUS_ESPERANDO_VOCE,
  type EstadoNaCampanha,
} from './quadro.js';

const est = (
  status: string,
  etapaAtualId: string | null = null
): EstadoNaCampanha => ({ status, etapaAtualId });

describe('posicaoNoQuadro', () => {
  it('sem etapa atual, o lead esta na fila — nao na etapa 1', () => {
    // O erro que isto previne: mostrar como "recebeu a mensagem 1" quem
    // ainda nao recebeu nada.
    expect(posicaoNoQuadro(est('PENDENTE'))).toEqual({
      tipo: 'NA_FILA',
      etapaId: null,
    });
  });

  it('com etapa atual e andando, cai na coluna daquela etapa', () => {
    expect(posicaoNoQuadro(est('EM_ANDAMENTO', 'e2'))).toEqual({
      tipo: 'ETAPA',
      etapaId: 'e2',
    });
    expect(posicaoNoQuadro(est('AGUARDANDO_RESPOSTA', 'e3'))).toEqual({
      tipo: 'ETAPA',
      etapaId: 'e3',
    });
    expect(posicaoNoQuadro(est('AGENDADO', 'e1'))).toEqual({
      tipo: 'ETAPA',
      etapaId: 'e1',
    });
  });

  describe('precedencia', () => {
    it('intervencao vence a etapa: o lead sai da coluna da mensagem', () => {
      // Se ele aparecesse nas duas, a soma das colunas passaria do total
      // de leads da campanha.
      expect(posicaoNoQuadro(est('AGUARDANDO_INTERVENCAO', 'e2'))).toEqual({
        tipo: 'PRECISA_DE_VOCE',
        etapaId: null,
      });
    });

    it('pausado tambem espera por voce, nao pela automacao', () => {
      expect(posicaoNoQuadro(est('PAUSADO', 'e2'))).toEqual({
        tipo: 'PRECISA_DE_VOCE',
        etapaId: null,
      });
    });

    it('opt-out vence intervencao', () => {
      // O caso perigoso: um lead que caiu em intervencao e depois pediu
      // para sair. Cobrar uma acao sua sobre ele seria pedir que voce
      // procure quem pediu para nao ser procurado.
      expect(posicaoNoQuadro(est('OPT_OUT', 'e2'))).toEqual({
        tipo: 'ENCERRADO',
        etapaId: null,
      });
    });

    it('concluido e parado saem da sequencia mesmo com etapa preenchida', () => {
      expect(posicaoNoQuadro(est('CONCLUIDO', 'e5')).tipo).toBe('ENCERRADO');
      expect(posicaoNoQuadro(est('PARADO', 'e2')).tipo).toBe('ENCERRADO');
    });
  });

  it('todo status conhecido cai em exatamente uma coluna', () => {
    const TODOS = [
      'PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_RESPOSTA',
      'AGUARDANDO_INTERVENCAO', 'AGENDADO', 'PAUSADO', 'CONCLUIDO',
      'PARADO', 'OPT_OUT',
    ];
    for (const s of TODOS) {
      const p = posicaoNoQuadro(est(s, 'e1'));
      expect(['NA_FILA', 'ETAPA', 'PRECISA_DE_VOCE', 'ENCERRADO']).toContain(
        p.tipo
      );
    }
  });

  it('status desconhecido com etapa nao some do quadro', () => {
    // Um status novo no enum nao pode fazer o lead desaparecer da tela
    // silenciosamente: ele cai na etapa, onde da para ve-lo.
    expect(posicaoNoQuadro(est('STATUS_QUE_AINDA_NAO_EXISTE', 'e2'))).toEqual({
      tipo: 'ETAPA',
      etapaId: 'e2',
    });
  });
});

describe('as listas exportadas concordam com posicaoNoQuadro', () => {
  // A API monta os filtros do banco a partir destas listas. Se elas
  // divergirem da funcao, a contagem da coluna deixa de bater com os
  // cartoes que aparecem nela.
  it('todo status de STATUS_ENCERRADOS cai em ENCERRADO', () => {
    for (const s of STATUS_ENCERRADOS) {
      expect(posicaoNoQuadro(est(s, 'e1')).tipo).toBe('ENCERRADO');
    }
  });

  it('todo status de STATUS_ESPERANDO_VOCE cai em PRECISA_DE_VOCE', () => {
    for (const s of STATUS_ESPERANDO_VOCE) {
      expect(posicaoNoQuadro(est(s, 'e1')).tipo).toBe('PRECISA_DE_VOCE');
    }
  });

  it('as duas listas nao se sobrepoem', () => {
    const encerrados = new Set<string>(STATUS_ENCERRADOS);
    for (const s of STATUS_ESPERANDO_VOCE) {
      expect(encerrados.has(s)).toBe(false);
    }
  });

  it('status fora das duas listas nunca cai nelas', () => {
    const fora = ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_RESPOSTA', 'AGENDADO'];
    for (const s of fora) {
      expect(['NA_FILA', 'ETAPA']).toContain(posicaoNoQuadro(est(s, 'e1')).tipo);
    }
  });
});

describe('chaveDaColuna', () => {
  it('separa etapas diferentes', () => {
    const a = chaveDaColuna({ tipo: 'ETAPA', etapaId: 'e1' });
    const b = chaveDaColuna({ tipo: 'ETAPA', etapaId: 'e2' });
    expect(a).not.toBe(b);
  });

  it('colunas fixas usam o proprio tipo', () => {
    expect(chaveDaColuna({ tipo: 'NA_FILA', etapaId: null })).toBe('NA_FILA');
    expect(chaveDaColuna({ tipo: 'ENCERRADO', etapaId: null })).toBe('ENCERRADO');
  });
});

describe('montarColunas', () => {
  const etapas = [
    { id: 'e2', ordem: 2, nome: null },
    { id: 'e1', ordem: 1, nome: 'Abertura' },
    { id: 'e3', ordem: 3, nome: '   ' },
  ];

  it('coloca fila na frente e encerrados no fim', () => {
    const c = montarColunas(etapas);
    expect(c[0]!.tipo).toBe('NA_FILA');
    expect(c[c.length - 1]!.tipo).toBe('ENCERRADO');
    expect(c[c.length - 2]!.tipo).toBe('PRECISA_DE_VOCE');
  });

  it('ordena as etapas por ordem, nao pela ordem do array', () => {
    const c = montarColunas(etapas).filter((x) => x.tipo === 'ETAPA');
    expect(c.map((x) => x.etapaId)).toEqual(['e1', 'e2', 'e3']);
  });

  it('usa o nome da etapa quando existe', () => {
    const c = montarColunas(etapas);
    expect(c.find((x) => x.etapaId === 'e1')?.titulo).toBe('Abertura');
  });

  it('cai para "Mensagem N" quando o nome esta vazio ou so com espacos', () => {
    const c = montarColunas(etapas);
    expect(c.find((x) => x.etapaId === 'e2')?.titulo).toBe('Mensagem 2');
    expect(c.find((x) => x.etapaId === 'e3')?.titulo).toBe('Mensagem 3');
  });

  it('sem etapas, ainda existem as tres colunas fixas', () => {
    const c = montarColunas([]);
    expect(c.map((x) => x.tipo)).toEqual([
      'NA_FILA',
      'PRECISA_DE_VOCE',
      'ENCERRADO',
    ]);
  });

  it('nao altera o array recebido', () => {
    const original = [...etapas];
    montarColunas(etapas);
    expect(etapas).toEqual(original);
  });

  it('as chaves sao unicas', () => {
    const c = montarColunas(etapas);
    expect(new Set(c.map((x) => x.chave)).size).toBe(c.length);
  });
});
