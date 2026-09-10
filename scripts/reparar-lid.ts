/**
 * Devolve o dono das respostas que chegaram como `@lid`.
 *
 * ============================================================
 * O QUE ACONTECEU
 * ============================================================
 * O WhatsApp vem migrando conversas para endereco de privacidade
 * (`@lid`), que NAO e telefone. O sistema nao lia o campo onde o numero
 * real vinha, entao a resposta chegava com telefone vazio, nao casava
 * com lead nenhum e virava "contato desconhecido".
 *
 * No banco real: 148 contatos desconhecidos, 137 deles sem telefone.
 * Entre eles, gente que pediu previa, perguntou preco e fechou.
 *
 * ============================================================
 * POR QUE ELAS SAO RECUPERAVEIS
 * ============================================================
 * Eu disse antes que nao eram, porque o numero nunca foi gravado no
 * banco. Estava errado: o numero nao esta no banco, mas esta no DISCO.
 *
 * O proprio Baileys mantem o mapa LID <-> telefone na pasta da sessao,
 * um arquivo por contato:
 *
 *   lid-mapping-<lid>_reverse.json   -> o telefone daquele LID
 *   lid-mapping-<telefone>.json      -> o LID daquele telefone
 *
 * O `chatId` do contato desconhecido esta gravado no banco. Cruzando os
 * dois, o dono aparece.
 *
 * ============================================================
 * ELE NAO ENVIA NADA
 * ============================================================
 * Sem `--aplicar`, so relata. Com `--aplicar`, grava duas coisas: a
 * ligacao do contato com o lead, e a mensagem no historico — sem a
 * segunda, o painel continua dizendo "Responderam: 0", porque ele conta
 * MENSAGENS, e nao contatos resolvidos.
 *
 * O que ele NAO faz: avancar etapa, enfileirar, disparar cadencia.
 * Gravar direto no banco nao passa por `processarMensagemRecebida`, que
 * e quem aciona tudo isso. Religar uma conversa nao pode virar mensagem
 * saindo para gente que voce ja atendeu na mao.
 */
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });

const aplicar = process.argv.includes('--aplicar');

/**
 * O mapa LID -> telefone, lido da pasta da sessao.
 *
 * O conteudo de cada arquivo e o valor cru gravado pelo Baileys: quase
 * sempre uma string JSON com os digitos. Aceitamos as duas formas
 * (`"5535..."` e `5535...`) porque o formato ja mudou entre versoes e
 * quebrar aqui custaria o resgate inteiro.
 */
function lerMapaLid(pastaSessao: string): Map<string, string> {
  const mapa = new Map<string, string>();

  let arquivos: string[];
  try {
    arquivos = readdirSync(pastaSessao);
  } catch {
    return mapa;
  }

  for (const nome of arquivos) {
    const casa = /^lid-mapping-(\d+)_reverse\.json$/.exec(nome);
    if (!casa) continue;

    const lid = casa[1]!;
    try {
      const bruto = readFileSync(path.join(pastaSessao, nome), 'utf8').trim();
      const valor: unknown = bruto.startsWith('"') ? JSON.parse(bruto) : bruto;
      const digitos = String(valor).replace(/\D/g, '');
      // Menos de 8 digitos nao e telefone de ninguem.
      if (digitos.length >= 8) mapa.set(lid, digitos);
    } catch {
      // Um arquivo ilegivel nao pode derrubar o resgate dos outros.
    }
  }

  return mapa;
}

