import { describe, expect, it } from 'vitest';
import {
  limparEspacos,
  normalizarParaComparacao,
  normalizarNome,
  extrairPrimeiroNome,
  pareceEmpresa,
  normalizarEstado,
  normalizarCidade,
  normalizarCep,
  separarEndereco,
  normalizarAvaliacao,
  normalizarContagem,
} from '../packages/domain/src/normalization/texto.js';
import {
  normalizarTelefone,
  telefoneE164,
  formatarTelefone,
} from '../packages/domain/src/normalization/telefone.js';

describe('limparEspacos', () => {
  it('colapsa espacos e apara as pontas', () => {
    expect(limparEspacos('  Maria   Silva  ')).toBe('Maria Silva');
    expect(limparEspacos('a\t\nb')).toBe('a b');
  });
  it('devolve null para vazio', () => {
    expect(limparEspacos('')).toBeNull();
    expect(limparEspacos('   ')).toBeNull();
    expect(limparEspacos(null)).toBeNull();
    expect(limparEspacos(undefined)).toBeNull();
  });
});

describe('normalizarParaComparacao', () => {
  it('remove acentos, pontuacao e caixa', () => {
    expect(normalizarParaComparacao('José da Silva')).toBe('jose da silva');
    expect(normalizarParaComparacao('CLÍNICA SÃO JOÃO')).toBe('clinica sao joao');
    expect(normalizarParaComparacao('Dr. Ana-Paula')).toBe('dr ana paula');
  });
  it('devolve string vazia para nulo', () => {
    expect(normalizarParaComparacao(null)).toBe('');
  });
});

describe('normalizarNome', () => {
  it('conserta texto todo em maiusculas', () => {
    expect(normalizarNome('MARIA SILVA')).toBe('Maria Silva');
  });
  it('conserta texto todo em minusculas', () => {
    expect(normalizarNome('maria silva')).toBe('Maria Silva');
  });
  it('mantem conectivos em minusculo', () => {
    expect(normalizarNome('CLINICA DE PSICOLOGIA')).toBe('Clinica de Psicologia');
    expect(normalizarNome('maria da silva dos santos')).toBe('Maria da Silva dos Santos');
  });
  it('preserva acentos', () => {
    expect(normalizarNome('JOSÉ ANTÔNIO')).toBe('José Antônio');
  });
  it('nao mexe em caixa mista, escrita de proposito', () => {
    expect(normalizarNome('Clínica MedCare')).toBe('Clínica MedCare');
  });
  it('devolve null para vazio', () => {
    expect(normalizarNome('  ')).toBeNull();
  });
});

describe('extrairPrimeiroNome', () => {
  it('extrai de nome simples', () => {
    expect(extrairPrimeiroNome('Maria Silva')).toBe('Maria');
  });
  it('ignora titulos profissionais', () => {
    expect(extrairPrimeiroNome('Dra. Maria Silva')).toBe('Maria');
    expect(extrairPrimeiroNome('Psicóloga Ana Paula')).toBe('Ana');
    expect(extrairPrimeiroNome('DR. JOÃO PEDRO')).toBe('João');
  });
  it('corta no separador', () => {
    expect(extrairPrimeiroNome('Maria Silva - Psicóloga CRP 06/12345')).toBe('Maria');
    expect(extrairPrimeiroNome('Ana Costa | Terapeuta')).toBe('Ana');
  });
  it('devolve null para empresa — nunca chamar uma clinica pelo "nome"', () => {
    expect(extrairPrimeiroNome('Clínica de Psicologia Bem Viver')).toBeNull();
    expect(extrairPrimeiroNome('Instituto Saúde Mental')).toBeNull();
    expect(extrairPrimeiroNome('Centro Terapêutico Vida')).toBeNull();
  });
  it('devolve null quando so ha titulo', () => {
    expect(extrairPrimeiroNome('Dra.')).toBeNull();
  });
  it('ignora tokens que nao sao nome', () => {
    expect(extrairPrimeiroNome('CRP 12345 Maria')).toBe('Maria');
    expect(extrairPrimeiroNome('@mariapsi')).toBeNull();
  });
  it('devolve null para entrada vazia', () => {
    expect(extrairPrimeiroNome(null)).toBeNull();
    expect(extrairPrimeiroNome('')).toBeNull();
  });
});

describe('pareceEmpresa', () => {
  it('reconhece marcadores de empresa', () => {
    expect(pareceEmpresa('Clínica Vida')).toBe(true);
    expect(pareceEmpresa('Consultório Dr. Silva')).toBe(true);
    expect(pareceEmpresa('Espaço Terapêutico')).toBe(true);
  });
  it('nao marca pessoa fisica', () => {
    expect(pareceEmpresa('Maria Silva')).toBe(false);
    expect(pareceEmpresa('Dra. Ana Paula Costa')).toBe(false);
  });
});

