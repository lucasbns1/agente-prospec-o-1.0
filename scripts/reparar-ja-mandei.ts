/**
 * Desfaz o que o botao "Ja mandei" fez alem da conta.
 *
 * ============================================================
 * O ESTRAGO
 * ============================================================
 * A primeira versao do botao copiava o comportamento de "assumir a
 * conversa": marcava o lead QUENTE e EM_CONVERSA, cancelava a fila dele,
 * e pausava a campanha com `aguardandoLiberacao: true`.
 *
 * Em uso real, 39 leads clicados de uma vez viraram 39 cartoes em
 * "Precisa de voce", cada um pedindo uma decisao que a pessoa acabara de
 * tomar. O oposto de "atualizar a lista".
 *
 * As duas acoes sao diferentes: assumir a conversa e quando alguem
 * RESPONDEU e voce entrou — ai pausar faz sentido. "Ja mandei" e um
 * empurrao a mao em quem NAO respondeu nada; nada nele ficou mais
 * quente, e a sequencia dele nao tinha por que congelar.
 *
 * O botao ja foi corrigido e agora e so uma anotacao. Este script limpa
 * o que ficou.
 *
 * ============================================================
 * O QUE ELE NAO DESFAZ
 * ============================================================
 * O evento `marcado-a-mao` FICA. Ele e verdade — voce mandou mesmo — e e
 * ele que mantem o lead fora da lista de "nao responderam". Desfaze-lo
 * traria os 39 de volta para a fila de trabalho que voce ja fez.
 *
 * ============================================================
 * ELE NAO APAGA NADA POR PADRAO
 * ============================================================
 *   pnpm reparar-ja-mandei            (so mostra)
 *   pnpm reparar-ja-mandei --aplicar  (aplica)
 */

const MOTIVO = 'Você marcou que mandou mensagem na mão';

async function main(): Promise<void> {
  const { config } = await import('dotenv');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  config({ path: path.join(raiz, '.env') });

  // Caminho relativo, e nao o nome do pacote: `scripts/` nao e um
  // workspace, entao o resolvedor nao enxerga `@prospector/*` daqui.
  const { prisma } = await import('../packages/database/src/index.js');

  const aplicar = process.argv.includes('--aplicar');

  console.log('');
  console.log('=========================================================');
  console.log('  REPARO: leads travados pelo botao "Ja mandei"');
  console.log('=========================================================');
  console.log('');

  // O vinculo pausado com ESTE motivo e a assinatura exata do estrago.
  // Nenhum outro caminho do sistema escreve esta frase.
  const vinculos = await prisma.leadCampaign.findMany({
    where: { motivoParada: MOTIVO },
    select: {
      id: true,
      leadId: true,
      status: true,
      totalEnviadas: true,
      aguardandoLiberacao: true,
      lead: {
        select: {
          id: true,
          empresa: true,
          nomeCompleto: true,
          status: true,
          temperatura: true,
        },
      },
    },
  });

  if (vinculos.length === 0) {
    console.log('Nada a reparar: nenhum lead foi travado pelo botao.');
    console.log('');
    await prisma.$disconnect();
    return;
  }

  console.log(`${vinculos.length} lead(s) travados:`);
  console.log('');
  for (const v of vinculos.slice(0, 40)) {
    const nome = v.lead.empresa ?? v.lead.nomeCompleto ?? '(sem nome)';
    console.log(
      `  ${nome.slice(0, 40).padEnd(42)} ${v.status} / ${v.lead.temperatura}`
    );
  }
  if (vinculos.length > 40) console.log(`  ... e mais ${vinculos.length - 40}.`);

  const canceladas = await prisma.outboundMessage.count({
    where: { status: 'CANCELADA', erro: MOTIVO },
  });

  console.log('');
  console.log('O que o reparo faz:');
  console.log('  - destrava o vínculo (aguardandoLiberacao volta a false);');
  console.log('  - devolve o status da campanha, saindo de PAUSADO;');
  console.log('  - devolve o lead para FRIO — ele nunca respondeu nada;');
  console.log('  - devolve o status do lead para AGUARDANDO_RESPOSTA;');
  console.log(`  - reagenda ${canceladas} mensagem(ns) que o botão cancelou.`);
  console.log('');
  console.log('O que ele NÃO faz:');
  console.log('  - não apaga a marcação "já mandei". Ela é verdade, e é');
  console.log('    ela que mantém esses leads fora de "não responderam".');
  console.log('');

  if (!aplicar) {
    console.log('Nada foi alterado. Para aplicar de verdade:');
    console.log('');
    console.log('  pnpm reparar-ja-mandei --aplicar');
    console.log('');
    await prisma.$disconnect();
    return;
  }

  let destravados = 0;
  let esfriados = 0;

  for (const v of vinculos) {
    // O status ANTERIOR nao foi guardado em lugar nenhum, entao ele e
    // reconstruido: quem ja recebeu alguma coisa estava esperando
    // resposta; quem nao recebeu nada estava na fila. E uma
    // reconstrucao, e nao o passado exato — mas as duas alternativas
    // (deixar PAUSADO, ou chutar EM_ANDAMENTO) erram mais.
    await prisma.leadCampaign.update({
      where: { id: v.id },
      data: {
        status: v.totalEnviadas > 0 ? 'AGUARDANDO_RESPOSTA' : 'PENDENTE',
        aguardandoLiberacao: false,
        motivoParada: null,
      },
    });
    destravados += 1;

    // So mexe no lead se ele ficou no estado que o botao criou. Um lead
    // que voce moveu a mao depois disso nao pode ser desfeito por aqui.
    if (v.lead.status === 'EM_CONVERSA' && v.lead.temperatura === 'QUENTE') {
      await prisma.lead.update({
        where: { id: v.leadId },
        data: {
          status: 'AGUARDANDO_RESPOSTA',
          temperatura: 'FRIO',
          proximaAcao: null,
        },
      });
      esfriados += 1;
    }
  }

  // As mensagens que o botao cancelou voltam para a fila. Sem isto, o
  // conserto destravaria o vinculo e mesmo assim nada sairia — a ordem
  // de envio continuaria CANCELADA.
  const reagendadas = await prisma.outboundMessage.updateMany({
    where: { status: 'CANCELADA', erro: MOTIVO },
    data: { status: 'AGENDADA', erro: null },
  });

  console.log('--- APLICADO ---');
  console.log(`  vínculos destravados:    ${destravados}`);
  console.log(`  leads esfriados:         ${esfriados}`);
  console.log(`  mensagens reagendadas:   ${reagendadas.count}`);
  console.log('');
  console.log('Se a campanha estiver PAUSADA, ative-a para a fila andar.');
  console.log('');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
