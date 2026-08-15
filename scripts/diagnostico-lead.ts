/**
 * Por que este lead nao andou?
 *
 * ============================================================
 * POR QUE ISTO EXISTE
 * ============================================================
 * Quando a sequencia para, a resposta esta espalhada por seis tabelas:
 * a mensagem recebida e sua classificacao, o vinculo lead<->campanha, a
 * fila de saida, as regras da etapa, o historico e as notificacoes.
 *
 * Olhar isso pela tela exige abrir cinco lugares e cruzar na cabeca.
 * Perguntar "o que apareceu na tela?" e pior ainda: a tela mostra o
 * resultado, nao a causa.
 *
 * Este script imprime tudo em ordem cronologica e, no fim, aponta a
 * causa mais provavel. Ele SO LE — nao altera nada.
 *
 *   pnpm diagnostico
 *   pnpm diagnostico -- 5511984110705
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });

const alvo = process.argv.slice(2).find((a) => /^\d{8,15}$/.test(a)) ?? null;

function titulo(t: string): void {
  console.log(`\n${'='.repeat(60)}\n${t}\n${'='.repeat(60)}`);
}

function hora(d: Date | null): string {
  return d ? d.toLocaleString('pt-BR') : '—';
}

async function main(): Promise<void> {
  const { prisma } = await import('../packages/database/src/index.js');

  // --- Lead ---
  const lead = alvo
    ? await prisma.lead.findFirst({ where: { telefoneNormalizado: alvo } })
    : await prisma.lead.findFirst({ orderBy: { createdAt: 'desc' } });

  if (!lead) {
    console.log('\nNenhum lead no banco. Importe a planilha primeiro.\n');
    await prisma.$disconnect();
    return;
  }

  titulo('LEAD');
  console.log(`  nome            ${lead.nomeCompleto ?? '—'}`);
  console.log(`  empresa         ${lead.empresa ?? '—'}`);
  console.log(`  nome_contato    ${lead.nomeContato ?? '— (não é pessoa, correto)'}`);
  console.log(`  telefone        ${lead.telefoneNormalizado ?? '—'}`);
  console.log(`  cidade/bairro   ${lead.cidade ?? '—'} / ${lead.bairro ?? '—'}`);
  console.log(`  status          ${lead.status}`);
  console.log(`  temperatura     ${lead.temperatura}`);
  console.log(`  opt-out         ${lead.optOut}`);

  // --- Campanha e etapas ---
  const campanha = await prisma.campaign.findFirst({
    orderBy: { createdAt: 'desc' },
    include: {
      steps: {
        orderBy: { ordem: 'asc' },
        include: { _count: { select: { rules: true } } },
      },
    },
  });

  titulo('CAMPANHA');
  if (!campanha) {
    console.log('  NENHUMA campanha. Crie uma.');
  } else {
    console.log(`  nome            ${campanha.nome}`);
    console.log(`  status          ${campanha.status}`);
    console.log(`  simulação       ${campanha.dryRun ? 'LIGADA (nada sai)' : 'desligada'}`);
    console.log(`  janela          ${campanha.horarioInicio}–${campanha.horarioFim}`);
    console.log(`  dias            ${JSON.stringify(campanha.diasPermitidos)}`);
    console.log(
      `  entre etapas    ${campanha.delayMinSegundos}–${campanha.delayMaxSegundos}s`
    );
    console.log(`\n  ETAPAS (${campanha.steps.length}):`);
    for (const s of campanha.steps) {
      const regras = s._count.rules;
      // `aguardarResposta` decide QUAL das duas cadencias vale, e por
      // isso e a informacao mais importante desta tela. Sem ela, dois
      // sintomas identicos ("a mensagem 2 nao veio") tem causas
      // opostas: uma espera resposta que nao chegou, a outra deveria
      // ter andado sozinha e nao andou.
      console.log(
        `    ${s.ordem}. ${s.ativo ? 'ativa  ' : 'INATIVA'} ` +
          `| ${regras} regra(s)${regras === 0 ? '  <<< SEM REGRA' : ''}` +
          `| ${s.aguardarResposta ? 'ESPERA RESPOSTA' : 'anda sozinha'}` +
          `${s.enviarAutomaticamente ? '' : ' | MANUAL'}` +
          `${s.notificarAoChegar ? ' | avisa ao chegar' : ''}`
      );
      console.log(`       "${s.texto.slice(0, 70)}${s.texto.length > 70 ? '…' : ''}"`);
    }

    const etapa1 = campanha.steps[0];
    if (etapa1) {
      const regras = await prisma.campaignStepRule.findMany({
        where: { campaignStepId: etapa1.id },
        orderBy: { categoria: 'asc' },
      });
      console.log(`\n  REGRAS DA ETAPA 1:`);
      if (regras.length === 0) {
        console.log('    NENHUMA — toda resposta vai virar intervenção manual.');
        console.log('    Conserto: abra a campanha, aba Etapas, clique em Salvar.');
      }
      for (const r of regras) {
        console.log(`    ${r.categoria.padEnd(14)} -> ${r.acao}`);
      }
    }
  }

  // --- Vinculo ---
  const vinculo = await prisma.leadCampaign.findFirst({
    where: { leadId: lead.id },
    include: { etapaAtual: { select: { ordem: true } } },
  });

  titulo('ONDE O LEAD ESTÁ');
  if (!vinculo) {
    console.log('  Sem vínculo com campanha — ele nunca foi enfileirado.');
  } else {
    console.log(`  status          ${vinculo.status}`);
    console.log(
      `  etapa atual     ${vinculo.etapaAtual ? `etapa ${vinculo.etapaAtual.ordem}` : '— (nada enviado ainda)'}`
    );
    console.log(`  enviadas        ${vinculo.totalEnviadas}`);
    console.log(`  recebidas       ${vinculo.totalRecebidas}`);
    console.log(`  aguarda você    ${vinculo.aguardandoLiberacao}`);
    if (vinculo.motivoParada) console.log(`  motivo parada   ${vinculo.motivoParada}`);
  }

  // --- Fila ---
  const fila = await prisma.outboundMessage.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: 'asc' },
    include: { campaignStep: { select: { ordem: true } } },
  });

  titulo(`FILA DE SAÍDA (${fila.length})`);
  for (const m of fila) {
    console.log(
      `  etapa ${m.campaignStep?.ordem ?? '?'} | ${m.status.padEnd(11)}` +
        `${m.dryRun ? ' [SIMULADA]' : ''} | agendada ${hora(m.scheduledAt)}`
    );
    if (m.motivoBloqueio) console.log(`      bloqueio: ${m.motivoBloqueio} — ${m.detalheBloqueio ?? ''}`);
    if (m.erro) console.log(`      erro: ${m.erro}`);
  }
  if (fila.length === 0) console.log('  (vazia)');

  // --- Mensagens recebidas ---
  const recebidas = await prisma.message.findMany({
    where: { leadId: lead.id, direcao: 'RECEBIDA' },
    orderBy: { createdAt: 'asc' },
  });

  titulo(`RESPOSTAS DELE (${recebidas.length})`);
  for (const m of recebidas) {
    console.log(`  ${hora(m.recebidaEm)}  "${m.texto}"`);
    console.log(
      `      classificada: ${m.categoria ?? '—'} (confiança ${m.confianca ?? '—'})`
    );
  }
  if (recebidas.length === 0) {
    console.log('  NENHUMA resposta chegou ao sistema.');
    console.log('  Se você respondeu no WhatsApp, o worker não recebeu o evento.');
  }

  // ------------------------------------------------------------
  // TESTE DE CLASSIFICACAO
  //
  // Roda o texto pelo motor REAL, com o dicionario REAL do banco. Sem
  // isto, "sera que ele entende 'claro'?" so da para responder olhando
  // codigo — e o que esta no codigo pode nao ser o que esta no banco
  // desta maquina.
  // ------------------------------------------------------------
  titulo('O MOTOR ENTENDE ESTAS RESPOSTAS?');
  {
    const { classificarResposta, PRECEDENCIA_PADRAO } = await import(
      '../packages/domain/src/rules/motor.js'
    );
    const keywords = await prisma.responseKeyword.findMany({ where: { ativo: true } });
    const termos = keywords.map((k) => ({
      id: k.id,
      categoria: k.categoria,
      termo: k.termo,
      matchTipo: k.matchTipo,
      peso: k.peso,
      ativo: k.ativo,
      subtipo: k.subtipo,
      campaignStepId: k.campaignStepId,
    }));

    const setting = await prisma.setting.findUnique({
      where: { chave: 'regras.precedencia' },
    });
    const precedencia = Array.isArray(setting?.valor)
      ? (setting.valor as typeof PRECEDENCIA_PADRAO)
      : PRECEDENCIA_PADRAO;

    console.log(`  (dicionário do banco: ${termos.length} termos ativos)\n`);

    // As ultimas respostas reais primeiro; depois alguns padroes, para
    // dar referencia de quanto vale cada tipo de "sim".
    const amostras = [
      ...recebidas.slice(-3).map((m) => m.texto),
      'claro!',
      'quero sim',
      'pode',
      'ok',
    ];

    for (const texto of [...new Set(amostras)]) {
      const r = classificarResposta(texto, { termos, precedencia, campaignStepId: null });
      const agiria = r.confianca >= 50;
      console.log(
        `  "${texto.slice(0, 40)}"`.padEnd(46) +
          `${r.categoria} (${r.confianca}) ` +
          `${agiria ? '-> age sozinho' : '-> CHAMA VOCÊ (confiança < 50)'}`
      );
    }
  }

  // --- Contatos desconhecidos ---
  const desconhecidos = await prisma.unknownContact.count();
  if (desconhecidos > 0) {
    console.log(
      `\n  ATENÇÃO: ${desconhecidos} mensagem(ns) caíram como "contato desconhecido".`
    );
    console.log('  Isso significa que a resposta chegou mas não foi ligada ao lead.');
  }

  // --- Historico ---
  const eventos = await prisma.leadEvent.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: 'asc' },
    take: 40,
  });

  titulo(`HISTÓRICO (${eventos.length})`);
  for (const e of eventos) {
    console.log(`  ${hora(e.createdAt)}  [${e.tipo}] ${e.descricao}`);
  }

  // --- Notificacoes ---
  const notifs = await prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  titulo(`NOTIFICAÇÕES (${notifs.length})`);
  for (const n of notifs) {
    console.log(`  [${n.tipo}] ${n.titulo}`);
  }

  // ------------------------------------------------------------
  // AS FILAS DO REDIS
  //
  // O banco vazio tem duas causas muito diferentes, e ate agora nao
  // dava para distinguir:
  //
  //   a) o evento do WhatsApp nunca chegou     -> fila vazia
  //   b) chegou, entrou na fila e travou la    -> fila com jobs presos
  //
  // Sao consertos opostos. Olhar so o Postgres mostra "0 respostas" nos
  // dois casos.
  //
  // `failed` e o mais importante: um job que falhou 3 vezes fica ali em
  // silencio. Ninguem olha o Redis, e a mensagem do cliente some sem
  // deixar rastro em lugar nenhum.
  // ------------------------------------------------------------
  titulo('FILAS (Redis)');
  try {
    const { Queue } = await import('bullmq');
    const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    const connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.password ? { password: url.password } : {}),
      maxRetriesPerRequest: null,
    };

    for (const nome of ['process_incoming_message', 'outbound_send']) {
      const q = new Queue(nome, { connection });
      const c = await q.getJobCounts(
        'waiting', 'active', 'delayed', 'completed', 'failed'
      );
      console.log(
        `  ${nome.padEnd(26)} aguardando ${c.waiting} | ativo ${c.active} | ` +
          `adiado ${c.delayed} | concluído ${c.completed} | FALHOU ${c.failed}`
      );

      if ((c.failed ?? 0) > 0) {
        const falhos = await q.getFailed(0, 4);
        for (const j of falhos) {
          console.log(`      job ${j.id}: ${j.failedReason?.slice(0, 160) ?? '?'}`);
        }
      }
      await q.close();
    }
  } catch (err) {
    console.log(`  Não consegui ler as filas: ${String(err)}`);
    console.log('  O Memurai/Redis está rodando?');
  }

  // Marca do reset — se ela for depois da resposta, a varredura ignora.
  const marca = await prisma.setting.findUnique({
    where: { chave: 'canal.varredura_desde' },
  });
  if (typeof marca?.valor === 'string') {
    console.log(
      `\n  varredura ignora respostas anteriores a ${new Date(marca.valor).toLocaleString('pt-BR')}`
    );
  }

  // ------------------------------------------------------------
  // VEREDICTO
  //
  // Escrito como uma cascata na ordem em que as coisas acontecem: a
  // primeira condicao que falha e a causa, e as seguintes sao
  // consequencia dela. Apontar a ultima seria mandar voce consertar um
  // sintoma.
  // ------------------------------------------------------------
  titulo('CAUSA MAIS PROVÁVEL');

  const semRegras =
    campanha?.steps.some((s) => s._count.rules === 0) ?? false;
  const etapasAtivas = campanha?.steps.filter((s) => s.ativo).length ?? 0;

  // Qual cadencia esta configurada na etapa em que o lead parou. As
  // duas falham do mesmo jeito visto de fora ("a mensagem 2 nao veio")
  // e por motivos opostos.
  const etapaDoLead = campanha?.steps.find((s) => s.id === vinculo?.etapaAtualId);
  const esperaResposta = etapaDoLead?.aguardarResposta ?? true;

  if (!campanha) {
    console.log('  Não há campanha.');
  } else if (etapasAtivas < 2) {
    console.log(`  A campanha tem ${etapasAtivas} etapa(s) ativa(s).`);
    console.log('  Sem uma etapa 2, não há para onde avançar: a resposta');
    console.log('  positiva encerra a sequência em vez de continuar.');
  } else if (semRegras) {
    console.log('  Há etapa SEM REGRA. Sem regra para POSITIVO, o motor não');
    console.log('  improvisa: manda para intervenção manual, mesmo com um');
    console.log('  "quero sim" perfeito.');
    console.log('  Conserto: abra a campanha, aba Etapas, clique em Salvar.');
  } else if (recebidas.length === 0 && desconhecidos > 0) {
    console.log('  A resposta chegou mas não foi ligada a este lead —');
    console.log('  virou "contato desconhecido". Confira se o telefone do');
    console.log('  lead é o mesmo de onde você respondeu.');
  } else if (recebidas.length === 0 && esperaResposta) {
    console.log('  Nenhuma resposta chegou ao sistema, e a etapa em que o lead');
    console.log('  está ESPERA RESPOSTA — então a sequência está parada por');
    console.log('  falta de entrada, não por falha da cadência.');
    console.log('');
    console.log('  O worker estava no ar quando você respondeu? Ele só recebe');
    console.log('  ao vivo; a varredura na reconexão cobre o resto.');
  } else if (recebidas.length === 0 && !esperaResposta) {
    console.log('  A etapa em que o lead está ANDA SOZINHA, e mesmo assim a');
    console.log('  próxima não foi criada. Isto é falha da cadência automática.');
    console.log(`  Vínculo em: ${vinculo?.status ?? '—'} (esperado: EM_ANDAMENTO)`);
  } else if (campanha.dryRun) {
    console.log('  A campanha está em SIMULAÇÃO. Nada sai de verdade.');
  } else {
    const ultima = recebidas[recebidas.length - 1]!;
    if ((ultima.confianca ?? 0) < 50) {
      console.log(`  A última resposta ("${ultima.texto}") teve confiança`);
      console.log(`  ${ultima.confianca} — abaixo de 50, o mínimo para o sistema agir`);
      console.log('  sozinho. Ele classificou, registrou e chamou você.');
    } else {
      console.log('  Nada óbvio. Leia o HISTÓRICO acima de baixo para cima:');
      console.log('  a última linha diz o que o motor decidiu e por quê.');
    }
  }

  console.log('');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Falhou:', err);
  process.exit(1);
});