describe('normalizarEstado', () => {
  it('aceita sigla', () => {
    expect(normalizarEstado('sp')).toBe('SP');
    expect(normalizarEstado(' RJ ')).toBe('RJ');
  });
  it('aceita nome por extenso', () => {
    expect(normalizarEstado('São Paulo')).toBe('SP');
    expect(normalizarEstado('minas gerais')).toBe('MG');
  });
  it('devolve null para estado inexistente', () => {
    expect(normalizarEstado('XX')).toBeNull();
    expect(normalizarEstado('Campinas')).toBeNull();
    expect(normalizarEstado(null)).toBeNull();
  });
});

describe('normalizarCidade', () => {
  it('normaliza a caixa', () => {
    expect(normalizarCidade('CAMPINAS')).toBe('Campinas');
    expect(normalizarCidade('são paulo')).toBe('São Paulo');
  });
  it('rejeita valor puramente numerico', () => {
    expect(normalizarCidade('12345')).toBeNull();
  });
});

describe('normalizarCep', () => {
  it('formata 8 digitos', () => {
    expect(normalizarCep('13010041')).toBe('13010-041');
    expect(normalizarCep('13010-041')).toBe('13010-041');
    expect(normalizarCep('13.010-041')).toBe('13010-041');
  });
  it('devolve null quando nao tem 8 digitos', () => {
    expect(normalizarCep('1301004')).toBeNull();
    expect(normalizarCep('')).toBeNull();
    expect(normalizarCep(null)).toBeNull();
  });
});

describe('separarEndereco', () => {
  it('separa o formato tipico do Google Maps', () => {
    const r = separarEndereco('R. Ferreira Penteado, 123 - Cambuí, Campinas - SP, 13010-041');
    expect(r.logradouro).toBe('R. Ferreira Penteado');
    expect(r.numero).toBe('123');
    expect(r.bairro).toBe('Cambuí');
    expect(r.cidade).toBe('Campinas');
    expect(r.estado).toBe('SP');
    expect(r.cep).toBe('13010-041');
  });

  it('NUNCA inventa bairro quando ele nao esta explicito', () => {
    const r = separarEndereco('Av. Paulista, 1000, São Paulo - SP');
    expect(r.bairro).toBeNull();
    expect(r.cidade).toBe('São Paulo');
    expect(r.estado).toBe('SP');
  });

  it('lida com endereco sem numero', () => {
    const r = separarEndereco('Rua das Flores, Campinas - SP');
    expect(r.logradouro).toBe('Rua das Flores');
    expect(r.numero).toBeNull();
    expect(r.bairro).toBeNull();
  });

  it('devolve tudo null para entrada vazia', () => {
    const r = separarEndereco(null);
    expect(Object.values(r).every((v) => v === null)).toBe(true);
  });
});

describe('normalizarAvaliacao', () => {
  it('aceita virgula e ponto', () => {
    expect(normalizarAvaliacao('4,8')).toBe(4.8);
    expect(normalizarAvaliacao('4.8')).toBe(4.8);
    expect(normalizarAvaliacao(5)).toBe(5);
  });
  it('rejeita fora do intervalo 0-5', () => {
    expect(normalizarAvaliacao('9')).toBeNull();
    expect(normalizarAvaliacao('-1')).toBeNull();
  });
  it('devolve null para vazio ou texto', () => {
    expect(normalizarAvaliacao('')).toBeNull();
    expect(normalizarAvaliacao(null)).toBeNull();
    expect(normalizarAvaliacao('sem nota')).toBeNull();
  });
});

