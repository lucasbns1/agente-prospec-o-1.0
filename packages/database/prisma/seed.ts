/**
 * Seed — popula o banco com as configuracoes padrao.
 *
 * Tudo o que este arquivo insere e EDITAVEL pelo painel depois. Nada aqui
 * e regra de codigo: sao apenas valores iniciais razoaveis, gravados no
 * banco, para o sistema nao nascer vazio.
 *
 * Rodar:  pnpm db:seed
 * E idempotente — pode rodar quantas vezes quiser sem duplicar nada.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import hash from 'argon2';
// O cliente gerado do Prisma e CommonJS. Em ESM, os enums nao aparecem
// como named exports estaticos — e preciso desestruturar do default.
import prismaPkg from '@prisma/client';
import { DICIONARIO_PADRAO } from '@prospector/domain';
const { PrismaClient, MatchTipo, RespostaCategoria } = prismaPkg;
type MatchTipo = prismaPkg.MatchTipo;
type RespostaCategoria = prismaPkg.RespostaCategoria;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

// -----------------------------------------------------------------------------
// Normalizacao dos termos
//
// Os termos sao gravados JA normalizados, para a comparacao em runtime ser
// uma simples igualdade/inclusao de strings — sem processar o dicionario a
// cada mensagem recebida.
// -----------------------------------------------------------------------------
function normalizarTermo(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos (marcas combinantes)
    .replace(/[^\w\s]/g, ' ') // remove pontuacao
    .replace(/\s+/g, ' ')
    .trim();
}

// -----------------------------------------------------------------------------
// 1. CONFIGURACOES GERAIS
// -----------------------------------------------------------------------------
const SETTINGS: Array<{
  chave: string;
  valor: unknown;
  descricao: string;
  categoria: string;
  sistema?: boolean;
}> = [
  {
    chave: 'regras.precedencia',
    valor: [
      'OPT_OUT',
      'NEGATIVO',
      'FALAR_DEPOIS',
      'PRECO',
      'DUVIDA',
      'POSITIVO',
      'INTERESSE',
      'DESCONHECIDO',
    ],
    descricao:
      'Ordem em que as categorias sao avaliadas. A primeira que casar decide a acao. OPT_OUT no topo garante que um pedido de remocao nunca seja tratado como outra coisa.',
    categoria: 'regras',
    sistema: true,
  },
  {
    chave: 'envio.delay_min_segundos',
    valor: 180,
    descricao: 'Delay minimo entre mensagens da sequencia (padrao: 3 minutos).',
    categoria: 'envio',
  },
  {
    chave: 'envio.delay_max_segundos',
    valor: 240,
    descricao: 'Delay maximo entre mensagens da sequencia (padrao: 4 minutos). O valor real e sorteado no intervalo.',
    categoria: 'envio',
  },
  {
    chave: 'envio.delay_entre_leads_min_segundos',
    valor: 60,
    descricao: 'Delay minimo entre o primeiro disparo de um lead e o do proximo. Evita disparo simultaneo para a lista inteira.',
    categoria: 'envio',
  },
  {
    chave: 'envio.delay_entre_leads_max_segundos',
    valor: 180,
    descricao: 'Delay maximo entre o primeiro disparo de leads diferentes.',
    categoria: 'envio',
  },
  {
    chave: 'envio.limite_diario',
    valor: 50,
    descricao:
      'Teto de mensagens REAIS enviadas por dia. Simulacoes (dry-run) e falhas nao contam. Ao atingir, os jobs ficam na fila para o dia seguinte.',
    categoria: 'envio',
  },
  {
    chave: 'envio.horario_inicio',
    valor: '08:00',
    descricao: 'Nao enviar antes deste horario.',
    categoria: 'envio',
  },
  {
    chave: 'envio.horario_fim',
    valor: '20:00',
    descricao: 'Nao enviar depois deste horario.',
    categoria: 'envio',
  },
  {
    chave: 'envio.dias_semana',
    valor: [1, 2, 3, 4, 5],
    descricao: 'Dias em que o envio e permitido (0=domingo ... 6=sabado).',
    categoria: 'envio',
  },
  {
    chave: 'snooze.unidade_padrao',
    valor: 'DIAS',
    descricao: 'Unidade padrao ao adiar um lead que pediu para falar depois.',
    categoria: 'snooze',
  },
  {
    chave: 'snooze.valor_padrao',
    valor: 3,
    descricao: 'Quanto adiar por padrao (3 dias). Cancelado automaticamente se o lead responder antes.',
    categoria: 'snooze',
  },
  {
    chave: 'whatsapp.modo',
    valor: 'dry-run',
    descricao:
      'dry-run = simula os envios, nada sai de verdade. live = envia via whatsapp-web.js. A variavel WHATSAPP_MODE do .env tem precedencia sobre esta chave.',
    categoria: 'whatsapp',
    sistema: true,
  },
  {
    chave: 'leads.deduplicacao',
    valor: {
      prioridade_1: 'telefone_normalizado',
      prioridade_2: 'nome_completo + endereco',
      prioridade_3: 'nome_completo + cidade',
    },
    descricao: 'Criterios de deduplicacao, em ordem de prioridade.',
    categoria: 'leads',
    sistema: true,
  },
  {
    chave: 'leads.telefone_ddi_padrao',
    valor: '55',
    descricao: 'DDI assumido quando o telefone importado nao traz codigo de pais.',
    categoria: 'leads',
  },
];

// -----------------------------------------------------------------------------
// 2. DOMINIOS SOCIAIS
//
// Sites nestes dominios NAO contam como site proprio.
// Um dominio desconhecido NUNCA e classificado como social automaticamente:
// so entra nesta lista por decisao explicita do usuario.
// -----------------------------------------------------------------------------
// `incluirSubdominios: true` faz "instagram.com" ja cobrir
// www.instagram.com, m.instagram.com e br.instagram.com — nao e preciso
// cadastrar cada variacao.
const SOCIAL_DOMAINS: Array<{ dominio: string; rotulo: string }> = [
  { dominio: 'instagram.com', rotulo: 'Instagram' },
  { dominio: 'facebook.com', rotulo: 'Facebook' },
  { dominio: 'fb.com', rotulo: 'Facebook (curto)' },
];

// -----------------------------------------------------------------------------
// 3. DICIONARIO DO MOTOR DE REGRAS
//
// Estes sao os termos INICIAIS. Voce pode adicionar, remover, desativar e
// mudar o tipo de comparacao de cada um pelo painel de configuracoes.
// -----------------------------------------------------------------------------
// O dicionario vem de `@prospector/domain` — a MESMA fonte que os
// testes exercitam. Assim nao existe divergencia entre o que e testado
// e o que vai para o banco.
const KEYWORDS = DICIONARIO_PADRAO;

// -----------------------------------------------------------------------------
// 4. TEMPLATES DE RESPOSTA
//
// Textos INICIAIS, editaveis pelo painel. O motor de regras nunca
// escreve resposta: ele so devolve o templateId, e o texto sai daqui.
// -----------------------------------------------------------------------------
const TEMPLATES: Array<{
  templateId: string;
  categoria: string;
  subtipo: string | null;
  nome: string;
  texto: string;
}> = [
  {
    templateId: 'template_preco_01',
    categoria: 'PRECO',
    subtipo: null,
    nome: 'Resposta padrao de preco',
    texto:
      'Boa pergunta! O valor depende do que voce precisa. ' +
      'Posso te passar os detalhes agora?',
  },
  {
    templateId: 'template_duvida_01',
    categoria: 'DUVIDA',
    subtipo: null,
    nome: 'Resposta padrao de duvida',
    texto: 'Claro, posso explicar. O que exatamente voce gostaria de entender melhor?',
  },
  {
    templateId: 'template_interesse_01',
    categoria: 'INTERESSE',
    subtipo: null,
    nome: 'Resposta padrao de interesse',
    texto: 'Que bom que achou interessante! Quer que eu te mostre com mais detalhes?',
  },
];

// -----------------------------------------------------------------------------
// Execucao
// -----------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log('\n=== SEED DO PROSPECTOR ===\n');

  // --- Configuracoes ---
  for (const s of SETTINGS) {
    await prisma.setting.upsert({
      where: { chave: s.chave },
      // Nao sobrescreve valores que voce ja ajustou no painel.
      update: { descricao: s.descricao, categoria: s.categoria },
      create: {
        chave: s.chave,
        valor: s.valor as never,
        descricao: s.descricao,
        categoria: s.categoria,
        sistema: s.sistema ?? false,
      },
    });
  }
  console.log(`  [ok] ${SETTINGS.length} configuracoes`);

  // --- Dominios sociais ---
  for (const d of SOCIAL_DOMAINS) {
    await prisma.socialDomain.upsert({
      where: { dominio: d.dominio },
      update: { rotulo: d.rotulo },
      create: {
        dominio: d.dominio,
        rotulo: d.rotulo,
        padrao: true,
        incluirSubdominios: true,
      },
    });
  }
  console.log(`  [ok] ${SOCIAL_DOMAINS.length} dominios sociais (nao contam como site proprio)`);

  // --- Dicionario de regras ---
  let totalTermos = 0;
  {
    for (const item of KEYWORDS) {
      const { categoria, matchTipo, peso, subtipo } = item;
      const termo = normalizarTermo(item.termo);
      // Nao da para usar upsert aqui: o unique composto inclui
      // campaignStepId, que e NULL nos termos globais, e o Prisma nao
      // aceita NULL dentro de um `where` de chave composta.
      const existente = await prisma.responseKeyword.findFirst({
        where: { categoria, termo, campaignStepId: null },
      });
      if (existente) {
        await prisma.responseKeyword.update({
          where: { id: existente.id },
          data: { matchTipo, peso, subtipo },
        });
      } else {
        await prisma.responseKeyword.create({
          data: { categoria, termo, matchTipo, peso, subtipo, padrao: true },
        });
      }
      totalTermos++;
    }
  }
  const categorias = new Set(KEYWORDS.map((k) => k.categoria)).size;
  console.log(`  [ok] ${totalTermos} termos do motor de regras em ${categorias} categorias`);

  // --- Templates de resposta ---
  for (const tpl of TEMPLATES) {
    await prisma.responseTemplate.upsert({
      where: { templateId: tpl.templateId },
      update: { nome: tpl.nome },
      create: {
        templateId: tpl.templateId,
        categoria: tpl.categoria as never,
        subtipo: tpl.subtipo,
        nome: tpl.nome,
        texto: tpl.texto,
        padrao: true,
      },
    });
  }
  console.log(`  [ok] ${TEMPLATES.length} templates de resposta`);

  // --- Usuario inicial ---
  const email = process.env.SEED_USER_EMAIL ?? 'admin@local';
  const nome = process.env.SEED_USER_NAME ?? 'Administrador';
  const senha = process.env.SEED_USER_PASSWORD;

  if (!senha) {
    console.log(
      '\n  [!] SEED_USER_PASSWORD nao definida no .env — usuario NAO criado.\n' +
        '      Defina a variavel e rode `pnpm db:seed` novamente.\n'
    );
  } else {
    const existente = await prisma.user.findUnique({ where: { email } });
    if (existente) {
      console.log(`  [ok] usuario ja existe: ${email} (senha nao alterada)`);
    } else {
      const senhaHash = await hash.hash(senha, { type: hash.argon2id });
      await prisma.user.create({ data: { email, nome, senhaHash } });
      console.log(`  [ok] usuario criado: ${email}`);
    }
  }

  console.log('\n=== SEED CONCLUIDO ===\n');
}

main()
  .catch((e) => {
    console.error('\n[ERRO NO SEED]', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
