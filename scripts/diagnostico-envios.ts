/**
 * Por que uma ordem diz ENVIADA e nao ha mensagem no historico.
 *
 * ============================================================
 * A PERGUNTA QUE ISTO RESPONDE
 * ============================================================
 * A auditoria acusou 117 ordens `ENVIADA` sem mensagem na conversa,
 * enquanto a tabela `messages` tinha UMA linha de envio no banco
 * inteiro. Ao mesmo tempo, as ordens estavam com o campo `erro` vazio e
 * o `messageId` nulo.
 *
 * Esses tres fatos nao fecham lendo o codigo: o unico caminho que grava
 * ordem sem mensagem E sem erro exige uma colisao de UNIQUE em que
 * NENHUMA das duas buscas encontre a linha existente — e so ha dois
 * UNIQUE em `messages`, ambos consultados.
 *
 * Entao a resposta esta nos dados, nao no codigo. Isto aqui olha.
 *
 * ============================================================
 * ELE NAO ESCREVE NADA
 * ============================================================
 * Nenhum `create`, nenhum `update`, nenhum `delete`. So leitura. Pode
 * rodar com o worker no ar, com a campanha ativa, a qualquer hora.
 *
 *   pnpm diagnostico-envios
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });

function titulo(t: string): void {
  console.log(`\n${'='.repeat(64)}\n${t}\n${'='.repeat(64)}`);
}

const linha = (r: string, v: string | number): string =>
  `  ${r.padEnd(40)} ${String(v)}`;

async function main(): Promise<void> {
  const { prisma } = await import('../packages/database/src/index.js');
  type OutboundStatus = Parameters<
    typeof prisma.outboundMessage.count
  >[0] extends { where?: { status?: { in?: (infer T)[] } } }
    ? T
    : never;

  // -------------------------------------------------------------------------
  titulo('AS ORDENS DE ENVIO, POR ESTADO');
  // -------------------------------------------------------------------------
  const porStatus = await prisma.outboundMessage.groupBy({
    by: ['status'],
    _count: true,
  });
  for (const s of porStatus.sort((a, b) => b._count - a._count)) {
    console.log(linha(s.status, s._count));
  }

  // -------------------------------------------------------------------------
  titulo('DAS QUE DIZEM ENVIADA/SIMULADA');
  // -------------------------------------------------------------------------
  // O enum do Prisma, e nao strings soltas: `in: string[]` nao satisfaz
  // `OutboundStatus[]`, e `as const` piora (vira readonly). Nomear o
  // tipo tambem faz o compilador avisar se um estado sumir do schema.
  const concluidas = {
    status: { in: ['ENVIADA', 'SIMULADA'] as OutboundStatus[] },
  };

  const [total, semVinculo, comErro, semErro, dryRun] = await Promise.all([
    prisma.outboundMessage.count({ where: concluidas }),
    prisma.outboundMessage.count({ where: { ...concluidas, messageId: null } }),
    prisma.outboundMessage.count({ where: { ...concluidas, erro: { not: null } } }),
    prisma.outboundMessage.count({ where: { ...concluidas, erro: null } }),
    prisma.outboundMessage.count({ where: { ...concluidas, dryRun: true } }),
  ]);

  console.log(linha('total', total));
  console.log(linha('SEM vinculo com mensagem (messageId null)', semVinculo));
  console.log(linha('com erro de pos-processamento', comErro));
  console.log(linha('sem erro nenhum', semErro));
  console.log(linha('marcadas dryRun', dryRun));

  // -------------------------------------------------------------------------
  titulo('A TABELA DE MENSAGENS');
  // -------------------------------------------------------------------------
  const [msgTotal, msgEnviadas, msgRecebidas, msgSimuladas, msgComId] =
    await Promise.all([
      prisma.message.count(),
      prisma.message.count({ where: { direcao: 'ENVIADA' } }),
      prisma.message.count({ where: { direcao: 'RECEBIDA' } }),
      prisma.message.count({ where: { simulada: true } }),
      prisma.message.count({ where: { whatsappMessageId: { not: null } } }),
    ]);

  console.log(linha('linhas no total', msgTotal));
  console.log(linha('  direcao ENVIADA', msgEnviadas));
  console.log(linha('  direcao RECEBIDA', msgRecebidas));
  console.log(linha('  simuladas', msgSimuladas));
  console.log(linha('  com id do WhatsApp', msgComId));

  // -------------------------------------------------------------------------
  titulo('AS CONVERSAS');
  // -------------------------------------------------------------------------
  // Se `conversations` estiver vazia, a gravacao do historico falharia
  // por chave estrangeira — e ai o erro NAO seria P2002, seria relancado
  // e apareceria no campo `erro`. Conferir mesmo assim: e barato, e
  // elimina uma hipotese inteira.
  const [conversas, comChatId] = await Promise.all([
    prisma.conversation.count(),
    prisma.conversation.count({ where: { chatId: { not: '' } } }),
  ]);
  console.log(linha('conversas', conversas));
  console.log(linha('  com chatId preenchido', comChatId));

  // -------------------------------------------------------------------------
  titulo('DUAS ORDENS DE PERTO');
  // -------------------------------------------------------------------------
  // Os campos crus de duas ordens problematicas. E aqui que a hipotese
  // certa costuma aparecer — os agregados acima dizem QUANTOS, este diz
  // COMO.
  const amostra = await prisma.outboundMessage.findMany({
    where: { ...concluidas, messageId: null },
    orderBy: { processedAt: 'desc' },
    take: 2,
    select: {
      id: true,
      leadId: true,
      status: true,
      dryRun: true,
      erro: true,
      messageId: true,
      idempotencyKey: true,
      processedAt: true,
      createdAt: true,
      textoRenderizado: true,
      campaignStep: { select: { ordem: true } },
    },
  });

  for (const o of amostra) {
    console.log('');
    console.log(linha('ordem', o.id));
    console.log(linha('  etapa', o.campaignStep?.ordem ?? '?'));
    console.log(linha('  status', o.status));
    console.log(linha('  dryRun', String(o.dryRun)));
    console.log(linha('  erro', o.erro ?? '(vazio)'));
    console.log(linha('  messageId', o.messageId ?? '(nulo)'));
    console.log(linha('  idempotencyKey', o.idempotencyKey ?? '(nulo)'));
    console.log(linha('  criada em', o.createdAt?.toLocaleString('pt-BR') ?? '—'));
    console.log(
      linha('  processada em', o.processedAt?.toLocaleString('pt-BR') ?? '(nunca)')
    );

    // A mensagem pode existir e so nao estar VINCULADA — que e um
    // problema bem menor do que ela nao existir. Os dois casos aparecem
    // iguais na auditoria, e sao consertos diferentes.
    const porChave = o.idempotencyKey
      ? await prisma.message.findFirst({
          where: { idempotencyKey: o.idempotencyKey },
          select: { id: true },
        })
      : null;
    const porTexto = await prisma.message.findFirst({
      where: {
        leadId: o.leadId,
        direcao: 'ENVIADA',
        texto: o.textoRenderizado ?? '###',
      },
      select: { id: true },
    });

    console.log(
      linha(
        '  mensagem existe?',
        porChave
          ? `SIM, pela chave (${porChave.id}) — falta so o vinculo`
          : porTexto
            ? `SIM, pelo texto (${porTexto.id}) — falta so o vinculo`
            : 'NAO — o historico nunca foi gravado'
      )
    );
  }

  // -------------------------------------------------------------------------
  titulo('O QUE ISTO SIGNIFICA');
  // -------------------------------------------------------------------------
  if (semVinculo === 0) {
    console.log('  Nenhuma ordem sem vinculo. Nada a investigar aqui.');
  } else if (msgEnviadas >= semVinculo) {
    console.log('  As mensagens EXISTEM; o que falta e o vinculo entre elas e');
    console.log('  as ordens. Isso e cosmetico: o historico esta inteiro, e a');
    console.log('  conversa aparece certa na tela. Da para religar.');
  } else {
    console.log('  As mensagens NAO existem no historico.');
    console.log('');
    console.log('  Isso NAO quer dizer que nada saiu: o transporte e o');
    console.log('  historico sao passos diferentes, e o status ENVIADA e');
    console.log('  escrito pelo primeiro. Confira no seu WhatsApp se as');
    console.log('  conversas destes leads tem mensagem sua.');
    console.log('');
    console.log('  NAO reenvie por conta disto.');
  }

  console.log('');
  await prisma.$disconnect();
}

void main();
