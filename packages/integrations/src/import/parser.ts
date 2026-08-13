/**
 * Leitura de CSV e XLSX.
 *
 * Responsabilidade unica: transformar bytes em `{ cabecalhos, linhas }`.
 * Nao normaliza, nao classifica, nao decide nada de negocio — isso e do
 * `@prospector/domain`.
 *
 * CSV: papaparse, com deteccao de delimitador e de BOM.
 * XLSX: exceljs (mantido e MIT; a versao npm do SheetJS esta desatualizada
 * e teve CVEs, e a nova saiu do registro publico).
 */
import Papa from 'papaparse';
import ExcelJS from 'exceljs';

export type FormatoArquivo = 'csv' | 'xlsx';

export interface ResultadoParse {
  cabecalhos: string[];
  /** Cada linha como `{ cabecalho: valor }`. Valores sempre string ou null. */
  linhas: Array<Record<string, string | null>>;
  formato: FormatoArquivo;
  /** Delimitador detectado (apenas CSV). */
  delimitador?: string;
  /** Nome da planilha lida (apenas XLSX). */
  planilhaUsada?: string;
  /** Todas as planilhas do arquivo (apenas XLSX). */
  planilhasDisponiveis?: string[];
  /** Problemas nao-fatais encontrados durante a leitura. */
  avisos: string[];
}

export class ErroParse extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroParse';
  }
}

/** Limite de linhas por arquivo. Protege memoria e tempo de resposta. */
export const MAX_LINHAS = 20_000;

/**
 * Remove o BOM de UTF-8.
 * Sem isso o primeiro cabecalho vira "﻿Nome" e nunca casa no
 * mapeamento — falha silenciosa classica de CSV exportado no Windows.
 */
function removerBom(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

/**
 * Detecta o delimitador.
 *
 * Papaparse detecta sozinho, mas erra com frequencia quando o arquivo
 * tem poucas linhas ou muitos campos entre aspas. Contamos ocorrencias
 * fora de aspas no cabecalho, que e mais confiavel.
 */
export function detectarDelimitador(texto: string): string {
  const primeiraLinha = removerBom(texto).split(/\r?\n/)[0] ?? '';

  const contar = (delim: string): number => {
    let count = 0;
    let dentroDeAspas = false;
    for (const ch of primeiraLinha) {
      if (ch === '"') dentroDeAspas = !dentroDeAspas;
      else if (ch === delim && !dentroDeAspas) count++;
    }
    return count;
  };

  const candidatos: Array<[string, number]> = [
    [',', contar(',')],
    [';', contar(';')],
    ['\t', contar('\t')],
    ['|', contar('|')],
  ];

  candidatos.sort((a, b) => b[1] - a[1]);
  const vencedor = candidatos[0]!;
  // Nenhum delimitador encontrado: assume virgula (arquivo de 1 coluna).
  return vencedor[1] > 0 ? vencedor[0] : ',';
}

/** Decodifica os bytes, tentando UTF-8 e caindo para latin1 se preciso. */
export function decodificar(buffer: Buffer): { texto: string; aviso?: string } {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);

  // U+FFFD indica byte invalido em UTF-8. Muito comum em CSV salvo pelo
  // Excel em portugues, que usa windows-1252.
  if (utf8.includes('�')) {
    const latin1 = new TextDecoder('windows-1252').decode(buffer);
    return {
      texto: latin1,
      aviso:
        'Arquivo nao estava em UTF-8; lido como Windows-1252. Confira os acentos na prévia.',
    };
  }

  return { texto: utf8 };
}

export function parseCsv(buffer: Buffer): ResultadoParse {
  const avisos: string[] = [];
  const { texto: bruto, aviso } = decodificar(buffer);
  if (aviso) avisos.push(aviso);

  const texto = removerBom(bruto);
  if (texto.trim() === '') throw new ErroParse('O arquivo CSV está vazio.');

  const delimitador = detectarDelimitador(texto);

  const resultado = Papa.parse<Record<string, string>>(texto, {
    header: true,
    delimiter: delimitador,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });

  if (resultado.errors.length > 0) {
    // Erros de papaparse costumam ser por linha e nao invalidam o
    // arquivo inteiro. Reportamos os primeiros e seguimos.
    const primeiros = resultado.errors.slice(0, 3);
    for (const e of primeiros) {
      avisos.push(
        `Linha ${(e.row ?? 0) + 2}: ${e.message}`
      );
    }
    if (resultado.errors.length > 3) {
      avisos.push(`... e mais ${resultado.errors.length - 3} problema(s) de formatação.`);
    }
  }

  const cabecalhos = (resultado.meta.fields ?? []).filter((c) => c.trim() !== '');
  if (cabecalhos.length === 0) {
    throw new ErroParse('Não foi possível identificar o cabeçalho do CSV.');
  }

  const linhas = resultado.data
    .slice(0, MAX_LINHAS)
    .map((linha) => normalizarValores(linha, cabecalhos))
    .filter((l) => Object.values(l).some((v) => v !== null));

  if (resultado.data.length > MAX_LINHAS) {
    avisos.push(
      `Arquivo tem ${resultado.data.length} linhas; apenas as primeiras ${MAX_LINHAS} foram lidas.`
    );
  }

  return { cabecalhos, linhas, formato: 'csv', delimitador, avisos };
}

