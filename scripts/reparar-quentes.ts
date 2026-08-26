/**
 * Desfaz os leads que o eco marcou como QUENTE.
 *
 * ============================================================
 * O ESTRAGO
 * ============================================================
 * `message_create` do whatsapp-web.js dispara para TUDO que sai do
 * numero conectado — o que voce digita no celular E o que o worker
 * acabou de enviar. Os dois chegavam como `deMim: true`.
 *
 * A separacao entre eles apostava que o worker ja teria gravado a linha
 * em `messages` quando o eco chegasse. Ele nao grava antes: envia,
 * marca ENVIADA, e so entao grava. O eco chegava no meio.
 *
 * Resultado numa base real: 46 leads QUENTE com UMA resposta. Cada
 * mensagem da campanha voltava como se fosse voce assumindo a conversa
 * a mao — marcando o lead EM_CONVERSA/QUENTE e PAUSANDO a automacao
 * dele.
 *
 * O conserto no codigo ja impede novos casos. Este script limpa os que
 * ja aconteceram.
 *
 * ============================================================
 * COMO ELE RECONHECE UM CASO
 * ============================================================
 * O eco deixou tres marcas juntas, e sao as tres que ele exige:
 *
 *   1. um `LeadEvent` com origem `whatsapp-manual`;
 *   2. cujo texto da mensagem corresponde a uma ORDEM DE ENVIO daquele
 *      lead — ou seja, era mensagem da campanha, e nao sua;
 *   3. e o lead NUNCA respondeu nada.
 *
 * A terceira e a mais importante. Um lead que respondeu de verdade pode
 * estar QUENTE por merito proprio, e este script nao encosta nele.
 *
 * ============================================================
 * ELE NAO APAGA NADA POR PADRAO
 * ============================================================
 * Rodar sem argumento so MOSTRA o que seria feito. Para aplicar:
 *
 *   pnpm reparar-quentes --aplicar
 */

