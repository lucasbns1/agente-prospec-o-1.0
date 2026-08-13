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
console.log(linha('WHATSAPP_MODE', process.env.WHATSAPP_MODE ?? '(nao definido)'));
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

console.log('');
if (enviadasReais === 0 && comIdWhatsApp === 0) {
  console.log('  Nenhuma mensagem real foi enviada.');
} else {
  console.log('  ATENCAO: existe envio real registrado.');
}
console.log('');

await prisma.$disconnect();
