/**
 * O teste central: o sistema NUNCA inventa nome de pessoa.
 *
 * Os casos de "Salao da Ana" e "Barbearia do Ze" nao sao hipoteticos —
 * sao os nomes que a versao anterior transformava em "Oi, Salao!" e
 * "Oi, Barbearia!". Ficam aqui para nunca mais voltarem.
 */
import { describe, it, expect } from 'vitest';
import {
  obterNomeParaAbordagem,
  obterNomeEstabelecimento,
  podeSaudarPeloNome,
  type IdentidadeLead,
} from './nome-abordagem.js';

const lead = (p: Partial<IdentidadeLead> = {}): IdentidadeLead => ({
  nomeContato: null,
  empresa: null,
  nomeCompleto: null,
  ...p,
});

describe('obterNomeParaAbordagem', () => {
  describe('nome de pessoa declarado', () => {
    it('usa o contato quando ele existe', () => {
      const r = obterNomeParaAbordagem(
        lead({ nomeContato: 'Luana', empresa: 'Studio Luana Silva' })
      );
      expect(r).toEqual({
        nome: 'Luana',
        origem: 'CONTATO_DECLARADO',
        ehPessoa: true,
      });
    });

    it('o contato vence o estabelecimento', () => {
      const r = obterNomeParaAbordagem(
        lead({ nomeContato: 'Sônia', empresa: 'Studio Sônia Salomão' })
      );
      expect(r.nome).toBe('Sônia');
      expect(r.ehPessoa).toBe(true);
    });

    it('ignora contato vazio ou só com espaços', () => {
      expect(
        obterNomeParaAbordagem(lead({ nomeContato: '   ', empresa: 'Padaria X' }))
          .origem
      ).toBe('ESTABELECIMENTO');
      expect(
        obterNomeParaAbordagem(lead({ nomeContato: '', empresa: 'Padaria X' }))
          .origem
      ).toBe('ESTABELECIMENTO');
    });

    it('normaliza espaços internos', () => {
      expect(
        obterNomeParaAbordagem(lead({ nomeContato: '  Ana   Paula ' })).nome
      ).toBe('Ana Paula');
    });
  });

  describe('sem contato declarado — NUNCA deduz pessoa', () => {
    // Cada caso abaixo produzia uma saudação errada na versão anterior.
    const armadilhas = [
      'Salão da Ana',
      'Barbearia do Zé',
      'Pizzaria Roma',
      'Ana Beleza',
      'Maria Fernanda Advocacia',
      'Studio Luana Silva',
      'Clínica João Silva',
      'Padaria do Paulo',
      'Bar da Márcia',
      'Auto Elétrica do Carlos',
    ];

    for (const nome of armadilhas) {
      it(`"${nome}" não vira nome de pessoa`, () => {
        const r = obterNomeParaAbordagem(lead({ empresa: nome }));
        expect(r.ehPessoa).toBe(false);
        expect(r.origem).toBe('ESTABELECIMENTO');
        // O nome continua disponível — só não serve para saudar.
        expect(r.nome).toBe(nome);
      });
    }

    it('nem mesmo quando o nome é só um primeiro nome', () => {
      // "Luana" sozinho como nome do estabelecimento continua sendo o
      // estabelecimento. Não há informação que diga o contrário.
      const r = obterNomeParaAbordagem(lead({ empresa: 'Luana' }));
      expect(r.ehPessoa).toBe(false);
    });
  });

  describe('fallback para nomeCompleto', () => {
    it('usa nomeCompleto quando não há empresa separada', () => {
      const r = obterNomeParaAbordagem(lead({ nomeCompleto: 'Mercadinho Bom Preço' }));
      expect(r.nome).toBe('Mercadinho Bom Preço');
      expect(r.origem).toBe('ESTABELECIMENTO');
    });

    it('empresa vence nomeCompleto', () => {
      const r = obterNomeParaAbordagem(
        lead({ empresa: 'Studio A', nomeCompleto: 'Studio A - Beleza' })
      );
      expect(r.nome).toBe('Studio A');
    });
  });

  describe('sem nada', () => {
    it('devolve NENHUM', () => {
      expect(obterNomeParaAbordagem(lead())).toEqual({
        nome: null,
        origem: 'NENHUM',
        ehPessoa: false,
      });
    });

    it('trata espaços em branco como ausência', () => {
      expect(
        obterNomeParaAbordagem(lead({ empresa: '  ', nomeCompleto: '' })).origem
      ).toBe('NENHUM');
    });
  });
});

describe('obterNomeEstabelecimento', () => {
  it('devolve a empresa mesmo quando há contato', () => {
    // A mensagem precisa dos DOIS: "Oi, Luana! Encontrei o Studio no Google".
    // Se o contato substituísse o estabelecimento, o lead perderia a
    // referência de onde você o encontrou.
    expect(
      obterNomeEstabelecimento(
        lead({ nomeContato: 'Luana', empresa: 'Studio Luana Silva' })
      )
    ).toBe('Studio Luana Silva');
  });

  it('cai para nomeCompleto', () => {
    expect(obterNomeEstabelecimento(lead({ nomeCompleto: 'Bar do Zé' }))).toBe(
      'Bar do Zé'
    );
  });

  it('null quando não há nada', () => {
    expect(obterNomeEstabelecimento(lead())).toBeNull();
  });
});

describe('podeSaudarPeloNome', () => {
  it('true só com contato declarado', () => {
    expect(podeSaudarPeloNome(lead({ nomeContato: 'Ana' }))).toBe(true);
  });

  it('false para estabelecimento, por mais que pareça pessoa', () => {
    expect(podeSaudarPeloNome(lead({ empresa: 'Ana Beleza' }))).toBe(false);
    expect(podeSaudarPeloNome(lead({ empresa: 'Salão da Ana' }))).toBe(false);
  });

  it('false quando não há nome nenhum', () => {
    expect(podeSaudarPeloNome(lead())).toBe(false);
  });
});
