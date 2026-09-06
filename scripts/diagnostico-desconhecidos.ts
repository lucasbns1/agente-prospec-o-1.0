/**
 * As respostas que viraram "contato desconhecido" e nao deviam ter virado.
 *
 * ============================================================
 * A PERGUNTA QUE ISTO RESPONDE
 * ============================================================
 * "Oito ou nove pessoas pediram a previa e o dashboard nao atualizou."
 *
 * Elas responderam. A mensagem chegou. So que o telefone vinha do
 * WhatsApp na forma antiga — doze digitos, sem o nono — e a normalizacao
 * devolvia "telefone fixo com prefixo invalido". Sem telefone nao ha
 * lead; sem lead a mensagem virava um contato desconhecido e a cadencia
 * ficava parada esperando uma resposta que ja tinha chegado.
 *
 * A normalizacao foi corrigida. Este script olha os desconhecidos que
 * ficaram para tras e diz quais deles JA casam com um lead agora.
 *
 * ============================================================
 * ELE SO LE
 * ============================================================
 * Nenhum create, update ou delete. Nenhuma mensagem e enviada, nenhuma
 * cadencia anda. Religar de verdade e a varredura que faz, e ela passa
 * pelo mesmo pipeline de sempre — este script existe para voce ver o
 * tamanho do estrago antes de mexer em qualquer coisa.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });

async function main(): Promise<void> {
  const { prisma } = await import('../packages/database/src/index.js');
  const { normalizarTelefone } = await import('../packages/domain/src/index.js');

  const desconhecidos = await prisma.unknownContact.findMany({
    where: { resolvido: false },
    orderBy: { createdAt: 'asc' },
  });

  console.log('');
  console.log('='.repeat(70));
  console.log(`CONTATOS DESCONHECIDOS NAO RESOLVIDOS: ${desconhecidos.length}`);
  console.log('='.repeat(70));

  if (desconhecidos.length === 0) {
    console.log('Nada aqui. Nenhuma resposta se perdeu.');
    return;
  }

  let casam = 0;
  let continuamSemLead = 0;
  const semTelefone: string[] = [];

  for (const d of desconhecidos) {
    const tel = normalizarTelefone(d.telefone);

    if (!tel.e164) {
      semTelefone.push(`${d.telefone} — ${tel.motivoInvalido}`);
      continue;
    }

    const leads = await prisma.lead.findMany({
      where: { telefoneNormalizado: tel.e164 },
      select: { id: true, empresa: true, nomeCompleto: true },
    });

    if (leads.length === 0) {
      continuamSemLead += 1;
      continue;
    }

    casam += 1;
    const quem = leads[0]!.empresa ?? leads[0]!.nomeCompleto ?? leads[0]!.id;
    const texto = d.texto.length > 60 ? `${d.texto.slice(0, 60)}…` : d.texto;
    console.log('');
    console.log(`  ${d.telefone}  ->  ${tel.e164}`);
    console.log(`  LEAD: ${quem}${leads.length > 1 ? `  (+${leads.length - 1} candidatos)` : ''}`);
    console.log(`  DISSE: ${texto}`);
    console.log(`  em ${d.createdAt.toISOString()}`);
  }

  console.log('');
  console.log('-'.repeat(70));
  console.log(`  casam com um lead agora:      ${casam}`);
  console.log(`  continuam sem lead nenhum:    ${continuamSemLead}`);
  console.log(`  telefone ainda invalido:      ${semTelefone.length}`);
  for (const s of semTelefone.slice(0, 10)) console.log(`      ${s}`);

  if (casam > 0) {
    console.log('');
    console.log('  Estas respostas existiam e o sistema nao viu.');
    console.log('  A varredura religa elas ao passar pelo arquivo do WhatsApp.');
  }
  console.log('');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
