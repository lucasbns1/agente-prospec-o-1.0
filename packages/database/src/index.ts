/**
 * Cliente Prisma compartilhado.
 *
 * Instancia unica (singleton). Em desenvolvimento o hot-reload recria o
 * modulo varias vezes; sem o cache no globalThis o processo abriria uma
 * conexao nova a cada reload ate estourar o pool do Postgres.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Colisao de UNIQUE nao e um erro NESTE sistema — e o desenho.
 *
 * ============================================================
 * POR QUE ELA PRECISA PARAR DE APARECER COMO ERRO
 * ============================================================
 * A idempotencia inteira do projeto se apoia em `UNIQUE` + `catch
 * P2002`. Nunca `findUnique` seguido de `create`: esse par tem uma
 * janela de corrida no meio, e foi por confiar nele que 46 leads
 * viraram QUENTE de uma vez. Deixar o banco recusar e a decisao, nao o
 * acidente.
 *
 * So que o Prisma IMPRIME a excecao antes de entrega-la ao `catch`. Num
 * worker que reavalia dezenas de leads a cada quinze segundos, isso
 * enche a tela de blocos vermelhos de dez linhas para cada recusa
 * correta — e afoga a linha que importa. Aconteceu de verdade: a
 * mensagem da varredura do WhatsApp ficou impossivel de achar no meio
 * do despejo, e o diagnostico travou por causa disso.
 *
 * ============================================================
 * O QUE ISTO NAO FAZ
 * ============================================================
 * Nao engole a excecao. Ela continua sendo lancada, continua chegando
 * ao `catch` de quem chamou, e um P2002 que ninguem tratar continua
 * derrubando o job com o rastro completo. O que some e so a IMPRESSAO
 * duplicada, que nunca acrescentou nada ao que o codigo ja fazia.
 *
 * E a informacao nao se perde: o despachante agora conta essas recusas
 * e publica `paradosNaMesmaEtapa` numa linha so, que e onde ela
 * finalmente da para ler.
 *
 * Todo o resto — conexao, timeout, chave estrangeira, coluna faltando —
 * continua sendo impresso normalmente.
 */
function ehColisaoDeUnique(mensagem: unknown): boolean {
  return (
    typeof mensagem === 'string' && mensagem.includes('Unique constraint failed')
  );
}

function criarCliente(): PrismaClient {
  // `emit: 'event'` em vez do padrao 'stdout': e o que permite escolher
  // o que merece tela. Com 'stdout' o Prisma imprime tudo e nao ha
  // filtro possivel.
  const cliente = new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      ...(process.env.NODE_ENV === 'development'
        ? [{ emit: 'event' as const, level: 'warn' as const }]
        : []),
    ],
  });

  const emissor = cliente as unknown as {
    $on: (evento: string, cb: (e: { message?: unknown }) => void) => void;
  };

  emissor.$on('error', (e) => {
    if (ehColisaoDeUnique(e?.message)) return;
    console.error(e);
  });

  emissor.$on('warn', (e) => {
    console.warn(e);
  });

  return cliente;
}

export const prisma = globalForPrisma.prisma ?? criarCliente();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/** Fecha a conexao. Chamado no shutdown da API e do worker. */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

/** Verifica se o banco responde. Usado pelo /api/health. */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// Reexporta tipos e enums gerados, para os outros packages nao precisarem
// depender de @prisma/client diretamente.
export * from '@prisma/client';
export { PrismaClient } from '@prisma/client';

// --- Reconciliacao (Fase 9) ---
//
// A CONSULTA mora aqui, e nao no worker, porque a API tambem precisa
// dela e os dois apps nao se importam. Quem DECIDE o que e problema e
// `detectarInconsistencias`, funcao pura em @prospector/domain.
export * from './reconciliacao.js';
