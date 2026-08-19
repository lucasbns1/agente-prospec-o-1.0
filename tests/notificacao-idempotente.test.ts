/**
 * Notificacao nao duplica.
 *
 * ============================================================
 * POR QUE ESTE ARQUIVO EXISTE
 * ============================================================
 * A auditoria da Fase 9 encontrou tres pontos criando notificacao com
 * `prisma.notification.create()` seco. Nada impedia que o mesmo
 * acontecimento virasse dois avisos no sino — e nenhum teste cobria isso,
 * porque a protecao simplesmente nao existia.
 *
 * Estes testes batem no banco de proposito. A garantia e uma constraint
 * UNIQUE; testar isso com mock provaria apenas que o mock funciona.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { chaveNotificacao } from '@prospector/domain';

// O `.env` da raiz precisa estar carregado ANTES de o cliente Prisma ser
// construido — por isso os imports do banco sao dinamicos, como no resto
// da suite.
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });
process.env.LOG_LEVEL = 'silent';

let prisma: typeof import('@prospector/database').prisma;
let criarNotificacaoIdempotente: typeof import('../apps/worker/src/services/notificar.js').criarNotificacaoIdempotente;
let criarTarefaSeNaoExistir: typeof import('../apps/worker/src/services/notificar.js').criarTarefaSeNaoExistir;
let leadId: string;

beforeAll(async () => {
  prisma = (await import('@prospector/database')).prisma;
  ({ criarNotificacaoIdempotente, criarTarefaSeNaoExistir } = await import(
    '../apps/worker/src/services/notificar.js'
  ));
});

beforeEach(async () => {
  await prisma.notification.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.lead.deleteMany({ where: { telefoneNormalizado: '5511900000001' } });

  const lead = await prisma.lead.create({
    data: {
      nomeCompleto: 'Studio Teste',
      empresa: 'Studio Teste',
      telefoneOriginal: '11900000001',
      telefoneNormalizado: '5511900000001',
      status: 'EM_CAMPANHA',
    },
    select: { id: true },
  });
  leadId = lead.id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.lead.deleteMany({ where: { telefoneNormalizado: '5511900000001' } });
  await prisma.$disconnect();
});

function aviso(referencia: string | null) {
  return {
    tipo: 'PEDIDO_PREVIEW',
    titulo: 'Studio Teste chegou na etapa 3',
    mensagem: 'Prepare a previa e libere no quadro.',
    nivel: 'ALERTA' as const,
    leadId,
    referencia,
  };
}

describe('criarNotificacaoIdempotente', () => {
  it('cria o aviso na primeira vez', async () => {
    const r = await criarNotificacaoIdempotente(aviso('etapa-manual:e3'));
    expect(r.criada).toBe(true);
    expect(await prisma.notification.count()).toBe(1);
  });

  // O caso real: o lead responde de novo, ou o BullMQ reexecuta o job.
  it('a segunda chamada com a mesma referencia nao cria nada', async () => {
    await criarNotificacaoIdempotente(aviso('etapa-manual:e3'));
    const r = await criarNotificacaoIdempotente(aviso('etapa-manual:e3'));

    expect(r.criada).toBe(false);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('dez chamadas seguidas continuam produzindo UM aviso', async () => {
    for (let i = 0; i < 10; i += 1) {
      await criarNotificacaoIdempotente(aviso('etapa-manual:e3'));
    }
    expect(await prisma.notification.count()).toBe(1);
  });

  // A corrida que o `findFirst` + `create` nao resolvia: duas execucoes
  // simultaneas passam as duas pelo SELECT e criam as duas. Com a UNIQUE,
  // uma ganha e a outra recebe P2002.
  it('cinco chamadas SIMULTANEAS produzem UM aviso', async () => {
    const resultados = await Promise.all(
      Array.from({ length: 5 }, () => criarNotificacaoIdempotente(aviso('etapa-manual:e3')))
    );

    expect(resultados.filter((r) => r.criada)).toHaveLength(1);
    expect(await prisma.notification.count()).toBe(1);
  });

  // Sem isto, "chegou na etapa 3" e "chegou na etapa 5" colidiriam e o
  // segundo aviso sumiria — trocando um defeito por outro pior.
  it('acontecimentos diferentes continuam gerando avisos diferentes', async () => {
    await criarNotificacaoIdempotente(aviso('etapa-manual:e3'));
    await criarNotificacaoIdempotente(aviso('etapa-manual:e5'));
    expect(await prisma.notification.count()).toBe(2);
  });

  // Avisos avulsos ("WhatsApp desconectou") nao tem acontecimento que os
  // identifique. Varios NULL nao colidem numa UNIQUE do PostgreSQL, e
  // aqui isso e o comportamento correto.
  it('sem referencia, o comportamento antigo se mantem: sempre cria', async () => {
    await criarNotificacaoIdempotente(aviso(null));
    await criarNotificacaoIdempotente(aviso(null));
    expect(await prisma.notification.count()).toBe(2);
  });

  it('a chave gravada e a que o dominio calcula', async () => {
    await criarNotificacaoIdempotente(aviso('etapa-manual:e3'));
    const n = await prisma.notification.findFirstOrThrow({
      select: { chaveIdempotencia: true },
    });
    expect(n.chaveIdempotencia).toBe(
      chaveNotificacao('PEDIDO_PREVIEW', leadId, 'etapa-manual:e3')
    );
  });
});

describe('criarTarefaSeNaoExistir', () => {
  it('cria na primeira vez e nao repete enquanto estiver ABERTA', async () => {
    const t = {
      leadId,
      tipo: 'CRIAR_PREVIEW',
      titulo: 'Preparar a previa de Studio Teste',
      descricao: 'O lead chegou na etapa 3.',
    };

    expect((await criarTarefaSeNaoExistir(t)).criada).toBe(true);
    expect((await criarTarefaSeNaoExistir(t)).criada).toBe(false);
    expect(await prisma.task.count()).toBe(1);
  });

  // Depois de concluida, a mesma tarefa pode nascer de novo: e um novo
  // trabalho, nao uma duplicata do anterior.
  it('tarefa concluida nao bloqueia a proxima', async () => {
    const t = {
      leadId,
      tipo: 'CRIAR_PREVIEW',
      titulo: 'Preparar a previa de Studio Teste',
      descricao: 'O lead chegou na etapa 3.',
    };

    await criarTarefaSeNaoExistir(t);
    await prisma.task.updateMany({ data: { status: 'CONCLUIDA' } });

    expect((await criarTarefaSeNaoExistir(t)).criada).toBe(true);
    expect(await prisma.task.count()).toBe(2);
  });
});
