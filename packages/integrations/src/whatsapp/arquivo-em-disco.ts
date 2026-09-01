/**
 * O arquivo de mensagens, gravado em disco.
 *
 * ============================================================
 * O DEFEITO QUE ISTO CONSERTA
 * ============================================================
 * O pacote de historico do WhatsApp (`messaging-history.set`) chega UMA
 * vez: no pareamento. Numa reconexao o proprio Baileys diz o que vai
 * fazer, e nao e mandar de novo:
 *
 *   "Reconnection with existing sync data, skipping history sync wait."
 *
 * Eu tinha escrito, no provedor, que o arquivo ser so memoria "e tudo
 * bem, porque o que importa ja foi para o Postgres". Estava errado. O
 * que vai para o Postgres e o que a VARREDURA aproveitou; o resto do
 * historico existia apenas naquele processo. Na pratica: 2532 mensagens
 * em 484 conversas chegaram, o worker reiniciou, e a varredura seguinte
 * leu `conversasNoArquivo: 0`. O historico so voltaria parenado o
 * aparelho de novo.
 *
 * Com o arquivo em disco, o pacote que chega uma vez fica para sempre.
 *
 * ============================================================
 * POR QUE JSON SIMPLES BASTA
 * ============================================================
 * `MensagemProvedor` nao tem `Date`, `Map` nem `undefined` significativo
 * — e string, numero e booleano. Entao `JSON.stringify`/`parse` fazem a
 * volta inteira sem conversor nenhum, e nao ha o classico defeito de
 * data que volta como texto.
 *
 * A escrita e ATOMICA (arquivo temporario + rename). Sem isso, um worker
 * morto no meio da gravacao deixaria um JSON truncado — e o proximo
 * arranque perderia o historico inteiro justamente por causa da protecao
 * que existia para nao perde-lo.
 *
 * ============================================================
 * ARQUIVO ILEGIVEL NAO DERRUBA O WORKER
 * ============================================================
 * Ler devolve lista vazia em vez de lancar. Um historico perdido e ruim;
 * um worker que nao sobe e pior — sem ele nao ha canal, nem cadencia,
 * nem tela. E o proximo pareamento reconstroi o arquivo.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MensagemProvedor } from './provedor.js';

/** Onde o arquivo mora, dado o diretorio da sessao. */
export function caminhoDoArquivo(sessionPath: string): string {
  return join(sessionPath, 'arquivo-mensagens.json');
}

/**
 * Uma linha so vale se tiver o que a varredura usa.
 *
 * O filtro nao e paranoia: o formato pode mudar entre versoes nossas, e
 * uma linha antiga sem `timestamp` viraria `NaN` numa comparacao e
 * sumiria da varredura em silencio. Melhor descartar na leitura, onde da
 * para contar quantas caíram.
 */
function pareceMensagem(x: unknown): x is MensagemProvedor {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.from === 'string' &&
    typeof m.body === 'string' &&
    typeof m.timestamp === 'number' &&
    Number.isFinite(m.timestamp) &&
    typeof m.fromMe === 'boolean'
  );
}

export interface LeituraDoArquivo {
  mensagens: MensagemProvedor[];
  /** Quantas linhas o arquivo tinha e foram descartadas por formato. */
  descartadas: number;
  /** Por que veio vazio, quando veio. Vai para o log. */
  motivo?: string;
}

/** Le o arquivo. NUNCA lanca. */
export function carregarArquivo(caminho: string): LeituraDoArquivo {
  let bruto: string;
  try {
    bruto = readFileSync(caminho, 'utf8');
  } catch {
    // Nao existir e o caso normal do primeiro arranque, e nao um erro.
    return { mensagens: [], descartadas: 0, motivo: 'arquivo ainda nao existe' };
  }

  let dados: unknown;
  try {
    dados = JSON.parse(bruto);
  } catch {
    return { mensagens: [], descartadas: 0, motivo: 'json ilegivel' };
  }

  if (!Array.isArray(dados)) {
    return { mensagens: [], descartadas: 0, motivo: 'conteudo nao e uma lista' };
  }

  const mensagens: MensagemProvedor[] = [];
  let descartadas = 0;
  for (const linha of dados) {
    if (pareceMensagem(linha)) mensagens.push(linha);
    else descartadas += 1;
  }

  return { mensagens, descartadas };
}

/**
 * Grava o arquivo. Devolve se conseguiu.
 *
 * Tambem nao lanca: gravar o historico e acessorio, e uma falha de disco
 * nao pode derrubar o canal do WhatsApp.
 */
export function salvarArquivo(
  caminho: string,
  mensagens: MensagemProvedor[]
): boolean {
  const temporario = `${caminho}.tmp`;
  try {
    mkdirSync(dirname(caminho), { recursive: true });
    writeFileSync(temporario, JSON.stringify(mensagens), 'utf8');
    // O rename e a parte atomica: ou o arquivo antigo inteiro, ou o novo
    // inteiro. Nunca metade de um.
    renameSync(temporario, caminho);
    return true;
  } catch {
    return false;
  }
}
