/**
 * Testes das fontes de lead (Fase P).
 *
 * A interface existe para que trocar a origem dos leads nao obrigue a
 * mexer na regra de negocio. Estes testes verificam justamente isso: as
 * duas fontes devolvem a MESMA forma de resultado.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CsvLeadSource,
  XlsxLeadSource,
  FONTES_DISPONIVEIS,
  escolherFonte,
} from '../packages/integrations/src/sources/arquivo-lead-source.js';
import { ErroParse } from '../packages/integrations/src/import/parser.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSV = readFileSync(path.join(raiz, 'tests/fixtures/leads.csv'));

describe('escolherFonte', () => {
  it('escolhe CSV pela extensao', () => {
    expect(escolherFonte({ buffer: CSV, nomeArquivo: 'leads.csv' }).id).toBe('csv');
  });

  it('escolhe XLSX pela extensao', () => {
    expect(
      escolherFonte({ buffer: Buffer.alloc(0), nomeArquivo: 'planilha.xlsx' }).id
    ).toBe('xlsx');
  });

  it('nao se importa com maiusculas na extensao', () => {
    expect(escolherFonte({ buffer: CSV, nomeArquivo: 'LEADS.CSV' }).id).toBe('csv');
  });

  it('explica o formato nao suportado em vez de devolver null', () => {
    expect(() =>
      escolherFonte({ buffer: Buffer.alloc(0), nomeArquivo: 'contatos.pdf' })
    ).toThrow(ErroParse);
    expect(() =>
      escolherFonte({ buffer: Buffer.alloc(0), nomeArquivo: 'contatos.pdf' })
    ).toThrow(/\.csv ou \.xlsx/);
  });
});

describe('CsvLeadSource', () => {
  it('le o arquivo e devolve cabecalhos e linhas', async () => {
    const r = await new CsvLeadSource().ler({ buffer: CSV, nomeArquivo: 'leads.csv' });

    expect(r.cabecalhos).toContain('Nome');
    expect(r.cabecalhos).toContain('Telefone');
    expect(r.linhas.length).toBe(10);
    expect(r.metadados['formato']).toBe('csv');
  });

  it('campo vazio vira null, nunca um palpite', async () => {
    const r = await new CsvLeadSource().ler({ buffer: CSV, nomeArquivo: 'leads.csv' });
    const semTelefone = r.linhas.find((l) => l['Nome'] === 'Consultório Sem Telefone');

    expect(semTelefone?.['Telefone']).toBeNull();
    expect(semTelefone?.['Website']).toBeNull();
  });

  it('suporta() diz nao para xlsx', () => {
    const fonte = new CsvLeadSource();
    expect(fonte.suporta({ buffer: CSV, nomeArquivo: 'x.xlsx' })).toBe(false);
  });
});

describe('contrato comum das fontes', () => {
  it('toda fonte tem id e rotulo preenchidos', () => {
    for (const f of FONTES_DISPONIVEIS) {
      expect(f.id).toMatch(/\S/);
      expect(f.rotulo).toMatch(/\S/);
    }
  });

  it('os ids sao unicos — eles vao para Lead.origem', () => {
    const ids = FONTES_DISPONIVEIS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('o resultado tem sempre a mesma forma, seja qual for a fonte', async () => {
    const r = await new CsvLeadSource().ler({ buffer: CSV, nomeArquivo: 'leads.csv' });

    expect(Object.keys(r).sort()).toEqual(
      ['avisos', 'cabecalhos', 'linhas', 'metadados'].sort()
    );
    expect(Array.isArray(r.avisos)).toBe(true);
  });

  /**
   * Guarda de escopo: scraping do Google Maps e decisao de produto, com
   * custo juridico e operacional proprio. Se um dia alguem adicionar uma
   * fonte dessas sem autorizacao, este teste avisa.
   */
  it('nenhuma fonte de scraping esta habilitada', () => {
    const ids = FONTES_DISPONIVEIS.map((f) => f.id);
    expect(ids).toEqual(['csv', 'xlsx']);
    expect(ids.some((i) => /maps|google|scrap/i.test(i))).toBe(false);
  });
});

describe('XlsxLeadSource', () => {
  it('recusa buffer que nao e xlsx com mensagem legivel', async () => {
    await expect(
      new XlsxLeadSource().ler({ buffer: CSV, nomeArquivo: 'falso.xlsx' })
    ).rejects.toThrow(ErroParse);
  });
});
