/**
 * Conserta a direcao das mensagens que o resgate gravou errado.
 *
 * ============================================================
 * O ERRO
 * ============================================================
 * `reparar-lid --aplicar` gravou 124 mensagens como RECEBIDA — todas.
 * Mas os contatos desconhecidos guardavam mensagens dos DOIS lados da
 * conversa, e boa parte delas era do proprio usuario:
 *
 *   "Prontinho, e isto aqui: auto-art-builder.lovable.app"
 *   "Normalmente cobro R$650 reais pelo desenvolvimento do site"
 *
 * Eu nao conferi de quem era antes de gravar. O efeito e um painel que
 * conta as SUAS mensagens como resposta do lead — um numero inflado por
 * cima de outro numero ja inflado pelas respostas automaticas.
 *
 * ============================================================
 * DE ONDE VEM A VERDADE
 * ============================================================
 * O `UnknownContact` nao guarda de quem foi a mensagem. O arquivo do
 * Baileys guarda: cada mensagem la tem `fromMe`, e a chave e a mesma
 * (`id` no arquivo = `providerMessageId` no banco = `whatsappMessageId`
 * na mensagem).
 *
 * Entao cruzamos, e viramos para ENVIADA o que saiu de voce.
 *
 * ============================================================
 * POR QUE VIRAR, E NAO APAGAR
 * ============================================================
 * A mensagem aconteceu. Ela pertence ao historico daquela conversa, e
 * apaga-la deixaria o dialogo sem sentido para quem for ler depois — e
 * para a IA, que usa o historico como contexto. O que estava errado era
 * o LADO, e nao a existencia.
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });

const aplicar = process.argv.includes('--aplicar');

interface LinhaDoArquivo {
  id?: unknown;
  fromMe?: unknown;
}

/** `id` da mensagem -> saiu de mim? */
function lerQuemMandou(caminho: string): Map<string, boolean> {
  const mapa = new Map<string, boolean>();
  try {
    const dados: unknown = JSON.parse(readFileSync(caminho, 'utf8'));
    if (!Array.isArray(dados)) return mapa;
    for (const linha of dados as LinhaDoArquivo[]) {
      if (typeof linha?.id === 'string' && typeof linha?.fromMe === 'boolean') {
        mapa.set(linha.id, linha.fromMe);
      }
    }
  } catch {
    // Arquivo ausente ou ilegivel: devolve vazio, e quem chama avisa.
  }
  return mapa;
}

async function main(): Promise<void> {
  const { prisma } = await import('../packages/database/src/index.js');
  const { carregarEnv } = await import('../packages/config/src/index.js');

  const env = carregarEnv();
  const arquivo = path.resolve(
    raiz,
    'apps/worker',
    env.WHATSAPP_SESSION_PATH,
    'arquivo-mensagens.json'
  );

  console.log('');
  console.log('='.repeat(70));
  console.log(`ARQUIVO: ${arquivo}`);

  const quemMandou = lerQuemMandou(arquivo);
  console.log(`MENSAGENS NO ARQUIVO: ${quemMandou.size}`);
  console.log('='.repeat(70));

  if (quemMandou.size === 0) {
    console.log('');
    console.log('Arquivo vazio ou ausente. Sem ele nao da para saber de quem');
    console.log('foi cada mensagem — e chutar seria repetir o erro.');
    return;
  }

  // So as que o resgate criou: elas tem `whatsappMessageId` igual ao
  // `providerMessageId` de um contato desconhecido ja resolvido.
  const resolvidos = await prisma.unknownContact.findMany({
    where: { resolvido: true },
    select: { providerMessageId: true },
  });
  const ids = resolvidos.map((r) => r.providerMessageId);

  const mensagens = await prisma.message.findMany({
    where: { whatsappMessageId: { in: ids }, direcao: 'RECEBIDA' },
    select: { id: true, whatsappMessageId: true, texto: true, leadId: true },
  });

  console.log('');
  console.log(`Mensagens gravadas pelo resgate: ${mensagens.length}`);

  let minhas = 0;
  let doLead = 0;
  let semInformacao = 0;

  for (const m of mensagens) {
    const saiuDeMim = m.whatsappMessageId
      ? quemMandou.get(m.whatsappMessageId)
      : undefined;

    if (saiuDeMim === undefined) {
      semInformacao += 1;
      continue;
    }
    if (!saiuDeMim) {
      doLead += 1;
      continue;
    }

    minhas += 1;
    const t = m.texto.length > 64 ? `${m.texto.slice(0, 64)}…` : m.texto;
    console.log(`  SUA:  ${t.replace(/\n/g, ' ')}`);

    if (aplicar) {
      // Vira o lado, e mantem a linha: a mensagem aconteceu, e apaga-la
      // deixaria o dialogo sem sentido para quem ler depois — e para a
      // IA, que usa o historico como contexto.
      await prisma.message.update({
        where: { id: m.id },
        data: { direcao: 'ENVIADA', status: 'ENVIADA' },
      });
    }
  }

  // ============================================================
  // O CONTADOR DO VINCULO TAMBEM FICOU PARA TRAS
  // ============================================================
  // `LeadCampaign.totalRecebidas` e um atalho de leitura: quem escreve
  // e o pipeline de recebimento, e o resgate gravou as mensagens sem
  // passar por ele. Resultado: o diagnostico mostrava "recebidas 0"
  // logo abaixo de tres respostas listadas.
  //
  // A verdade sao as MENSAGENS; o contador e copia. Entao ele e
  // recontado a partir delas, e nao incrementado — recontar e
  // idempotente, e rodar isto duas vezes nao infla nada.
  let contadores = 0;
  if (aplicar) {
    const vinculos = await prisma.leadCampaign.findMany({
      select: { id: true, leadId: true, totalRecebidas: true },
    });

    for (const v of vinculos) {
      const quantas = await prisma.message.count({
        where: { leadId: v.leadId, direcao: 'RECEBIDA' },
      });
      if (quantas === v.totalRecebidas) continue;

      await prisma.leadCampaign.update({
        where: { id: v.id },
        data: { totalRecebidas: quantas },
      });
      contadores += 1;
    }
  }

  console.log('');
  console.log('-'.repeat(70));
  console.log(`  eram SUAS (gravadas como resposta):  ${minhas}`);
  console.log(`  eram do lead de verdade:             ${doLead}`);
  console.log(`  sem informacao no arquivo:           ${semInformacao}`);
  console.log('');

  if (!aplicar && minhas > 0) {
    console.log('  Nada foi alterado. Para corrigir:');
    console.log('     pnpm reparar-direcao --aplicar');
  } else if (aplicar && minhas > 0) {
    console.log(`  ${minhas} mensagens viraram ENVIADA.`);
    console.log('  O painel para de contar as suas como resposta do lead.');
    if (contadores > 0) {
      console.log(`  ${contadores} contadores de "recebidas" recontados.`);
    }
  }

  if (semInformacao > 0) {
    console.log('');
    console.log(`  As ${semInformacao} sem informacao ficam como estao. O arquivo`);
    console.log('  nao alcanca todas — e chutar o lado seria repetir o erro.');
  }
  console.log('');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
