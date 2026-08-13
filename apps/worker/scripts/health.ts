/**
 * Health check de toda a stack.
 *
 * Uso:  pnpm health
 *
 * Verifica cada peca de forma INDEPENDENTE e nao para no primeiro erro:
 * saber que "API caiu E Redis caiu" e diferente de saber so que a API
 * caiu — no primeiro caso o problema provavelmente e outro.
 *
 * Sai com codigo 1 se algo estiver fora do ar, para servir em script.
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, '../../..');
config({ path: path.join(raiz, '.env') });

type Estado = 'OK' | 'FALHOU' | 'AVISO';

interface Resultado {
  nome: string;
  estado: Estado;
  detalhe: string;
}

const resultados: Resultado[] = [];

function registrar(nome: string, estado: Estado, detalhe = ''): void {
  resultados.push({ nome, estado, detalhe });
}

// ------------------------------------------------------------------ API
async function checarApi(): Promise<void> {
  const porta = process.env.API_PORT ?? '3333';
  try {
    const r = await fetch(`http://localhost:${porta}/api/auth/me`, {
      signal: AbortSignal.timeout(5000),
    });
    // 401 e a resposta CORRETA sem cookie — significa que a API esta no
    // ar e a autenticacao esta funcionando.
    if (r.status === 401 || r.ok) {
      registrar('API', 'OK', `porta ${porta}`);
    } else {
      registrar('API', 'AVISO', `respondeu ${r.status}`);
    }
  } catch (err) {
    registrar('API', 'FALHOU', `sem resposta na porta ${porta}`);
    void err;
  }
}

// ------------------------------------------------------------- DATABASE
async function checarBanco(): Promise<void> {
  try {
    const { prisma } = await import('@prospector/database');
    const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name <> '_prisma_migrations'"
    );
    const leads = await prisma.lead.count();
    registrar('DATABASE', 'OK', `${n} tabelas, ${leads} leads`);
    await prisma.$disconnect();
  } catch (err) {
    registrar('DATABASE', 'FALHOU', String(err).slice(0, 120));
  }
}

// ---------------------------------------------------------------- REDIS
async function checarRedis(): Promise<void> {
  const { Redis } = await import('ioredis');
  const cliente = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    connectTimeout: 5000,
  });
  cliente.on('error', () => {});

  try {
    await cliente.connect();
    const pong = await cliente.ping();
    registrar('REDIS', pong === 'PONG' ? 'OK' : 'AVISO', pong);
  } catch {
    registrar('REDIS', 'FALHOU', 'sem resposta');
  } finally {
    cliente.disconnect();
  }
}

// --------------------------------------------------- WORKER + WHATSAPP
async function checarWorkerECanal(): Promise<void> {
  const { Redis } = await import('ioredis');
  const {
    CHAVE_ESTADO_CANAL,
    estadoEstaVelho,
  } = await import('@prospector/shared');

  const cliente = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    connectTimeout: 5000,
  });
  cliente.on('error', () => {});

  try {
    await cliente.connect();
    const bruto = await cliente.get(CHAVE_ESTADO_CANAL);

    if (!bruto) {
      registrar('WORKER', 'FALHOU', 'nunca publicou estado — está rodando?');
      registrar('WHATSAPP ADAPTER', 'FALHOU', 'sem worker, sem canal');
      return;
    }

    const estado = JSON.parse(bruto) as {
      status: string;
      provider: string;
      conectado: boolean;
      telefone: string | null;
      envioRealPermitidoNaFase: boolean;
      atualizadoEm: string;
    };

    // Estado velho = worker parado. Nunca reportar "OK" na duvida: um
    // health check que mente e pior do que nao ter health check.
    if (estadoEstaVelho(estado as never)) {
      const segundos = Math.round(
        (Date.now() - new Date(estado.atualizadoEm).getTime()) / 1000
      );
      registrar('WORKER', 'FALHOU', `último sinal há ${segundos}s — provavelmente parado`);
      registrar('WHATSAPP ADAPTER', 'FALHOU', 'estado não confiável');
      return;
    }

    registrar('WORKER', 'OK', 'publicando estado');

    const detalhe = [
      estado.provider,
      estado.status,
      estado.telefone ? `número ${estado.telefone}` : null,
    ]
      .filter(Boolean)
      .join(', ');

    registrar(
      'WHATSAPP ADAPTER',
      estado.conectado ? 'OK' : 'AVISO',
      detalhe
    );

    if (estado.envioRealPermitidoNaFase) {
      registrar(
        'GUARDA DE ENVIO',
        'AVISO',
        'ENVIO REAL LIBERADO — confira se isso é intencional'
      );
    } else {
      registrar('GUARDA DE ENVIO', 'OK', 'envio real bloqueado no código');
    }
  } catch (err) {
    registrar('WORKER', 'FALHOU', String(err).slice(0, 100));
    registrar('WHATSAPP ADAPTER', 'FALHOU', 'não foi possível verificar');
  } finally {
    cliente.disconnect();
  }
}

// ----------------------------------------------------------------- main
await checarApi();
await checarBanco();
await checarRedis();
await checarWorkerECanal();

const largura = Math.max(...resultados.map((r) => r.nome.length));

console.log('');
for (const r of resultados) {
  const marca = r.estado === 'OK' ? '  ' : r.estado === 'AVISO' ? '! ' : 'X ';
  console.log(
    `${marca}${r.nome.padEnd(largura)}: ${r.estado}${r.detalhe ? `  (${r.detalhe})` : ''}`
  );
}
console.log('');

const falhou = resultados.some((r) => r.estado === 'FALHOU');
if (falhou) {
  console.log('Algo está fora do ar. Veja docs/TROUBLESHOOTING.md.');
  process.exit(1);
}
console.log('Tudo no ar.');
