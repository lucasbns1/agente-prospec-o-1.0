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

  // ============================================================
  // ZERO PRECISA DIZER *QUAL* ZERO
  // ============================================================
  // A primeira versao imprimia "Nada aqui. Nenhuma resposta se perdeu."
  // sempre que a contagem dava zero — inclusive num banco VAZIO, onde o
  // certo seria dizer "nao ha dado nenhum para olhar".
  //
  // Aconteceu na pratica: o script rodou num computador diferente, com
  // outro banco, e anunciou que nada tinha se perdido. Um diagnostico
  // que da a resposta tranquilizadora quando nao sabe de nada e pior do
  // que nenhum diagnostico.
  const [totalLeads, totalMensagens, desconhecidos] = await Promise.all([
    prisma.lead.count(),
    prisma.message.count(),
    prisma.unknownContact.findMany({
      where: { resolvido: false },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  console.log('');
  console.log('='.repeat(70));
  console.log(`BANCO: ${totalLeads} leads, ${totalMensagens} mensagens no historico`);
  console.log(`CONTATOS DESCONHECIDOS NAO RESOLVIDOS: ${desconhecidos.length}`);
  console.log('='.repeat(70));

  if (totalLeads === 0) {
    console.log('');
    console.log('ESTE BANCO ESTA VAZIO — nao ha lead nenhum cadastrado.');
    console.log('');
    console.log('Entao o zero acima nao significa "nada se perdeu": significa');
    console.log('que nao ha nada aqui para se perder. Se voce esperava ver');
    console.log('seus leads, este e outro banco (outro computador, ou o');
    console.log('DATABASE_URL do .env apontando para outro lugar).');
    return;
  }

  if (desconhecidos.length === 0) {
    console.log('Nada aqui. Nenhuma resposta ficou sem lead.');
    return;
  }

  let casam = 0;
  let continuamSemLead = 0;

  // ============================================================
  // A LISTA QUE IMPORTA ERA A QUE ESTE SCRIPT ESCONDIA
  // ============================================================
  // A primeira versao so imprimia o que JA casa com um lead, e resumia o
  // resto num contador. No banco real isso deu "casam: 0" e
  // "telefone invalido: 137" — ou seja, ele calou justamente as 137
  // conversas que a pessoa queria ler, entre elas as que pediram a
  // previa do site.
  //
  // Um diagnostico existe para mostrar o que aconteceu, e nao para
  // resumi-lo a um numero. Agora as sem telefone saem com chatId, texto
  // e data: e o suficiente para achar a conversa no WhatsApp na mao.
  const semTelefone: Array<{
    chatId: string | null;
    nome: string | null;
    texto: string;
    quando: Date;
    motivo: string;
  }> = [];

  for (const d of desconhecidos) {
    const tel = normalizarTelefone(d.telefone);

    if (!tel.e164) {
      semTelefone.push({
        chatId: d.chatId,
        nome: d.nomeContato,
        texto: d.texto,
        quando: d.createdAt,
        motivo: tel.motivoInvalido ?? 'sem motivo',
      });
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

  // ------------------------------------------------------------------
  // AS QUE CHEGARAM SEM TELEFONE — o grosso do estrago
  // ------------------------------------------------------------------
  if (semTelefone.length > 0) {
    console.log('');
    console.log('='.repeat(70));
    console.log(`SEM TELEFONE: ${semTelefone.length}`);
    console.log('='.repeat(70));
    console.log('');
    console.log('A mensagem chegou; o telefone nao veio junto. Quase sempre');
    console.log('e uma conversa `@lid` (endereco de privacidade do WhatsApp),');
    console.log('cujo numero real vinha num campo que o sistema nao lia.');
    console.log('');
    console.log('Elas NAO sao recuperaveis a partir daqui: o numero nunca foi');
    console.log('gravado. O que da para fazer e ler o que a pessoa escreveu e');
    console.log('achar a conversa no WhatsApp pelo texto.');

    // Mais recentes primeiro: e o que a pessoa esta procurando agora.
    const ordenadas = [...semTelefone].sort(
      (a, b) => b.quando.getTime() - a.quando.getTime()
    );

    for (const s of ordenadas) {
      console.log('');
      console.log(`  [${s.quando.toISOString().slice(0, 16).replace('T', ' ')}]`);
      if (s.nome) console.log(`  NOME NO WHATSAPP: ${s.nome}`);
      if (s.chatId) console.log(`  CONVERSA: ${s.chatId}`);
      console.log(`  DISSE: ${s.texto}`);
    }

    // Uma palavra de interesse vale mais que o total: e por ela que se
    // acha "quem pediu a previa" no meio de cento e trinta e sete.
    const interesse = ordenadas.filter((s) =>
      /pr[ée]via|previa|site|quero|manda|envia|interesse|pre[cç]o|valor|quanto/i.test(
        s.texto
      )
    );
    if (interesse.length > 0) {
      console.log('');
      console.log('-'.repeat(70));
      console.log(`  DESSAS, ${interesse.length} falam em previa, site, preco ou querer:`);
      for (const s of interesse) {
        const t = s.texto.length > 70 ? `${s.texto.slice(0, 70)}…` : s.texto;
        console.log(`     ${s.quando.toISOString().slice(0, 10)}  ${s.nome ?? s.chatId ?? '?'}  —  ${t}`);
      }
    }
  }

  console.log('');
  console.log('-'.repeat(70));
  console.log(`  casam com um lead agora:      ${casam}`);
  console.log(`  continuam sem lead nenhum:    ${continuamSemLead}`);
  console.log(`  chegaram sem telefone:        ${semTelefone.length}`);

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