export async function parseXlsx(buffer: Buffer): Promise<ResultadoParse> {
  const avisos: string[] = [];
  const workbook = new ExcelJS.Workbook();

  try {
    // O tipo do exceljs pede ArrayBuffer; Buffer e aceito em runtime.
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ErroParse(
      'Não foi possível ler o arquivo XLSX. Ele está corrompido ou não é um Excel válido.'
    );
  }

  const planilhasDisponiveis = workbook.worksheets.map((w) => w.name);
  if (planilhasDisponiveis.length === 0) {
    throw new ErroParse('O arquivo XLSX não contém nenhuma planilha.');
  }

  const planilha = workbook.worksheets[0]!;
  if (planilhasDisponiveis.length > 1) {
    avisos.push(
      `O arquivo tem ${planilhasDisponiveis.length} planilhas (${planilhasDisponiveis.join(', ')}). ` +
        `Foi usada a primeira: "${planilha.name}".`
    );
  }

  const linhaCabecalho = planilha.getRow(1);
  const cabecalhos: string[] = [];
  linhaCabecalho.eachCell({ includeEmpty: false }, (cell, col) => {
    const texto = celulaParaTexto(cell.value);
    cabecalhos[col - 1] = texto?.trim() ?? `Coluna ${col}`;
  });

  const cabecalhosLimpos = cabecalhos.filter((c) => c != null && c.trim() !== '');
  if (cabecalhosLimpos.length === 0) {
    throw new ErroParse('A primeira linha da planilha não contém cabeçalhos.');
  }

  const linhas: Array<Record<string, string | null>> = [];

  planilha.eachRow({ includeEmpty: false }, (row, numero) => {
    if (numero === 1) return; // cabecalho
    if (linhas.length >= MAX_LINHAS) return;

    const registro: Record<string, string | null> = {};
    let temAlgumValor = false;

    for (let col = 1; col <= cabecalhos.length; col++) {
      const cabecalho = cabecalhos[col - 1];
      if (!cabecalho) continue;
      const texto = celulaParaTexto(row.getCell(col).value);
      registro[cabecalho] = texto;
      if (texto !== null) temAlgumValor = true;
    }

    if (temAlgumValor) linhas.push(registro);
  });

  if (planilha.rowCount - 1 > MAX_LINHAS) {
    avisos.push(
      `Planilha tem ${planilha.rowCount - 1} linhas; apenas as primeiras ${MAX_LINHAS} foram lidas.`
    );
  }

  return {
    cabecalhos: cabecalhosLimpos,
    linhas,
    formato: 'xlsx',
    planilhaUsada: planilha.name,
    planilhasDisponiveis,
    avisos,
  };
}

/**
 * Converte o valor de uma celula do exceljs em texto.
 * O exceljs devolve tipos ricos (formula, hyperlink, rich text) que
 * precisam ser desembrulhados — sem isso um link vira "[object Object]".
 */
function celulaParaTexto(valor: ExcelJS.CellValue): string | null {
  if (valor == null) return null;

  if (typeof valor === 'string') {
    const t = valor.trim();
    return t === '' ? null : t;
  }
  if (typeof valor === 'number' || typeof valor === 'boolean') {
    return String(valor);
  }
  if (valor instanceof Date) return valor.toISOString();

  if (typeof valor === 'object') {
    // Formula: preferimos o resultado calculado.
    if ('result' in valor && valor.result != null) {
      return celulaParaTexto(valor.result as ExcelJS.CellValue);
    }
    // Hyperlink: o texto visivel e o que interessa; o alvo esta em .hyperlink.
    if ('text' in valor && valor.text != null) {
      const t = String(valor.text).trim();
      return t === '' ? null : t;
    }
    if ('hyperlink' in valor && valor.hyperlink != null) {
      return String(valor.hyperlink);
    }
    // Rich text: concatena os fragmentos.
    if ('richText' in valor && Array.isArray(valor.richText)) {
      const t = valor.richText.map((r) => r.text).join('').trim();
      return t === '' ? null : t;
    }
    if ('error' in valor) return null;
  }

  return null;
}

function normalizarValores(
  linha: Record<string, unknown>,
  cabecalhos: string[]
): Record<string, string | null> {
  const saida: Record<string, string | null> = {};
  for (const c of cabecalhos) {
    const v = linha[c];
    if (v == null) {
      saida[c] = null;
      continue;
    }
    const t = String(v).trim();
    saida[c] = t === '' ? null : t;
  }
  return saida;
}

/** Detecta o formato pelo nome do arquivo. */
export function detectarFormato(nomeArquivo: string): FormatoArquivo | null {
  const lower = nomeArquivo.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return null;
}

/** Ponto de entrada unico do parser. */
export async function parseArquivo(
  buffer: Buffer,
  nomeArquivo: string
): Promise<ResultadoParse> {
  const formato = detectarFormato(nomeArquivo);
  if (formato === null) {
    throw new ErroParse(
      `Formato não suportado: "${nomeArquivo}". Use um arquivo .csv ou .xlsx.`
    );
  }
  return formato === 'csv' ? parseCsv(buffer) : parseXlsx(buffer);
}
