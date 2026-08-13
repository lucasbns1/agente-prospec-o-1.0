/**
 * Quadro da campanha — em que coluna cada lead aparece.
 *
 * ============================================================
 * A PERGUNTA QUE O QUADRO RESPONDE
 * ============================================================
 * "Dos leads desta campanha, quem esta em qual mensagem, e quem esta
 * parado esperando por mim?"
 *
 * Uma lista unica de leads nao responde isso: voce teria que ler linha
 * por linha para descobrir onde cada um parou. Em colunas, a resposta e
 * a forma do quadro — uma coluna cheia no meio da sequencia significa
 * que aquela mensagem nao esta destravando ninguem.
 *
 * ============================================================
 * CADA LEAD APARECE EM EXATAMENTE UMA COLUNA
 * ============================================================
 * Esta e a regra que faz o quadro ser confiavel. Um lead que precisa de
 * intervencao TAMBEM tem uma etapa atual — se ele aparecesse nas duas
 * colunas, a soma das colunas passaria do total de leads e nenhum numero
 * da tela poderia ser levado a serio.
 *
 * A precedencia abaixo resolve isso. Ela nao e alfabetica nem arbitraria:
 * vai do mais urgente para o menos.
 *
 * ============================================================
 * NADA AQUI TOCA O BANCO
 * ============================================================
 * Entra o estado de um `LeadCampaign`, sai o nome da coluna. Por isso da
 * para testar todos os casos de borda sem subir nada.
 */

/** As colunas possiveis, em ordem de exibicao. */
export type TipoColuna = 'NA_FILA' | 'ETAPA' | 'PRECISA_DE_VOCE' | 'ENCERRADO';

/**
 * O minimo que precisa ser sabido de um lead para posiciona-lo.
 *
 * Deliberadamente menor que o modelo do Prisma: a funcao nao deve poder
 * consultar nada alem disto.
 */
export interface EstadoNaCampanha {
  /** `LeadCampaignStatus` do Prisma, como string. */
  status: string;
  /** Etapa em que o lead esta. `null` = ainda nao recebeu nada. */
  etapaAtualId: string | null;
}

export interface Posicao {
  tipo: TipoColuna;
  /** Preenchido apenas quando `tipo === 'ETAPA'`. */
  etapaId: string | null;
}

/**
 * Status que tiram o lead da sequencia. Ele nao volta sozinho de nenhum
 * destes: ou terminou, ou uma regra o interrompeu, ou ele pediu para
 * sair.
 */
// Exportadas porque a API filtra por coluna direto no banco (uma
// consulta por coluna, em vez de trazer todos os leads para a memoria).
// Se ela mantivesse a propria copia destas listas, as duas divergiriam
// no primeiro status novo — e a tela mostraria uma coisa e a contagem,
// outra. Ha teste garantindo que as listas e `posicaoNoQuadro` concordam.
export const STATUS_ENCERRADOS = ['CONCLUIDO', 'PARADO', 'OPT_OUT'] as const;

const ENCERRADOS = new Set<string>(STATUS_ENCERRADOS);

/**
 * Status em que a automacao esta suspensa esperando UMA PESSOA.
 *
 * `PAUSADO` entra aqui de proposito. Ele significa "voce suspendeu este
 * lead" — e um lead pausado exibido na coluna da etapa pareceria estar
 * andando, quando na verdade nao anda ate voce mexer.
 */
export const STATUS_ESPERANDO_VOCE = [
  'AGUARDANDO_INTERVENCAO',
  'PAUSADO',
] as const;

const ESPERANDO_VOCE = new Set<string>(STATUS_ESPERANDO_VOCE);

/**
 * Decide a coluna de um lead.
 *
 * Precedencia, do mais forte para o mais fraco:
 *
 *   1. ENCERRADO       — saiu da sequencia; nada mais e verdade sobre ele
 *   2. PRECISA_DE_VOCE — parado esperando uma pessoa
 *   3. NA_FILA         — nunca recebeu a primeira mensagem
 *   4. ETAPA           — andando normalmente
 *
 * 1 vem antes de 2 porque um lead que deu opt-out DEPOIS de cair em
 * intervencao nao precisa mais de voce: cobrar uma acao sua sobre ele
 * seria pedir para voce contatar quem pediu para nao ser contatado.
 */
export function posicaoNoQuadro(estado: EstadoNaCampanha): Posicao {
  if (ENCERRADOS.has(estado.status)) {
    return { tipo: 'ENCERRADO', etapaId: null };
  }

  if (ESPERANDO_VOCE.has(estado.status)) {
    return { tipo: 'PRECISA_DE_VOCE', etapaId: null };
  }

  // Sem etapa atual = a primeira mensagem ainda nao saiu. Colocar este
  // lead na coluna da etapa 1 diria que ele ja recebeu algo, que e
  // exatamente o contrario do que aconteceu.
  if (!estado.etapaAtualId) {
    return { tipo: 'NA_FILA', etapaId: null };
  }

  return { tipo: 'ETAPA', etapaId: estado.etapaAtualId };
}

/**
 * Chave estavel da coluna, para agrupar sem ambiguidade.
 *
 * As colunas de etapa precisam do id junto: sem ele, todas as etapas
 * colidiriam numa unica chave `ETAPA`.
 */
export function chaveDaColuna(p: Posicao): string {
  return p.tipo === 'ETAPA' ? `ETAPA:${p.etapaId}` : p.tipo;
}

/** Uma etapa, do ponto de vista do quadro. */
export interface EtapaDoQuadro {
  id: string;
  ordem: number;
  nome: string | null;
}

export interface ColunaDoQuadro {
  chave: string;
  tipo: TipoColuna;
  etapaId: string | null;
  titulo: string;
  /** Explica a coluna na tela. Vazio quando o titulo ja basta. */
  legenda: string;
}

/**
 * Monta a lista de colunas, na ordem em que aparecem na tela.
 *
 * As colunas existem mesmo vazias. Uma etapa sem ninguem e informacao:
 * significa que a sequencia trava antes dela — e uma coluna que some
 * quando zera esconde justamente o problema que voce esta procurando.
 */
export function montarColunas(etapas: EtapaDoQuadro[]): ColunaDoQuadro[] {
  const ordenadas = [...etapas].sort((a, b) => a.ordem - b.ordem);

  return [
    {
      chave: 'NA_FILA',
      tipo: 'NA_FILA',
      etapaId: null,
      titulo: 'Na fila',
      legenda: 'Ainda não receberam a primeira mensagem',
    },
    ...ordenadas.map((e) => ({
      chave: `ETAPA:${e.id}`,
      tipo: 'ETAPA' as const,
      etapaId: e.id,
      titulo: e.nome?.trim() || `Mensagem ${e.ordem}`,
      legenda: '',
    })),
    {
      chave: 'PRECISA_DE_VOCE',
      tipo: 'PRECISA_DE_VOCE',
      etapaId: null,
      titulo: 'Precisa de você',
      legenda: 'A automação parou e está esperando uma decisão sua',
    },
    {
      chave: 'ENCERRADO',
      tipo: 'ENCERRADO',
      etapaId: null,
      titulo: 'Encerrados',
      legenda: 'Concluíram a sequência, foram interrompidos ou pediram opt-out',
    },
  ];
}
