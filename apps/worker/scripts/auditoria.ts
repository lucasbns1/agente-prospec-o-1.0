/**
 * Auditoria do estado real do sistema.
 *
 * Uso:  pnpm auditoria
 *
 * ============================================================
 * O NUMERO QUE IMPORTA
 * ============================================================
 * `REAL_MESSAGES_SENT`. Todo o resto e contexto.
 *
 * Ele e calculado por DUAS consultas independentes: o contador de
 * mensagens nao-simuladas e o de mensagens com id do WhatsApp. Um envio
 * real produz as duas coisas; se as duas discordarem, ha algo errado no
 * registro — e discordar e mais informativo do que qualquer uma sozinha.
 *
 * Le direto do banco. Nao confia na interface.
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../../.env') });

const { prisma } = await import('@prospector/database');
const { FASE_PERMITE_ENVIO_REAL } = await import('@prospector/integrations');

const [
  recebidas,
  enviadasReais,
  comIdWhatsApp,
  simuladasMsg,
  simuladasOutbound,
  optOuts,
  desconhecidos,
  desconhecidosPendentes,
  canceladas,
  bloqueadas,
  emIntervencao,
  porCategoria,
  porStatusEntrega,
] = await Promise.all([
  prisma.message.count({ where: { direcao: 'RECEBIDA' } }),
  // A definicao de "enviada de verdade": saiu e nao foi simulacao.
  prisma.message.count({ where: { direcao: 'ENVIADA', simulada: false } }),
  // A segunda prova, independente: so o WhatsApp atribui este id.
  prisma.message.count({
    where: { direcao: 'ENVIADA', whatsappMessageId: { not: null } },
  }),
  prisma.message.count({ where: { simulada: true } }),
  prisma.outboundMessage.count({ where: { status: 'SIMULADA' } }),
  prisma.lead.count({ where: { optOut: true } }),
  prisma.unknownContact.count(),
  prisma.unknownContact.count({ where: { resolvido: false } }),
  prisma.outboundMessage.count({ where: { status: 'CANCELADA' } }),
  prisma.outboundMessage.count({ where: { status: 'BLOQUEADA' } }),
  prisma.lead.count({ where: { status: 'AGUARDANDO_INTERVENCAO' } }),
  prisma.message.groupBy({
    by: ['categoria'],
    where: { direcao: 'RECEBIDA' },
    _count: true,
  }),
  prisma.message.groupBy({
    by: ['status'],
    where: { direcao: 'ENVIADA' },
    _count: true,
  }),
]);

const linha = (r: string, v: string | number): string =>
  `  ${r.padEnd(34)} ${String(v)}`;

console.log('');
console.log('='.repeat(56));
console.log(`  REAL_MESSAGES_SENT = ${enviadasReais}`);
console.log('='.repeat(56));

if (enviadasReais !== comIdWhatsApp) {
  // As duas consultas deveriam concordar sempre. Discordar significa que
  // alguma mensagem foi registrada de forma inconsistente.
  console.log('');
  console.log('  !! INCONSISTENCIA: as duas contagens de envio real discordam.');
  console.log(linha('  nao-simuladas', enviadasReais));
  console.log(linha('  com id do WhatsApp', comIdWhatsApp));
  console.log('  Investigue antes de confiar em qualquer numero abaixo.');
}

console.log('');
console.log('BARREIRAS');
console.log(linha('FASE_PERMITE_ENVIO_REAL', String(FASE_PERMITE_ENVIO_REAL)));
console.log(linha('WHATSAPP_CANAL', process.env.WHATSAPP_CANAL ?? '(nao definido)'));

console.log('');
console.log('MENSAGENS');
console.log(linha('recebidas reais', recebidas));
console.log(linha('enviadas reais', enviadasReais));
console.log(linha('com id do WhatsApp', comIdWhatsApp));
console.log(linha('simuladas (messages)', simuladasMsg));
console.log(linha('simuladas (fila outbound)', simuladasOutbound));

if (porCategoria.length > 0) {
  console.log('');
  console.log('CLASSIFICACAO DAS RECEBIDAS');
  for (const c of porCategoria.sort((a, b) => b._count - a._count)) {
    console.log(linha(`  ${c.categoria ?? '(sem categoria)'}`, c._count));
  }
}

if (porStatusEntrega.length > 0) {
  console.log('');
  console.log('ENTREGA DAS ENVIADAS');
  for (const s of porStatusEntrega) {
    console.log(linha(`  ${s.status}`, s._count));
  }
}

console.log('');
console.log('SUPRESSAO E INTERVENCAO');
console.log(linha('opt-outs', optOuts));
console.log(linha('leads aguardando intervencao', emIntervencao));
console.log(linha('contatos desconhecidos', desconhecidos));
console.log(linha('  pendentes de decisao', desconhecidosPendentes));

console.log('');
console.log('FILA');
console.log(linha('mensagens canceladas', canceladas));
console.log(linha('mensagens bloqueadas', bloqueadas));

// =============================================================================
// INTELIGENCIA ARTIFICIAL (Fase 9)
// =============================================================================
//
// Le `ai_decisions`, que e a trilha de toda vez que a IA foi consultada.
// Com o Gemini desligado a tabela fica vazia e este bloco nao aparece —
// e a ausencia dele ja e a informacao.

const decisoesIa = await prisma.aiDecision.count();

if (decisoesIa > 0) {
  const [porAcao, divergencias, fallbacks, rejeitadas, latencia, ultima] = await Promise.all([
    prisma.aiDecision.groupBy({ by: ['acaoExecutada'], _count: true }),
    prisma.aiDecision.count({ where: { divergiu: true } }),
    prisma.aiDecision.count({ where: { fallback: true } }),
    prisma.aiDecision.groupBy({
      by: ['motivoRejeicao'],
      where: { motivoRejeicao: { not: null } },
      _count: true,
    }),
    prisma.aiDecision.aggregate({ _avg: { latenciaMs: true }, _max: { latenciaMs: true } }),
    prisma.aiDecision.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, modelo: true },
    }),
  ]);

  console.log('');
  console.log('INTELIGENCIA ARTIFICIAL');
  console.log(linha('decisoes registradas', decisoesIa));
  console.log(linha('  divergiram do motor', divergencias));
  // Fallback nao e defeito: e o sistema seguindo em frente sem a IA.
  // Vira sinal de alerta quando e a maioria.
  console.log(linha('  cairam no motor (fallback)', fallbacks));
  console.log(`  modelo                              ${ultima?.modelo ?? '(nenhum)'}`);
  if (latencia._avg.latenciaMs !== null) {
    console.log(
      `  latencia media / maxima             ${Math.round(latencia._avg.latenciaMs)}ms / ${latencia._max.latenciaMs}ms`
    );
  }

  console.log('');
  console.log('  ACOES EXECUTADAS');
  for (const a of porAcao.sort((x, y) => y._count - x._count)) {
    console.log(linha(`    ${a.acaoExecutada ?? '(nenhuma)'}`, a._count));
  }

  if (rejeitadas.length > 0) {
    // A guarda barrando decisao da IA. Aparecer aqui e o sistema
    // funcionando — o que importa e QUAL barreira, e com que frequencia.
    console.log('');
    console.log('  RECUSADAS PELA GUARDA');
    for (const r of rejeitadas.sort((x, y) => y._count - x._count)) {
      console.log(linha(`    ${r.motivoRejeicao}`, r._count));
    }
  }

  if (fallbacks > 0) {
    // SEM `take` aqui, de proposito.
    //
    // Um `take` num `groupBy` faz o Prisma paginar por cursor, e para
    // isso ele exige ordenar por um campo que esteja no `by` — `id` nao
    // esta. O resultado era o script morrer com P2019 exatamente aqui,
    // levando junto TUDO o que vem depois desta secao: as filas, a
    // reconciliacao, os contatos desconhecidos. Um relatorio de
    // diagnostico que morre no meio e pior que nenhum, porque ele deixa
    // voce achando que leu o quadro inteiro.
    //
    // O corte acontece em JS, logo abaixo, onde a ordenacao ja
    // acontecia de qualquer forma. Sao poucas linhas: uma por TIPO de
    // erro, nao uma por decisao.
    const erros = await prisma.aiDecision.groupBy({
      by: ['erro'],
      where: { fallback: true, erro: { not: null } },
      _count: true,
    });
    console.log('');
    console.log('  POR QUE A IA FALHOU');
    for (const e of erros.sort((x, y) => y._count - x._count).slice(0, 5)) {
      console.log(linha(`    ${(e.erro ?? '').slice(0, 60)}`, e._count));
    }
  }
} else {
  console.log('');
  console.log('INTELIGENCIA ARTIFICIAL');
  console.log('  Nenhuma decisao registrada (Gemini desligado ou ainda sem eventos).');
}

// =============================================================================
// RECONCILIACAO
// =============================================================================
//
// Onde o banco discorda de si mesmo. Roda a deteccao AGORA, sem esperar
// a passada horaria do worker — e sem corrigir nada, nem mesmo o
// opt-out: uma auditoria que muda o que audita nao serve para auditar.

const { reconciliar } = await import('../src/services/reconciliacao.js');
const rec = await reconciliar({ corrigirOptOut: false });

console.log('');
console.log('RECONCILIACAO');
console.log(linha('criticas', rec.resumo.CRITICA));
console.log(linha('atencao', rec.resumo.ATENCAO));
console.log(linha('informativas', rec.resumo.INFO));

if (rec.achados.length === 0) {
  console.log('  Nada fora do lugar.');
} else {
  for (const g of ['CRITICA', 'ATENCAO', 'INFO'] as const) {
    const doNivel = rec.achados.filter((a) => a.gravidade === g);
    if (doNivel.length === 0) continue;
    console.log('');
    console.log(`  ${g}`);
    for (const a of doNivel.slice(0, 20)) {
      console.log(`    [${a.tipo}] ${a.descricao}`);
      console.log(`      lead ${a.leadId} -> ${a.sugestao}`);
    }
    if (doNivel.length > 20) {
      console.log(`    ... e mais ${doNivel.length - 20}`);
    }
  }
}

console.log('');
if (enviadasReais === 0 && comIdWhatsApp === 0) {
  console.log('  Nenhuma mensagem real foi enviada.');
} else {
  console.log('  ATENCAO: existe envio real registrado.');
}
if (rec.resumo.CRITICA > 0) {
  console.log(`  ATENCAO: ${rec.resumo.CRITICA} inconsistencia(s) CRITICA(s) — leia acima.`);
}
console.log('');

await prisma.$disconnect();
