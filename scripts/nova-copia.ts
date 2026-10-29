/**
 * Cria uma copia TOTALMENTE separada da ferramenta, numa pasta propria.
 *
 * ============================================================
 * POR QUE NAO BASTA TROCAR VARIAVEL DE AMBIENTE
 * ============================================================
 * A primeira tentativa foi rodar as duas copias da MESMA pasta, com
 * cinco variaveis definidas no terminal. Funciona — e falha de um jeito
 * silencioso e caro:
 *
 *   - no CMD, `$env:VAR="x"` nao existe: as cinco linhas falham e o
 *     `pnpm dev` sobe com tudo no padrao, as duas copias no mesmo banco
 *     e na mesma fila;
 *   - fechou a janela, perdeu as variaveis. Na pressa, sobe sem elas;
 *   - nada na tela denuncia: a copia parece nova e esta usando a outra.
 *
 * Cada um desses enganos custou horas. Uma pasta propria, com `.env`
 * proprio, acaba com a classe inteira: nao ha nada para lembrar, e
 * abrir a pasta errada e um erro visivel.
 *
 * ============================================================
 * O QUE FICA SEPARADO
 * ============================================================
 * Pasta, `.env`, node_modules, banco de dados, banco do Redis, portas,
 * pasta de sessao do WhatsApp e historico de mensagens.
 *
 * O que continua compartilhado e so o SERVIDOR do Postgres e o do
 * Redis — duas copias usam bancos diferentes dentro deles, que e o
 * mesmo isolamento de ter dois servidores, sem instalar nada a mais.
 *
 * Uso:
 *   pnpm nova-copia brasil
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Portas e banco do Redis por copia — nunca repetidos. */
const COPIAS: Record<string, { redisDb: number; api: number; web: number }> = {
  brasil: { redisDb: 1, api: 3334, web: 5174 },
  copia2: { redisDb: 2, api: 3335, web: 5175 },
  copia3: { redisDb: 3, api: 3336, web: 5176 },
};

function erro(mensagem: string): never {
  console.error(`\n  ${mensagem}\n`);
  process.exit(1);
}

function rodar(comando: string, args: string[], cwd: string, env = process.env): void {
  const r = spawnSync(comando, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) erro(`Falhou: ${comando} ${args.join(' ')}`);
}

/**
 * Reescreve as chaves no `.env` da copia, preservando o resto.
 *
 * O resto importa: senha do banco, chave do Gemini, limites. Gerar um
 * `.env` do zero faria a copia nova nascer sem metade da configuracao.
 */
function escreverEnv(origem: string, destino: string, valores: Record<string, string>): void {
  const linhas = readFileSync(origem, 'utf8').split(/\r?\n/);
  const pendentes = new Set(Object.keys(valores));

  const saida = linhas.map((linha) => {
    const chave = /^([A-Z0-9_]+)=/.exec(linha)?.[1];
    if (chave && chave in valores) {
      pendentes.delete(chave);
      return `${chave}=${valores[chave]}`;
    }
    return linha;
  });

  // As que nao existiam no original entram no fim, com um porque.
  if (pendentes.size > 0) {
    saida.push('');
    saida.push('# --- Separacao desta copia (criado por `pnpm nova-copia`) ---');
    for (const chave of pendentes) saida.push(`${chave}=${valores[chave]}`);
  }

  writeFileSync(destino, saida.join('\n'), 'utf8');
}

