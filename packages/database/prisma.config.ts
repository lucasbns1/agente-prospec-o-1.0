/**
 * Configuracao do Prisma CLI.
 *
 * POR QUE ESTE ARQUIVO EXISTE:
 * O `.env` do projeto fica na RAIZ do monorepo (um unico arquivo de
 * configuracao para API, worker e banco). O Prisma CLI, porem, procura o
 * `.env` na pasta onde o schema esta — e nao encontraria nada.
 *
 * Aqui carregamos o `.env` da raiz explicitamente antes de qualquer
 * comando (`migrate`, `studio`, `db push`). Isso tambem substitui a
 * chave `package.json#prisma`, que sera removida no Prisma 7.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as carregarDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

const aqui = path.dirname(fileURLToPath(import.meta.url));

carregarDotenv({ path: path.resolve(aqui, '../../.env') });

export default defineConfig({
  schema: path.join(aqui, 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(aqui, 'prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
