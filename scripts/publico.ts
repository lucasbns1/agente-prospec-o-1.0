/**
 * Por que a campanha diz "0 leads"?
 *
 * ============================================================
 * A PERGUNTA QUE ISTO RESPONDE NO TERMINAL
 * ============================================================
 * A tela agora mostra o funil, mas ela depende de voce ter atualizado o
 * projeto e de o Vite ter recarregado. Este script responde a mesma
 * coisa direto do banco, sem tela e sem cache no meio.
 *
 * Ele NAO grava nada e nao enfileira nada. Rodar dez vezes nao muda uma
 * linha.
 *
 * Uso:  pnpm publico
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });

function titulo(t: string): void {
  console.log(`\n${'='.repeat(60)}\n${t}\n${'='.repeat(60)}`);
}

async function main(): Promise<void> {
  // Import dentro da funcao: `tsx` compila este arquivo como CJS, e
  // `await` no topo do modulo nao existe la. O mesmo motivo dos outros
  // scripts desta pasta.
  const { prisma } = await import('../packages/database/src/index.js');

  titulo('AS PLANILHAS, E QUANTOS LEADS DE VERDADE TEM CADA UMA');

  const sessoes = await prisma.captureSession.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, nicho: true, cidade: true, estado: true },
  });

  for (const s of sessoes) {
    const rotulo = `${s.nicho} em ${s.cidade}${s.estado ? `/${s.estado}` : ''}`;

    // O funil, na mesma ordem em que a campanha aplica os cortes.
    const naPlanilha = await prisma.lead.count({
      where: { captureSessionId: s.id },
    });
    const semOptOut = await prisma.lead.count({
      where: {
        captureSessionId: s.id,
        optOut: false,
        status: { notIn: ['OPT_OUT', 'AGUARDANDO_INTERVENCAO'] },
      },
    });
    const comTelefone = await prisma.lead.count({
      where: {
        captureSessionId: s.id,
        optOut: false,
        status: { notIn: ['OPT_OUT', 'AGUARDANDO_INTERVENCAO'] },
        telefoneNormalizado: { not: null },
      },
    });
    const nuncaContatados = await prisma.lead.count({
      where: {
        captureSessionId: s.id,
        optOut: false,
        status: { notIn: ['OPT_OUT', 'AGUARDANDO_INTERVENCAO'] },
        telefoneNormalizado: { not: null },
        messages: { none: { direcao: 'ENVIADA' } },
      },
    });

    console.log(`\n  ${rotulo}`);
    console.log(`    leads no CRM ................... ${naPlanilha}`);
    console.log(
      `    depois de opt-out/intervencao .. ${semOptOut}   (-${naPlanilha - semOptOut})`
    );
    console.log(
      `    depois de exigir telefone ...... ${comTelefone}   (-${semOptOut - comTelefone})`
    );
    console.log(
      `    SO NUNCA CONTATADOS ............ ${nuncaContatados}   (-${comTelefone - nuncaContatados})`
    );

    if (nuncaContatados === 0 && naPlanilha > 0) {
      console.log('    ^ e por isto que a campanha mostra 0.');
    }
  }

  titulo('DUPLICADAS?');

  // Duas planilhas com o mesmo nicho e a mesma cidade escrita diferente
  // sao a mesma lista importada duas vezes. A segunda quase so gera
  // duplicados — e continua ocupando espaco na tela de escolha.
  const porChave = new Map<string, string[]>();
  for (const s of sessoes) {
    const chave = `${(s.nicho ?? '').toLowerCase().trim()}|${(s.cidade ?? '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')}`;
    porChave.set(chave, [...(porChave.get(chave) ?? []), s.id]);
  }

  const repetidas = [...porChave.entries()].filter(([, ids]) => ids.length > 1);
  if (repetidas.length === 0) {
    console.log('\n  Nenhuma repetida.');
  } else {
    for (const [chave, ids] of repetidas) {
      console.log(`\n  "${chave.replace('|', '" em "')}" aparece ${ids.length}x`);
      console.log('  Apague as sobrando na aba Planilhas.');
    }
  }

  console.log('');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('\n[FALHA]', err instanceof Error ? err.message : err, '\n');
  process.exitCode = 1;
});