function main(): void {
  const nome = (process.argv[2] ?? '').trim().toLowerCase();
  const copia = COPIAS[nome];
  if (!copia) {
    erro(
      `Uso: pnpm nova-copia <${Object.keys(COPIAS).join('|')}>\n` +
        `  Ex: pnpm nova-copia brasil`
    );
  }

  const envOrigem = path.join(raiz, '.env');
  if (!existsSync(envOrigem)) {
    erro('Nao achei o .env desta pasta — e dele que a copia herda senha do banco e demais ajustes.');
  }

  const destino = path.resolve(raiz, '..', `prospector-${nome}`);
  if (existsSync(destino)) {
    erro(
      `A pasta ja existe:\n    ${destino}\n\n` +
        `  Se quer recriar, apague-a antes. Se ela ja e a sua copia, nao\n` +
        `  precisa criar de novo: abra a pasta e rode \`pnpm dev\`.`
    );
  }

  const urlOriginal = /^DATABASE_URL=(.*)$/m.exec(readFileSync(envOrigem, 'utf8'))?.[1]?.trim();
  if (!urlOriginal) erro('Nao achei DATABASE_URL no .env.');

  const u = new URL(urlOriginal);
  const bancoOriginal = u.pathname.replace(/^\//, '') || 'prospector';
  u.pathname = `/${bancoOriginal}_${nome}`;
  const urlCopia = u.toString();
  const bancoCopia = `${bancoOriginal}_${nome}`;

  console.log('');
  console.log('='.repeat(64));
  console.log(`  COPIA SEPARADA: ${nome}`);
  console.log('='.repeat(64));
  console.log(`  pasta ............ ${destino}`);
  console.log(`  banco ............ ${bancoCopia}`);
  console.log(`  redis ............ banco ${copia.redisDb}`);
  console.log(`  tela ............. http://localhost:${copia.web}`);
  console.log('');

  // --- 1. O codigo, numa pasta propria ---
  // `git clone` em vez de copiar: traz so o que esta versionado, sem
  // node_modules, sem .env e sem a pasta de sessao do WhatsApp — que
  // sao exatamente as coisas que NAO podem ser compartilhadas.
  console.log('  Copiando o código...');
  rodar('git', ['clone', '--local', '--quiet', raiz, destino], raiz);

  // --- 2. O .env da copia ---
  console.log('  Escrevendo o .env da cópia...');
  escreverEnv(envOrigem, path.join(destino, '.env'), {
    DATABASE_URL: urlCopia,
    REDIS_DB: String(copia.redisDb),
    API_PORT: String(copia.api),
    WEB_PORT: String(copia.web),
    WHATSAPP_SESSION_PATH: './data/whatsapp',
  });

  // --- 3. Dependencias ---
  console.log('  Instalando as dependências (demora um pouco)...');
  rodar('pnpm', ['install'], destino);
  rodar('pnpm', ['db:generate'], destino);

  // --- 4. O banco ---
  const manutencao = new URL(urlCopia);
  manutencao.pathname = '/postgres';

  console.log('  Criando o banco...');
  const criacao = spawnSync(
    'npx',
    ['prisma', 'db', 'execute', '--url', manutencao.toString(), '--stdin'],
    {
      cwd: path.join(destino, 'packages', 'database'),
      input: `CREATE DATABASE ${bancoCopia};`,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }
  );
  const saida = `${criacao.stdout ?? ''}${criacao.stderr ?? ''}`;
  if (criacao.status !== 0 && !/already exists|ja existe/i.test(saida)) {
    console.error(saida.trim());
    erro('Nao consegui criar o banco. O Postgres esta rodando?');
  }

  console.log('  Aplicando as migrações...');
  rodar('pnpm', ['db:migrate:deploy'], destino);
  console.log('  Criando o usuário de acesso...');
  rodar('pnpm', ['db:seed'], destino);

  console.log('');
  console.log('='.repeat(64));
  console.log('  PRONTO. A partir de agora, para subir esta cópia:');
  console.log('');
  console.log(`      cd /d ${destino}`);
  console.log('      pnpm dev');
  console.log('');
  console.log(`  Ela abre em http://localhost:${copia.web}, com banco, fila,`);
  console.log('  sessão de WhatsApp e leads próprios. Nada é compartilhado');
  console.log('  com a pasta original — nem variável de ambiente.');
  console.log('='.repeat(64));
  console.log('');
}

main();
