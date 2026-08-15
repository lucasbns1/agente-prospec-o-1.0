/**
 * Reset de fabrica do Prospector.
 *
 * ============================================================
 * O QUE ISTO APAGA
 * ============================================================
 * Tudo que veio de prospeccao: leads, importacoes, campanhas, etapas,
 * fila de envio, conversas, mensagens, historico, tarefas, notificacoes
 * e contatos desconhecidos.
 *
 * ============================================================
 * O QUE ISTO NAO TOCA
 * ============================================================
 *  - seu usuario e a senha;
 *  - o dicionario de palavras-chave (`response_keywords`);
 *  - os templates de resposta (`response_templates`);
 *  - as configuracoes globais (`settings`);
 *  - a sessao do WhatsApp em disco — voce continua conectado, sem QR
 *    novo.
 *
 * Isso e o "de fabrica das atualizacoes" e nao "de fabrica do zero": as
 * migrations, o codigo e o que voce configurou continuam de pe. Apagar
 * o dicionario obrigaria a reconfigurar o motor de regras so para
 * limpar uma lista de leads.
 *
 * ============================================================
 * ISTO E DESTRUTIVO E NAO TEM VOLTA
 * ============================================================
 * Por isso exige confirmacao explicita:
 *
 *   pnpm reset:fabrica -- --confirmo
 *
 * Sem a flag ele so mostra o que APAGARIA e sai sem tocar em nada.
 * Rodar por engano no meio de uma campanha ativa apagaria a fila e o
 * historico do que ja saiu — e o historico e a unica prova de quem ja
 * foi abordado.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Carregado ANTES do Prisma: o cliente le DATABASE_URL no momento em que
// o modulo e importado, nao na primeira consulta. Importar primeiro
// deixaria o script com "Environment variable not found".
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });

type Prisma = typeof import('../packages/database/src/index.js')['prisma'];

const CONFIRMOU = process.argv.includes('--confirmo');

/**
 * Ordem ditada pelas chaves estrangeiras: filho antes do pai.
 *
 * Escrita a mao, e nao derivada do schema, porque a ordem errada falha
 * no meio e deixa o banco pela metade — pior que nao ter limpado.
 */
function etapasDeLimpeza(
  prisma: Prisma
): Array<{ nome: string; apagar: () => Promise<{ count: number }> }> {
  return [
    { nome: 'contatos desconhecidos', apagar: () => prisma.unknownContact.deleteMany() },
    { nome: 'fila de envio', apagar: () => prisma.outboundMessage.deleteMany() },
    { nome: 'mensagens', apagar: () => prisma.message.deleteMany() },
    { nome: 'conversas', apagar: () => prisma.conversation.deleteMany() },
    { nome: 'histórico dos leads', apagar: () => prisma.leadEvent.deleteMany() },
    { nome: 'verificações de site', apagar: () => prisma.websiteCheck.deleteMany() },
    { nome: 'linhas importadas', apagar: () => prisma.importRow.deleteMany() },
    { nome: 'notificações', apagar: () => prisma.notification.deleteMany() },
    { nome: 'tarefas', apagar: () => prisma.task.deleteMany() },
    { nome: 'vínculos lead↔campanha', apagar: () => prisma.leadCampaign.deleteMany() },
    { nome: 'etapas de campanha', apagar: () => prisma.campaignStep.deleteMany() },
    { nome: 'campanhas', apagar: () => prisma.campaign.deleteMany() },
    { nome: 'leads', apagar: () => prisma.lead.deleteMany() },
    { nome: 'lotes de captura', apagar: () => prisma.captureSession.deleteMany() },
    { nome: 'importações', apagar: () => prisma.import.deleteMany() },
  ];
}

async function contagemAtual(prisma: Prisma): Promise<Record<string, number>> {
  const [leads, campanhas, fila, mensagens, notificacoes] = await Promise.all([
    prisma.lead.count(),
    prisma.campaign.count(),
    prisma.outboundMessage.count(),
    prisma.message.count(),
    prisma.notification.count(),
  ]);
  return { leads, campanhas, fila, mensagens, notificacoes };
}

/**
 * Mensagens REAIS ja enviadas.
 *
 * Apagar isto significa perder a unica prova de quem voce ja abordou —
 * e voce pode reabordar a mesma pessoa sem saber. Nao impede o reset,
 * mas o aviso e obrigatorio.
 */
async function enviosReais(prisma: Prisma): Promise<number> {
  return prisma.outboundMessage.count({
    where: { status: 'ENVIADA', dryRun: false },
  });
}

async function main(): Promise<void> {
  // Importado DEPOIS do dotenv: o cliente le DATABASE_URL na carga do
  // modulo, nao na primeira consulta. Um `import` no topo deixaria o
  // script com "Environment variable not found".
  const { prisma } = await import('../packages/database/src/index.js');

  const antes = await contagemAtual(prisma);
  const reais = await enviosReais(prisma);

  console.log('\n=== RESET DE FÁBRICA DO PROSPECTOR ===\n');
  console.log('No banco agora:');
  for (const [k, v] of Object.entries(antes)) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }

  if (reais > 0) {
    console.log(
      `\n  ATENÇÃO: ${reais} mensagem(ns) REAL(is) já enviada(s) serão apagadas ` +
        `do histórico.\n  Depois disso o sistema não saberá mais que essas pessoas ` +
        `foram abordadas.`
    );
  }

  console.log('\nSerá PRESERVADO: usuário, dicionário de palavras-chave,');
  console.log('templates de resposta, configurações e a sessão do WhatsApp.\n');

  if (!CONFIRMOU) {
    console.log('Nada foi apagado — isto foi só a prévia.');
    console.log('Para executar de verdade:\n');
    console.log('  pnpm reset:fabrica -- --confirmo\n');
    await prisma.$disconnect();
    return;
  }

  console.log('Apagando...\n');
  for (const etapa of etapasDeLimpeza(prisma)) {
    const r = await etapa.apagar();
    console.log(`  ${etapa.nome.padEnd(24)} ${r.count} removido(s)`);
  }

  const depois = await contagemAtual(prisma);
  console.log('\nDepois:');
  for (const [k, v] of Object.entries(depois)) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }
  // Conferido e impresso, e nao apenas prometido no comentario do topo:
  // se um `deleteMany` novo entrar na lista por engano e levar o
  // dicionario junto, estes numeros zeram na sua frente.
  const preservado = await Promise.all([
    prisma.responseKeyword.count(),
    prisma.responseTemplate.count(),
    prisma.setting.count(),
    prisma.user.count(),
  ]);
  console.log('\nPreservado:');
  console.log(`  palavras-chave  ${preservado[0]}`);
  console.log(`  templates       ${preservado[1]}`);
  console.log(`  configurações   ${preservado[2]}`);
  console.log(`  usuários        ${preservado[3]}`);

  console.log('\nPronto. Importe a planilha com o número de teste e crie a campanha.\n');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Falhou:', err);
  process.exit(1);
});
