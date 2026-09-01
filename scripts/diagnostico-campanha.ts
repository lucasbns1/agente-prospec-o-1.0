/**
 * De onde vieram os leads que esta campanha esta mandando mensagem.
 *
 * ============================================================
 * A PERGUNTA QUE ISTO RESPONDE
 * ============================================================
 * "Ele pegou clientes que nem estavam na lista que eu mandei, pegou de
 * outras listas."
 *
 * Uma campanha escolhe seu publico por FILTRO, e nao por uma copia da
 * planilha. Se o filtro nao tiver `importIds` nem `captureSessionIds`, o
 * publico e o CRM INTEIRO — todas as planilhas que voce ja importou, de
 * todos os nichos e cidades. A tela nao grita isso, e o efeito so
 * aparece quando as mensagens ja sairam.
 *
 * Este script mostra, para cada campanha: o filtro guardado, e de qual
 * planilha veio cada lead que ela ja pegou. Se aparecer mais de uma
 * planilha, esta e a explicacao.
 *
 * ============================================================
 * SO LE
 * ============================================================
 * Nenhum create, update ou delete. Rodar isto nao muda nada e nao manda
 * mensagem nenhuma.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });

interface Filtros {
  importIds?: string[];
  captureSessionIds?: string[];
  cidades?: string[];
  estados?: string[];
  categorias?: string[];
  [k: string]: unknown;
}

async function main(): Promise<void> {
  const { prisma } = await import('../packages/database/src/index.js');

  const campanhas = await prisma.campaign.findMany({
    select: { id: true, nome: true, filtros: true, status: true, maxLeads: true },
    orderBy: { createdAt: 'desc' },
  });

  if (campanhas.length === 0) {
    console.log('Nenhuma campanha cadastrada.');
    return;
  }

  for (const c of campanhas) {
    const f = (c.filtros ?? {}) as Filtros;
    const temLote =
      (f.importIds?.length ?? 0) > 0 || (f.captureSessionIds?.length ?? 0) > 0;

    console.log('');
    console.log('='.repeat(70));
    console.log(`CAMPANHA: ${c.nome}`);
    console.log(`status: ${c.status}   maxLeads: ${c.maxLeads}`);
    console.log('-'.repeat(70));

    if (!temLote) {
      console.log('PUBLICO: TODO O CRM  <-- nenhuma planilha escolhida.');
      console.log('   Toda lead importada, de qualquer lista, entra nesta');
      console.log('   campanha se passar pelos outros filtros.');
    } else {
      console.log('PUBLICO: restrito a planilha(s) escolhida(s).');
      if (f.importIds?.length) console.log(`   importIds: ${f.importIds.length}`);
      if (f.captureSessionIds?.length) {
        console.log(`   captureSessionIds: ${f.captureSessionIds.length}`);
      }
    }

    const outros = ['cidades', 'estados', 'categorias'] as const;
    for (const k of outros) {
      const v = f[k];
      if (Array.isArray(v) && v.length > 0) console.log(`   ${k}: ${v.join(', ')}`);
    }

    // De qual planilha vieram os leads que a campanha JA pegou. E o que
    // prova a mistura: uma campanha de Minas com leads de um import de
    // Sao Paulo aparece aqui como duas linhas.
    const vinculos = await prisma.leadCampaign.findMany({
      where: { campaignId: c.id },
      select: { lead: { select: { importId: true, captureSessionId: true, estado: true } } },
    });

    if (vinculos.length === 0) {
      console.log('   (nenhum lead vinculado ainda)');
      continue;
    }

    const porImport = new Map<string, number>();
    const porEstado = new Map<string, number>();
    for (const v of vinculos) {
      const chave = v.lead.importId ?? v.lead.captureSessionId ?? '(sem planilha)';
      porImport.set(chave, (porImport.get(chave) ?? 0) + 1);
      const uf = v.lead.estado ?? '(sem UF)';
      porEstado.set(uf, (porEstado.get(uf) ?? 0) + 1);
    }

    console.log('-'.repeat(70));
    console.log(`LEADS NA CAMPANHA: ${vinculos.length}`);
    console.log(`   planilhas de origem: ${porImport.size}`);
    for (const [k, n] of [...porImport].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${k}: ${n}`);
    }
    console.log(`   por estado:`);
    for (const [k, n] of [...porEstado].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${k}: ${n}`);
    }

    if (porImport.size > 1) {
      console.log('');
      console.log('   >>> MAIS DE UMA PLANILHA. E esta a mistura que voce viu.');
    }
  }

  console.log('');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
