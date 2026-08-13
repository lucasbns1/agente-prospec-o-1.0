/**
 * Fontes de lead baseadas em arquivo (Fase P).
 *
 * `CsvLeadSource` e `XlsxLeadSource` sao finas de proposito: elas apenas
 * vestem o parser que ja existe com o contrato `ILeadSource`. Duplicar a
 * logica de leitura aqui criaria dois lugares para consertar o mesmo bug
 * de encoding.
 */
import {
  parseCsv,
  parseXlsx,
  detectarFormato,
  ErroParse,
  type ResultadoParse,
} from '../import/parser.js';
import type {
  ILeadSource,
  EntradaArquivo,
  ResultadoLeitura,
} from './lead-source.js';

/** Traduz o resultado do parser para o formato comum das fontes. */
function paraResultadoLeitura(r: ResultadoParse): ResultadoLeitura {
  return {
    cabecalhos: r.cabecalhos,
    linhas: r.linhas,
    avisos: r.avisos,
    metadados: {
      formato: r.formato,
      ...(r.delimitador ? { delimitador: r.delimitador } : {}),
      ...(r.planilhaUsada ? { planilhaUsada: r.planilhaUsada } : {}),
      ...(r.planilhasDisponiveis
        ? { planilhasDisponiveis: r.planilhasDisponiveis }
        : {}),
    },
  };
}

export class CsvLeadSource implements ILeadSource<EntradaArquivo> {
  readonly id = 'csv';
  readonly rotulo = 'Arquivo CSV';

  suporta(entrada: EntradaArquivo): boolean {
    return detectarFormato(entrada.nomeArquivo) === 'csv';
  }

  async ler(entrada: EntradaArquivo): Promise<ResultadoLeitura> {
    return paraResultadoLeitura(parseCsv(entrada.buffer));
  }
}

export class XlsxLeadSource implements ILeadSource<EntradaArquivo> {
  readonly id = 'xlsx';
  readonly rotulo = 'Planilha Excel (.xlsx)';

  suporta(entrada: EntradaArquivo): boolean {
    return detectarFormato(entrada.nomeArquivo) === 'xlsx';
  }

  async ler(entrada: EntradaArquivo): Promise<ResultadoLeitura> {
    return paraResultadoLeitura(await parseXlsx(entrada.buffer));
  }
}

/**
 * Fontes disponiveis HOJE.
 *
 * Google Maps NAO esta aqui, e nao deve ser adicionado sem autorizacao
 * explicita — ver o cabecalho de `lead-source.ts`.
 */
export const FONTES_DISPONIVEIS: ReadonlyArray<ILeadSource<EntradaArquivo>> = [
  new CsvLeadSource(),
  new XlsxLeadSource(),
];

/**
 * Escolhe a fonte capaz de ler a entrada.
 *
 * Lanca `ErroParse` — e nao devolve `null` — porque quem chama nao tem o
 * que fazer com um arquivo que ninguem sabe ler, e a mensagem precisa
 * chegar ao usuario.
 */
export function escolherFonte(
  entrada: EntradaArquivo
): ILeadSource<EntradaArquivo> {
  const fonte = FONTES_DISPONIVEIS.find((f) => f.suporta(entrada));
  if (!fonte) {
    throw new ErroParse(
      `Formato não suportado: "${entrada.nomeArquivo}". Use um arquivo .csv ou .xlsx.`
    );
  }
  return fonte;
}
