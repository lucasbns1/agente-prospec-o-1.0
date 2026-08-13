/**
 * Testes do parser e do mapeamento de colunas.
 *
 * O CSV de fixture usa cabecalhos em portugues; o XLSX usa os mesmos
 * dados com cabecalhos em INGLES. Isso exercita o mapeamento flexivel
 * de verdade — o Instant Data Scraper muda os nomes conforme o idioma
 * da interface do Google Maps.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCsv,
  parseXlsx,
  parseArquivo,
  detectarFormato,
  detectarDelimitador,
  decodificar,
  ErroParse,
} from '../packages/integrations/src/import/parser.js';
import {
  sugerirMapeamento,
  sugestoesParaMapeamento,
  aplicarMapeamento,
  normalizarCabecalho,
} from '../packages/integrations/src/import/column-mapping.js';

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures'
);
const csvBuffer = () => readFileSync(path.join(FIXTURES, 'leads.csv'));
const xlsxBuffer = () => readFileSync(path.join(FIXTURES, 'leads.xlsx'));

describe('detectarFormato', () => {
  it('reconhece csv e xlsx', () => {
    expect(detectarFormato('leads.csv')).toBe('csv');
    expect(detectarFormato('LEADS.CSV')).toBe('csv');
    expect(detectarFormato('planilha.xlsx')).toBe('xlsx');
  });
  it('rejeita outros formatos', () => {
    expect(detectarFormato('arquivo.xls')).toBeNull();
    expect(detectarFormato('arquivo.pdf')).toBeNull();
    expect(detectarFormato('arquivo')).toBeNull();
  });
});

describe('detectarDelimitador', () => {
  it('detecta virgula', () => {
    expect(detectarDelimitador('a,b,c\n1,2,3')).toBe(',');
  });
  it('detecta ponto e virgula (padrao do Excel em pt-BR)', () => {
    expect(detectarDelimitador('a;b;c\n1;2;3')).toBe(';');
  });
  it('detecta tabulacao', () => {
    expect(detectarDelimitador('a\tb\tc')).toBe('\t');
  });
  it('ignora delimitadores dentro de aspas', () => {
    // A virgula dentro das aspas nao pode fazer virgula vencer.
    expect(detectarDelimitador('nome;endereco\n"Maria";"Rua A, 123"')).toBe(';');
  });
});

describe('decodificar', () => {
  it('le UTF-8 sem aviso', () => {
    const r = decodificar(Buffer.from('Psicóloga', 'utf-8'));
    expect(r.texto).toBe('Psicóloga');
    expect(r.aviso).toBeUndefined();
  });
  it('cai para Windows-1252 e avisa', () => {
    const r = decodificar(Buffer.from([0x50, 0x73, 0x69, 0x63, 0xf3]));
    expect(r.texto).toBe('Psicó');
    expect(r.aviso).toMatch(/Windows-1252/);
  });
});

describe('parseCsv', () => {
  it('le a fixture completa', () => {
    const r = parseCsv(csvBuffer());
    expect(r.formato).toBe('csv');
    expect(r.delimitador).toBe(',');
    expect(r.cabecalhos).toContain('Nome');
    expect(r.cabecalhos).toContain('Website');
    expect(r.linhas.length).toBe(10);
  });

  it('preserva acentos', () => {
    const r = parseCsv(csvBuffer());
    expect(r.linhas[0]!['Nome']).toBe('Psicóloga Maria Silva');
  });

  it('converte celula vazia em null, nunca string vazia', () => {
    const r = parseCsv(csvBuffer());
    const semSite = r.linhas.find((l) => l['Nome'] === 'Psicólogo João Pedro');
    expect(semSite!['Website']).toBeNull();
  });

  it('remove o BOM do primeiro cabecalho', () => {
    const comBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('Nome,Telefone\nMaria,123', 'utf-8'),
    ]);
    const r = parseCsv(comBom);
    expect(r.cabecalhos[0]).toBe('Nome');
  });

  it('aceita ponto e virgula', () => {
    const r = parseCsv(Buffer.from('Nome;Telefone\nMaria;(19) 99999-1111', 'utf-8'));
    expect(r.delimitador).toBe(';');
    expect(r.linhas[0]!['Telefone']).toBe('(19) 99999-1111');
  });

  it('rejeita arquivo vazio', () => {
    expect(() => parseCsv(Buffer.from('', 'utf-8'))).toThrow(ErroParse);
  });

  it('descarta linhas totalmente vazias', () => {
    const r = parseCsv(Buffer.from('Nome,Tel\nMaria,1\n,\n\nAna,2', 'utf-8'));
    expect(r.linhas.length).toBe(2);
  });
});

describe('parseXlsx', () => {
  it('le a fixture e usa a primeira planilha', async () => {
    const r = await parseXlsx(xlsxBuffer());
    expect(r.formato).toBe('xlsx');
    expect(r.planilhaUsada).toBe('Leads');
    expect(r.linhas.length).toBe(10);
  });

  it('avisa quando ha mais de uma planilha, dizendo qual usou', async () => {
    const r = await parseXlsx(xlsxBuffer());
    expect(r.planilhasDisponiveis).toEqual(['Leads', 'Notas']);
    expect(r.avisos.some((a) => a.includes('Leads'))).toBe(true);
  });

  it('le cabecalhos em ingles', async () => {
    const r = await parseXlsx(xlsxBuffer());
    expect(r.cabecalhos).toContain('Name');
    expect(r.cabecalhos).toContain('Review count');
  });

  it('rejeita arquivo corrompido', async () => {
    await expect(parseXlsx(Buffer.from('nao sou um xlsx'))).rejects.toThrow(ErroParse);
  });
});

describe('parseArquivo', () => {
  it('roteia por extensao', async () => {
    expect((await parseArquivo(csvBuffer(), 'leads.csv')).formato).toBe('csv');
    expect((await parseArquivo(xlsxBuffer(), 'leads.xlsx')).formato).toBe('xlsx');
  });
  it('recusa formato nao suportado', async () => {
    await expect(parseArquivo(Buffer.from('x'), 'a.pdf')).rejects.toThrow(/csv ou .xlsx/);
  });
});

// -----------------------------------------------------------------------------
// MAPEAMENTO DE COLUNAS
// -----------------------------------------------------------------------------
describe('normalizarCabecalho', () => {
  it('remove acento, pontuacao e caixa', () => {
    expect(normalizarCabecalho('Avaliação')).toBe('avaliacao');
    expect(normalizarCabecalho('Número de avaliações')).toBe('numero de avaliacoes');
    expect(normalizarCabecalho('  E-mail  ')).toBe('e mail');
  });
});

describe('sugerirMapeamento — cabecalhos em portugues', () => {
  it('mapeia a fixture CSV corretamente', () => {
    const r = parseCsv(csvBuffer());
    const mapa = sugestoesParaMapeamento(sugerirMapeamento(r.cabecalhos));

    expect(mapa.nome).toBe('Nome');
    expect(mapa.categoria).toBe('Categoria');
    expect(mapa.telefone).toBe('Telefone');
    expect(mapa.endereco).toBe('Endereço');
    expect(mapa.bairro).toBe('Bairro');
    expect(mapa.cidade).toBe('Cidade');
    expect(mapa.website).toBe('Website');
    expect(mapa.avaliacao).toBe('Avaliação');
    expect(mapa.totalAvaliacoes).toBe('Número de avaliações');
  });
});

describe('sugerirMapeamento — cabecalhos em ingles', () => {
  it('mapeia a fixture XLSX corretamente', async () => {
    const r = await parseXlsx(xlsxBuffer());
    const mapa = sugestoesParaMapeamento(sugerirMapeamento(r.cabecalhos));

    expect(mapa.nome).toBe('Name');
    expect(mapa.categoria).toBe('Category');
    expect(mapa.telefone).toBe('Phone');
    expect(mapa.endereco).toBe('Address');
    expect(mapa.bairro).toBe('Neighborhood');
    expect(mapa.cidade).toBe('City');
    expect(mapa.website).toBe('Website');
    expect(mapa.avaliacao).toBe('Rating');
    expect(mapa.totalAvaliacoes).toBe('Review count');
  });
});

describe('sugerirMapeamento — casos dificeis', () => {
  it('nao confunde "Avaliação" com "Número de avaliações"', () => {
    const mapa = sugestoesParaMapeamento(
      sugerirMapeamento(['Número de avaliações', 'Avaliação'])
    );
    expect(mapa.totalAvaliacoes).toBe('Número de avaliações');
    expect(mapa.avaliacao).toBe('Avaliação');
  });

  it('nao atribui o mesmo campo a duas colunas', () => {
    const sugestoes = sugerirMapeamento(['Nome', 'Name', 'Título']);
    const comCampoNome = sugestoes.filter((s) => s.campo === 'nome');
    expect(comCampoNome.length).toBe(1);
  });

  it('deixa coluna desconhecida sem mapeamento em vez de chutar', () => {
    const sugestoes = sugerirMapeamento(['Coluna Estranha XPTO']);
    expect(sugestoes[0]!.campo).toBeNull();
  });

  it('lida com colunas ausentes — nao assume que todas existem', () => {
    const mapa = sugestoesParaMapeamento(sugerirMapeamento(['Nome', 'Telefone']));
    expect(mapa.nome).toBe('Nome');
    expect(mapa.website).toBeUndefined();
    expect(mapa.bairro).toBeUndefined();
  });
});

describe('aplicarMapeamento', () => {
  it('extrai os valores mapeados', () => {
    const linha = { Nome: 'Maria', Telefone: '(19) 99999-1111', Outra: 'ignorar' };
    const r = aplicarMapeamento(linha, { nome: 'Nome', telefone: 'Telefone' });
    expect(r.nome).toBe('Maria');
    expect(r.telefone).toBe('(19) 99999-1111');
  });

  it('campos sem coluna viram null, nunca string vazia', () => {
    const r = aplicarMapeamento({ Nome: 'Maria' }, { nome: 'Nome' });
    expect(r.website).toBeNull();
    expect(r.bairro).toBeNull();
  });

  it('celula vazia vira null', () => {
    const r = aplicarMapeamento({ Nome: '   ' }, { nome: 'Nome' });
    expect(r.nome).toBeNull();
  });
});