describe('normalizarContagem', () => {
  it('extrai o numero de textos variados', () => {
    expect(normalizarContagem('87')).toBe(87);
    expect(normalizarContagem('(87)')).toBe(87);
    expect(normalizarContagem('1.234 avaliações')).toBe(1234);
  });
  it('devolve null sem digitos', () => {
    expect(normalizarContagem('sem avaliações')).toBeNull();
    expect(normalizarContagem(null)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// TELEFONE
// -----------------------------------------------------------------------------
describe('normalizarTelefone', () => {
  it('normaliza celular formatado', () => {
    const r = normalizarTelefone('(19) 99999-8888');
    expect(r.e164).toBe('5519999998888');
    expect(r.ddd).toBe('19');
    expect(r.celular).toBe(true);
  });

  it('aceita varias formatacoes para o mesmo numero', () => {
    const esperado = '5519999998888';
    for (const entrada of [
      '(19) 99999-8888',
      '19 99999 8888',
      '19999998888',
      '+55 19 99999-8888',
      '5519999998888',
      '019 99999-8888',
      'tel: (19) 99999-8888',
    ]) {
      expect(telefoneE164(entrada), `entrada: ${entrada}`).toBe(esperado);
    }
  });

  it('normaliza telefone fixo', () => {
    const r = normalizarTelefone('(19) 3232-1010');
    expect(r.e164).toBe('551932321010');
    expect(r.celular).toBe(false);
  });

  it('usa o primeiro numero quando a celula traz varios', () => {
    expect(telefoneE164('(19) 99999-8888 / (19) 3232-1010')).toBe('5519999998888');
  });

  it('NAO inventa DDD quando ele falta', () => {
    const r = normalizarTelefone('99999-8888');
    expect(r.e164).toBeNull();
    expect(r.motivoInvalido).toMatch(/sem DDD/);
  });

  it('rejeita DDD inexistente', () => {
    const r = normalizarTelefone('(00) 99999-8888');
    expect(r.e164).toBeNull();
    expect(r.motivoInvalido).toMatch(/DDD/);
  });

  it('rejeita numero curto e longo demais', () => {
    expect(normalizarTelefone('1234').e164).toBeNull();
    expect(normalizarTelefone('191234567890123').e164).toBeNull();
  });

  it('rejeita sequencia repetida', () => {
    expect(normalizarTelefone('11111111111').e164).toBeNull();
  });

  it('rejeita celular de 9 digitos que nao comeca com 9', () => {
    expect(normalizarTelefone('(19) 89999-8888').e164).toBeNull();
  });

  it('devolve null para entrada vazia, com motivo', () => {
    expect(normalizarTelefone(null).e164).toBeNull();
    expect(normalizarTelefone('').motivoInvalido).toBe('telefone vazio');
    expect(normalizarTelefone('sem telefone').e164).toBeNull();
  });
});

describe('formatarTelefone', () => {
  it('formata celular e fixo', () => {
    expect(formatarTelefone('5519999998888')).toBe('(19) 99999-8888');
    expect(formatarTelefone('551932321010')).toBe('(19) 3232-1010');
  });
  it('devolve null para entrada nula', () => {
    expect(formatarTelefone(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LISTAS DE FORA DO BRASIL
//
// O DDI padrao vem de `settings['leads.telefone_ddi_padrao']`. Ele
// existia, mas nao funcionava: mesmo configurado para outro pais, o
// numero passava pela validacao brasileira (DDD de dois digitos,
// celular comecando com 9) e era rejeitado. Na pratica so entravam
// numeros que ja viessem com "+DDI" na planilha — e o "+" e um detalhe
// de formatacao, nao pode decidir se voce fala com a pessoa.
// ---------------------------------------------------------------------------
describe('normalizarTelefone — listas de outro pais', () => {
  const PT = '351';

  it('aceita o mesmo numero português em qualquer formatação', () => {
    const esperado = '351912345678';
    for (const bruto of [
      '+351912345678',
      '351912345678',
      '912345678',
      '00351912345678',
      '+351 912 345 678',
      '351 912 345 678',
    ]) {
      expect(normalizarTelefone(bruto, PT).e164).toBe(esperado);
    }
  });

  it('não soma o DDI duas vezes quando ele já veio', () => {
    // O erro clássico: "351912345678" virar "351351912345678".
    expect(normalizarTelefone('351912345678', PT).e164).toBe('351912345678');
    expect(normalizarTelefone('+351912345678', PT).e164).toBe('351912345678');
  });

  it('fixo de Lisboa entra igual ao celular', () => {
    expect(normalizarTelefone('21 123 4567', PT).e164).toBe('351211234567');
  });

  it('respeita o teto do E.164 mesmo sem conhecer as regras do país', () => {
    // Não há validação por país aqui — inventar uma quase-regra
    // rejeitaria números bons. O que se garante é o tamanho.
    expect(normalizarTelefone('9123456789012345', PT).e164).toBeNull();
  });

  it('sequência repetida continua sendo lixo', () => {
    expect(normalizarTelefone('000000000', PT).e164).toBeNull();
  });

  it('o "00" internacional é entendido mesmo com DDI padrão 55', () => {
    // "00351..." é o mesmo número que "+351..." — o "00" faz o papel do
    // "+". Antes caía em "longo demais" e o lead entrava sem telefone.
    expect(normalizarTelefone('00351912345678').e164).toBe('351912345678');
  });

  it('e não engole o zero de operadora de um número brasileiro', () => {
    // "019 99999-8888" começa com zero mas NÃO é internacional.
    expect(normalizarTelefone('019999998888').e164).toBe('5519999998888');
  });
});