async function main(): Promise<void> {
  const { config } = await import('dotenv');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const raiz = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  );
  config({ path: path.join(raiz, '.env') });

  // Caminho relativo, e nao o nome do pacote: `scripts/` nao e um
  // workspace, entao o resolvedor nao enxerga `@prospector/*` daqui.
  const { prisma } = await import('../packages/database/src/index.js');

  const aplicar = process.argv.includes('--aplicar');

  console.log('');
  console.log('=========================================================');
  console.log('  REPARO: leads marcados QUENTE pelo eco dos envios');
  console.log('=========================================================');
  console.log('');

  // --- Quem realmente falou alguma coisa ---
  const responderam = await prisma.message.findMany({
    where: { direcao: 'RECEBIDA' },
    select: { leadId: true },
    distinct: ['leadId'],
  });
  const falaram = new Set(
    responderam.map((r) => r.leadId).filter((id): id is string => id !== null)
  );

  // --- Os leads que foram tratados como "voce assumiu a conversa" ---
  const marcas = await prisma.leadEvent.findMany({
    where: { origem: 'whatsapp-manual' },
    select: { id: true, leadId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const suspeitos = [...new Set(marcas.map((m) => m.leadId))].filter(
    (id) => !falaram.has(id)
  );

  if (suspeitos.length === 0) {
    console.log('Nada a reparar: nenhum lead foi marcado pelo eco.');
    console.log('');
    await prisma.$disconnect();
    return;
  }

  // --- Dos suspeitos, quais tinham mesmo texto de campanha? ---
  //
  // Confere lead a lead: as mensagens ENVIADAS sem etapa (a assinatura
  // do eco) cujo texto bate com uma ordem de envio daquele lead.
  const paraReparar: { id: string; nome: string; status: string; temp: string }[] =
    [];

  for (const leadId of suspeitos) {
    const semEtapa = await prisma.message.findMany({
      where: { leadId, direcao: 'ENVIADA', campaignStepId: null },
      select: { texto: true },
    });
    if (semEtapa.length === 0) continue;

    const ordens = await prisma.outboundMessage.findMany({
      where: { leadId, textoRenderizado: { not: null } },
      select: { textoRenderizado: true },
    });
    const textosDaCampanha = new Set(
      ordens
        .map((o) => o.textoRenderizado)
        .filter((t): t is string => t !== null)
    );

    const bateu = semEtapa.some((m) => textosDaCampanha.has(m.texto));
    if (!bateu) continue;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, nomeCompleto: true, empresa: true, status: true, temperatura: true },
    });
    if (!lead) continue;

    paraReparar.push({
      id: lead.id,
      nome: lead.empresa ?? lead.nomeCompleto ?? '(sem nome)',
      status: lead.status,
      temp: lead.temperatura,
    });
  }

  if (paraReparar.length === 0) {
    console.log('Nada a reparar: nenhum caso confirmado.');
    console.log('');
    await prisma.$disconnect();
    return;
  }

  console.log(`${paraReparar.length} lead(s) foram marcados pelo eco:`);
  console.log('');
  for (const l of paraReparar.slice(0, 40)) {
    console.log(`  ${l.nome}  —  ${l.status} / ${l.temp}`);
  }
  if (paraReparar.length > 40) {
    console.log(`  ... e mais ${paraReparar.length - 40}.`);
  }
  console.log('');
  console.log('O que o reparo faz em cada um:');
  console.log('  - devolve a temperatura para FRIO;');
  console.log('  - devolve o status para AGUARDANDO_RESPOSTA;');
  console.log('  - limpa a "próxima ação" que dizia que você conduzia;');
  console.log('  - RETOMA a automação que tinha sido pausada;');
  console.log('  - RELIGA as mensagens do eco à etapa certa (não apaga);');
  console.log('  - apaga os eventos "você respondeu manualmente".');
  console.log('');

  if (!aplicar) {
    console.log('Nada foi alterado. Para aplicar de verdade:');
    console.log('');
    console.log('  pnpm reparar-quentes --aplicar');
    console.log('');
    await prisma.$disconnect();
    return;
  }

  const ids = paraReparar.map((l) => l.id);

  // O lead volta para "recebeu e nao respondeu", que e a verdade: ele
  // recebeu a campanha e ficou calado.
  const leads = await prisma.lead.updateMany({
    where: { id: { in: ids } },
    data: {
      temperatura: 'FRIO',
      status: 'AGUARDANDO_RESPOSTA',
      proximaAcao: null,
    },
  });

  // A automacao pausada volta a andar. Sem isto, o conserto no codigo
  // nao adianta: a sequencia destes leads seguiria congelada.
  const vinculos = await prisma.leadCampaign.updateMany({
    where: {
      leadId: { in: ids },
      aguardandoLiberacao: true,
      motivoParada: { contains: 'assumiu' },
    },
    data: {
      status: 'AGUARDANDO_RESPOSTA',
      aguardandoLiberacao: false,
      motivoParada: null,
    },
  });

  // ============================================================
  // AS MENSAGENS DO ECO SAO CONSERTADAS, E NAO APAGADAS
  // ============================================================
  // A primeira versao deste script apagava as linhas sem etapa. Estava
  // errado: quando o eco venceu a corrida, foi a linha DELE que ficou
  // com o `whatsapp_message_id`, e o worker — ao bater na UNIQUE —
  // vinculou o envio a ela. Apagar levaria junto a mensagem que aparece
  // na conversa, e o /conversas ficaria com um buraco.
  //
  // O que falta nela e so a etapa. Entao ela recebe a etapa da ordem de
  // envio que tem o mesmo texto, e vira a linha correta.
  let mensagens = 0;
  for (const leadId of ids) {
    const semEtapa = await prisma.message.findMany({
      where: { leadId, direcao: 'ENVIADA', campaignStepId: null },
      select: { id: true, texto: true },
    });
    if (semEtapa.length === 0) continue;

    const ordens = await prisma.outboundMessage.findMany({
      where: { leadId, textoRenderizado: { not: null } },
      select: { campaignStepId: true, campaignId: true, textoRenderizado: true },
    });

    for (const m of semEtapa) {
      const ordem = ordens.find((o) => o.textoRenderizado === m.texto);
      if (!ordem?.campaignStepId) continue;

      await prisma.message.update({
        where: { id: m.id },
        data: {
          campaignStepId: ordem.campaignStepId,
          campaignId: ordem.campaignId,
        },
      });
      mensagens += 1;
    }
  }

  const eventos = await prisma.leadEvent.deleteMany({
    where: { leadId: { in: ids }, origem: 'whatsapp-manual' },
  });

  console.log('--- APLICADO ---');
  console.log(`  leads corrigidos:        ${leads.count}`);
  console.log(`  automações retomadas:    ${vinculos.count}`);
  console.log(`  mensagens religadas:     ${mensagens}`);
  console.log(`  eventos do eco:          ${eventos.count} apagados`);
  console.log('');
  console.log('Recarregue o dashboard.');
  console.log('');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