async function main(): Promise<void> {
  const { prisma, Prisma } = await import('../packages/database/src/index.js');
  const { normalizarTelefone } = await import('../packages/domain/src/index.js');
  const { carregarEnv } = await import('../packages/config/src/index.js');

  const env = carregarEnv();
  // O caminho da sessao e relativo a pasta do WORKER, e nao a raiz — e
  // por isso que procurar em `./data/whatsapp` na raiz nao acha nada.
  const pastaSessao = path.resolve(raiz, 'apps/worker', env.WHATSAPP_SESSION_PATH);

  console.log('');
  console.log('='.repeat(70));
  console.log(`PASTA DA SESSAO: ${pastaSessao}`);

  const mapa = lerMapaLid(pastaSessao);
  console.log(`MAPA LID -> TELEFONE: ${mapa.size} contatos`);
  console.log('='.repeat(70));

  if (mapa.size === 0) {
    console.log('');
    console.log('Nenhum mapa encontrado. Ou a pasta esta errada, ou a sessao');
    console.log('foi apagada. Sem o mapa nao ha como devolver o dono.');
    return;
  }

  const desconhecidos = await prisma.unknownContact.findMany({
    where: { resolvido: false },
    orderBy: { createdAt: 'asc' },
  });

  let resolvidos = 0;
  let semMapa = 0;
  let semLead = 0;
  let jaTinhaTelefone = 0;
  let gravadas = 0;

  for (const d of desconhecidos) {
    // So interessam os que chegaram SEM telefone. Quem ja tinha numero
    // falhou por outro motivo, e chutar um LID por cima seria pior.
    if (d.telefone && d.telefone.replace(/\D/g, '').length >= 8) {
      jaTinhaTelefone += 1;
      continue;
    }

    const lid = /^(\d+)@lid$/.exec(d.chatId ?? '')?.[1];
    if (!lid) {
      semMapa += 1;
      continue;
    }

    const bruto = mapa.get(lid);
    if (!bruto) {
      semMapa += 1;
      continue;
    }

    const tel = normalizarTelefone(bruto);
    if (!tel.e164) {
      semMapa += 1;
      continue;
    }

    const leads = await prisma.lead.findMany({
      where: { telefoneNormalizado: tel.e164 },
      select: { id: true, empresa: true, nomeCompleto: true },
    });

    if (leads.length === 0) {
      semLead += 1;
      continue;
    }

    resolvidos += 1;
    const quem = leads[0]!.empresa ?? leads[0]!.nomeCompleto ?? leads[0]!.id;
    const texto = d.texto.length > 70 ? `${d.texto.slice(0, 70)}…` : d.texto;

    console.log('');
    console.log(`  ${d.createdAt.toISOString().slice(0, 16).replace('T', ' ')}`);
    console.log(`  LID ${lid}  ->  ${tel.e164}`);
    console.log(`  LEAD: ${quem}${leads.length > 1 ? `  (+${leads.length - 1} candidatos)` : ''}`);
    console.log(`  DISSE: ${texto}`);

    if (aplicar) {
      const leadId = leads[0]!.id;

      // ============================================================
      // A MENSAGEM ENTRA NO HISTORICO, MAS NAO NA CADENCIA
      // ============================================================
      // Sem a linha em `messages`, o painel continua dizendo
      // "Responderam: 0" — ele conta mensagens, e nao contatos
      // desconhecidos resolvidos.
      //
      // Gravar aqui, direto, NAO aciona cadencia: quem aciona e
      // `processarMensagemRecebida`, e nada disto passa por ele. Nenhuma
      // etapa anda, nenhum envio e enfileirado.
      //
      // E ha um efeito colateral bom: com a linha gravada, o
      // `whatsapp_message_id` (UNIQUE) faz a varredura RECONHECER esta
      // mensagem como ja processada. Sem isso, ela seria reprocessada na
      // proxima reconciliacao — aí sim acionando a cadencia, e mandando
      // a etapa 3 para gente que so tinha uma resposta automatica de
      // WhatsApp Business.
      const conversa = await prisma.conversation.findFirst({
        where: { leadId },
        select: { id: true },
      });

      const conversaId =
        conversa?.id ??
        (
          await prisma.conversation.create({
            data: {
              leadId,
              chatId: d.chatId ?? `${tel.e164}@c.us`,
              ultimaMensagemEm: d.recebidaEm ?? d.createdAt,
              ultimaMensagemTexto: d.texto.slice(0, 200),
            },
            select: { id: true },
          })
        ).id;

      try {
        await prisma.message.create({
          data: {
            conversationId: conversaId,
            leadId,
            direcao: 'RECEBIDA',
            status: 'ENTREGUE',
            texto: d.texto,
            whatsappMessageId: d.providerMessageId,
            recebidaEm: d.recebidaEm ?? d.createdAt,
          },
        });
        gravadas += 1;
      } catch (err) {
        // Ja existir e o caso bom: a mensagem entrou por outro caminho.
        if (
          !(err instanceof Prisma.PrismaClientKnownRequestError) ||
          err.code !== 'P2002'
        ) {
          throw err;
        }
      }

      await prisma.unknownContact.update({
        where: { id: d.id },
        data: {
          telefone: tel.e164,
          resolvido: true,
          resolvidoLeadId: leadId,
          resolvidoEm: new Date(),
        },
      });
    }
  }

  console.log('');
  console.log('-'.repeat(70));
  console.log(`  voltaram a ter dono:        ${resolvidos}`);
  console.log(`  sem mapa para o LID:        ${semMapa}`);
  console.log(`  telefone achado, sem lead:  ${semLead}`);
  console.log(`  ja tinham telefone:         ${jaTinhaTelefone}`);
  console.log('');

  if (!aplicar && resolvidos > 0) {
    console.log('  Nada foi gravado. Para aplicar:');
    console.log('     pnpm reparar-lid --aplicar');
  } else if (aplicar && resolvidos > 0) {
    console.log(`  ${resolvidos} contatos religados ao lead.`);
    console.log(`  ${gravadas} mensagens gravadas no historico.`);
    console.log('');
    console.log('  Nenhuma mensagem foi enviada e nenhuma cadencia andou.');
    console.log('  ATENCAO: boa parte destas "respostas" e resposta');
    console.log('  automatica de WhatsApp Business, e nao gente. O painel');
    console.log('  vai conta-las em "Responderam" — o numero fica inflado.');
  }
  console.log('');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
