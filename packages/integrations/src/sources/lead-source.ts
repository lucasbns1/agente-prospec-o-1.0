/**
 * ILeadSource — de onde os leads podem vir (Fase P).
 *
 * ============================================================
 * O QUE ESTA INTERFACE RESOLVE
 * ============================================================
 * Hoje os leads chegam por arquivo (CSV/XLSX exportado do Instant Data
 * Scraper). Amanha podem chegar de outro lugar. Sem uma fronteira, o
 * servico de importacao ficaria amarrado ao formato de arquivo, e
 * trocar a origem obrigaria a mexer no meio da regra de negocio.
 *
 * Com a interface, quem consome recebe sempre a mesma coisa —
 * `LinhaBruta[]` — e nao precisa saber se veio de um .csv, de um .xlsx
 * ou de outro lugar.
 *
 * ============================================================
 * O QUE ESTA INTERFACE **NAO** FAZ
 * ============================================================
 * NAO existe implementacao de scraping do Google Maps aqui, e nao deve
 * existir sem autorizacao explicita. Scraping do Maps tem custo
 * juridico e operacional proprio (termos de uso, bloqueio de IP,
 * necessidade de navegador headless) e e uma decisao de produto, nao um
 * detalhe tecnico.
 *
 * A interface esta preparada para receber uma fonte assim no futuro. Ela
 * nao a implementa nem a habilita.
 *
 * ============================================================
 * NENHUMA FONTE INVENTA DADO
 * ============================================================
 * Uma fonte devolve o que leu, cru. Campo ausente vira `null`, nunca um
 * palpite. Normalizacao, deducao e deduplicacao acontecem depois, no
 * dominio, onde sao testaveis.
 */

/** Uma linha lida da origem, ainda sem normalizacao. */
export type LinhaBruta = Record<string, string | null>;

export interface ResultadoLeitura {
  /** Nomes das colunas, na ordem em que apareceram. */
  cabecalhos: string[];
  linhas: LinhaBruta[];
  /** Problemas nao-fatais. Nunca silenciados. */
  avisos: string[];
  /** Informacao especifica da fonte, para exibir na tela. */
  metadados: Record<string, unknown>;
}

/**
 * Contrato de uma origem de leads.
 *
 * `id` e estavel e serve para gravar em `Lead.origem` — assim da para
 * responder "de onde veio este lead?" meses depois.
 */
export interface ILeadSource<TEntrada = unknown> {
  readonly id: string;
  readonly rotulo: string;

  /**
   * true quando esta fonte sabe lidar com a entrada dada.
   *
   * Permite escolher a fonte certa sem `if` espalhado por quem chama.
   */
  suporta(entrada: TEntrada): boolean;

  /** Le a origem e devolve as linhas cruas. */
  ler(entrada: TEntrada): Promise<ResultadoLeitura>;
}

/** Entrada das fontes baseadas em arquivo. */
export interface EntradaArquivo {
  buffer: Buffer;
  nomeArquivo: string;
}
