/**
 * Sobe uma SEGUNDA copia da ferramenta, isolada da primeira.
 *
 * ============================================================
 * POR QUE ISTO E UM COMANDO, E NAO UMA RECEITA
 * ============================================================
 * A receita manual tem cinco variaveis de ambiente, um banco para
 * criar, uma migracao e um seed. Em uso real ela falhou duas vezes
 * seguidas, e por motivos que nao tem nada a ver com a ferramenta:
 *
 *   1. as linhas foram coladas no CMD, onde `$env:VAR="x"` nao existe —
 *      o terminal respondeu "O nome do diretorio esta incorreto" cinco
 *      vezes e subiu tudo no padrao, com os dois workers na mesma fila;
 *   2. o `USUARIO:SENHA` do exemplo foi colado literal, e o Postgres
 *      recusou o login.
 *
 * Os dois erros sao de digitacao, e nenhum deles aparece como erro: a
 * ferramenta sobe, parecendo uma copia nova, usando o banco da outra.
 * Um comando que le a credencial do proprio `.env` e define as
 * variaveis sozinho nao tem como errar nisso.
 *
 * ============================================================
 * O QUE PRECISA SER DIFERENTE, E POR QUE
 * ============================================================
 * DATABASE_URL  leads e campanhas proprios.
 * REDIS_DB      fila, estado do canal, QR e trava. SEM ISTO os dois
 *               workers consomem a MESMA fila: a mensagem de uma copia
 *               pode sair pelo numero da outra, ou sair duas vezes.
 * API_PORT      3333 ja esta em uso.
 * WEB_PORT      5173 idem.
 * WHATSAPP_SESSION_PATH  cada copia pareia o seu numero.
 *
 * Uso:
 *   pnpm copia brasil
 *   pnpm copia brasil --so-preparar   (cria banco e migra, sem subir)
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });

/** O numero do banco do Redis e as portas, por copia. */
const COPIAS: Record<string, { redisDb: number; api: number; web: number }> = {
  brasil: { redisDb: 1, api: 3334, web: 5174 },
  copia2: { redisDb: 2, api: 3335, web: 5175 },
  copia3: { redisDb: 3, api: 3336, web: 5176 },
};

function erro(mensagem: string): never {
  console.error(`\n  ${mensagem}\n`);
  process.exit(1);
}

/**
 * Troca o nome do banco na URL, preservando usuario, senha e opcoes.
 *
 * E aqui que a credencial do `.env` e reaproveitada: ela nunca e
 * digitada de novo, entao nao ha como colar `USUARIO:SENHA` por engano.
 */
function urlComOutroBanco(url: string, sufixo: string): string {
  const u = new URL(url);
  const nome = u.pathname.replace(/^\//, '') || 'prospector';
  u.pathname = `/${nome}_${sufixo}`;
  return u.toString();
}

function main(): void {
  const nome = (process.argv[2] ?? '').trim().toLowerCase();
  const soPreparar = process.argv.includes('--so-preparar');

  const copia = COPIAS[nome];
  if (!copia) {
    erro(
      `Uso: pnpm copia <${Object.keys(COPIAS).join('|')}> [--so-preparar]\n` +
        `  Ex: pnpm copia brasil`
    );
  }

  const original = process.env.DATABASE_URL;
  if (!original) erro('DATABASE_URL nao esta no .env — nao sei de qual banco copiar a credencial.');

  const bancoDaCopia = urlComOutroBanco(original, nome);
  const nomeDoBanco = new URL(bancoDaCopia).pathname.replace(/^\//, '');

  const ambiente = {
    ...process.env,
    DATABASE_URL: bancoDaCopia,
    REDIS_DB: String(copia.redisDb),
    API_PORT: String(copia.api),
    WEB_PORT: String(copia.web),
    WHATSAPP_SESSION_PATH: `./data/whatsapp-${nome}`,
  };

  console.log('');
  console.log('='.repeat(64));
  console.log(`  COPIA: ${nome}`);
  console.log('='.repeat(64));
  console.log(`  banco ............ ${nomeDoBanco}`);
  console.log(`  redis ............ banco ${copia.redisDb}`);
  console.log(`  tela ............. http://localhost:${copia.web}`);
  console.log(`  api .............. http://127.0.0.1:${copia.api}`);
  console.log(`  sessao ........... ./data/whatsapp-${nome}`);
  console.log('');

  // --- 1. O banco precisa existir: o Prisma nao cria sozinho ---
  const manutencao = new URL(bancoDaCopia);
  manutencao.pathname = '/postgres';

  console.log('  Criando o banco (se ainda nao existir)...');
  const criacao = spawnSync(
    'npx',
    ['prisma', 'db', 'execute', '--url', manutencao.toString(), '--stdin'],
    {
      cwd: path.join(raiz, 'packages', 'database'),
      input: `CREATE DATABASE ${nomeDoBanco};`,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }
  );

  const saida = `${criacao.stdout ?? ''}${criacao.stderr ?? ''}`;
  if (criacao.status !== 0 && !/already exists|ja existe/i.test(saida)) {
    console.error(saida.trim());
    erro('Nao consegui criar o banco. O Postgres esta rodando?');
  }
  console.log(/already exists|ja existe/i.test(saida) ? '  Ja existia.' : '  Criado.');

  // --- 2. Estrutura e usuario de acesso ---
  for (const [rotulo, script] of [
    ['Aplicando as migracoes', 'db:migrate:deploy'],
    ['Criando o usuario de acesso', 'db:seed'],
  ] as const) {
    console.log(`  ${rotulo}...`);
    const r = spawnSync('pnpm', [script], {
      cwd: raiz,
      env: ambiente,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (r.status !== 0) erro(`Falhou em: ${rotulo.toLowerCase()}.`);
  }

  if (soPreparar) {
    console.log('');
    console.log(`  Pronto. Para subir:  pnpm copia ${nome}`);
    console.log('');
    return;
  }

  // --- 3. Sobe, ja com o ambiente certo ---
  console.log('');
  console.log(`  Subindo. A tela abre em http://localhost:${copia.web}`);
  console.log('  Deixe esta janela aberta. Ctrl+C encerra esta copia.');
  console.log('');

  const dev = spawn('pnpm', ['dev'], {
    cwd: raiz,
    env: ambiente,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  dev.on('exit', (codigo) => process.exit(codigo ?? 0));
}

main();
