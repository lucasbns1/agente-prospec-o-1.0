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

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

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
