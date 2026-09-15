/**
 * Por que a fila parou — por etapa e por motivo.
 *
 * ============================================================
 * AS DUAS PERGUNTAS QUE ISTO RESPONDE
 * ============================================================
 * "Nao esta mandando a mensagem 2" e "depois que passou muitos na fila
 * nao aparecem mais os proximos agendados".
 *
 * A primeira e sobre BLOQUEIO: a mensagem existe na fila e o sistema
 * recusa manda-la. O motivo esta gravado em `motivoBloqueio`, mas so
 * aparecia clicando na tela, uma linha de cada vez.
 *
 * A segunda e sobre a LISTA: a aba Fila mostra 100 linhas, da mais
 * antiga para a mais nova. Passadas 100 mensagens, as agendadas ficam
 * depois do corte e somem da tela — sem terem sumido da fila.
 *
 * Aqui os dois viram numero: quantas em cada etapa, em cada estado, com
 * cada motivo. Um olhar responde as duas.
 *
 * ============================================================
 * SO LE
 * ============================================================
 * Nenhum create, update ou delete. Nenhuma mensagem e enviada.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });

async function main(): Promise<void> {
  const { prisma } = await import('../packages/database/src/index.js');

  const campanhas = await prisma.campaign.findMany({
    select: {
      id: true,
      nome: true,
      status: true,
      steps: {
        where: { ativo: true },
        orderBy: { ordem: 'asc' },
        select: { id: true, ordem: true, nome: true, texto: true, aguardarResposta: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  for (const c of campanhas) {
    const total = await prisma.outboundMessage.count({ where: { campaignId: c.id } });
    if (total === 0) continue;

    console.log('');
    console.log('='.repeat(72));
    console.log(`${c.nome}   [${c.status}]`);
    console.log('='.repeat(72));

    for (const etapa of c.steps) {
      const porStatus = await prisma.outboundMessage.groupBy({
        by: ['status'],
        where: { campaignId: c.id, campaignStepId: etapa.id },
        _count: true,
      });

      const daEtapa = porStatus.reduce((a, s) => a + s._count, 0);
      const rotulo = etapa.nome?.trim() || `Mensagem ${etapa.ordem}`;

      console.log('');
      console.log(`  ETAPA ${etapa.ordem} — ${rotulo}${etapa.aguardarResposta ? '  (espera resposta)' : ''}`);

      if (daEtapa === 0) {
        console.log('     nada na fila');
        continue;
      }

      for (const s of porStatus.sort((a, b) => b._count - a._count)) {
        console.log(`     ${s.status.padEnd(12)} ${s._count}`);
      }

      // O motivo do bloqueio e o que responde "por que nao mandou".
      const bloqueadas = await prisma.outboundMessage.groupBy({
        by: ['motivoBloqueio'],
        where: { campaignId: c.id, campaignStepId: etapa.id, status: 'BLOQUEADA' },
        _count: true,
      });

      if (bloqueadas.length > 0) {
        console.log('     --- por que bloqueou ---');
        for (const b of bloqueadas.sort((a, b2) => b2._count - a._count)) {
          console.log(`       ${String(b.motivoBloqueio ?? '(sem motivo)').padEnd(28)} ${b._count}`);
        }

        // Uma linha de exemplo com o detalhe: o motivo e a categoria, o
        // `erro` e a frase que diz QUAL variavel faltou.
        const exemplo = await prisma.outboundMessage.findFirst({
          where: { campaignId: c.id, campaignStepId: etapa.id, status: 'BLOQUEADA', erro: { not: null } },
          select: { erro: true },
        });
        if (exemplo?.erro) console.log(`       detalhe: ${exemplo.erro}`);
      }

      // As variaveis do texto — e o que costuma explicar o bloqueio.
      const vars = [...etapa.texto.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
      if (vars.length > 0) {
        console.log(`     variaveis no texto: ${[...new Set(vars)].join(', ')}`);
      }
    }

    // ============================================================
    // O QUE A TELA NAO MOSTRA
    // ============================================================
    // A aba Fila para em 100 linhas, da mais antiga para a mais nova.
    // Depois de 100 enviadas, as agendadas caem fora do corte — estao
    // na fila, e a tela nao alcanca.
    const agendadas = await prisma.outboundMessage.count({
      where: { campaignId: c.id, status: 'AGENDADA' },
    });
    const proxima = await prisma.outboundMessage.findFirst({
      where: { campaignId: c.id, status: 'AGENDADA' },
      orderBy: { scheduledAt: 'asc' },
      select: { scheduledAt: true, lead: { select: { empresa: true, nomeCompleto: true } } },
    });

    console.log('');
    console.log('  ' + '-'.repeat(68));
    console.log(`  TOTAL NA FILA: ${total}     AGENDADAS: ${agendadas}`);
    if (proxima) {
      const quem = proxima.lead.empresa ?? proxima.lead.nomeCompleto ?? '—';
      console.log(`  proxima a sair: ${proxima.scheduledAt?.toLocaleString('pt-BR') ?? '—'}  ${quem}`);
    }
    if (total > 100) {
      console.log('');
      console.log(`  A aba Fila mostra so as 100 mais antigas — desta campanha`);
      console.log(`  ${total - 100} ficam fora do corte. Clique no contador`);
      console.log(`  "Agendada" na tela para ver so elas.`);
    }
  }

  console.log('');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
