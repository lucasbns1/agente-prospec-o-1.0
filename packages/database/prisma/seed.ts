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
const SOCIAL_DOMAINS: Array<{ dominio: string; rotulo: string }> = [
  { dominio: 'instagram.com', rotulo: 'Instagram' },
  { dominio: 'facebook.com', rotulo: 'Facebook' },
  { dominio: 'fb.com', rotulo: 'Facebook (curto)' },
  { dominio: 'm.facebook.com', rotulo: 'Facebook (mobile)' },
];

// -----------------------------------------------------------------------------
// 3. DICIONARIO DO MOTOR DE REGRAS
//
// Estes sao os termos INICIAIS. Voce pode adicionar, remover, desativar e
// mudar o tipo de comparacao de cada um pelo painel de configuracoes.
// -----------------------------------------------------------------------------
const KEYWORDS: Array<{
  categoria: RespostaCategoria;
  termos: Array<[string, MatchTipo, number?]>;
}> = [
  {
    categoria: RespostaCategoria.OPT_OUT,
    termos: [
      ['pare', MatchTipo.PALAVRA, 10],
      ['para de mandar', MatchTipo.CONTEM, 10],
      ['nao me mande mais', MatchTipo.CONTEM, 10],
      ['nao me mande mensagem', MatchTipo.CONTEM, 10],
      ['nao quero receber mensagens', MatchTipo.CONTEM, 10],
      ['nao quero receber mais', MatchTipo.CONTEM, 10],
      ['remova meu contato', MatchTipo.CONTEM, 10],
      ['remove meu contato', MatchTipo.CONTEM, 10],
      ['me remove', MatchTipo.CONTEM, 10],
      ['me tira da lista', MatchTipo.CONTEM, 10],
      ['descadastrar', MatchTipo.CONTEM, 10],
      ['nao perturbe', MatchTipo.CONTEM, 10],
      ['vou denunciar', MatchTipo.CONTEM, 10],
      ['spam', MatchTipo.PALAVRA, 5],
    ],
  },
  {
    categoria: RespostaCategoria.NEGATIVO,
    termos: [
      ['nao', MatchTipo.EXATO, 5],
      ['nao obrigado', MatchTipo.CONTEM, 8],
      ['nao obrigada', MatchTipo.CONTEM, 8],
      ['nao quero', MatchTipo.CONTEM, 8],
      ['nao tenho interesse', MatchTipo.CONTEM, 9],
      ['sem interesse', MatchTipo.CONTEM, 9],
      ['nao preciso', MatchTipo.CONTEM, 8],
      ['ja tenho', MatchTipo.CONTEM, 7],
      ['nao me interessa', MatchTipo.CONTEM, 9],
      ['agradeco mas nao', MatchTipo.CONTEM, 9],
      ['no momento nao', MatchTipo.CONTEM, 7],
    ],
  },
  {
    categoria: RespostaCategoria.FALAR_DEPOIS,
    termos: [
      ['depois', MatchTipo.PALAVRA, 4],
      ['mais tarde', MatchTipo.CONTEM, 6],
      ['agora nao posso', MatchTipo.CONTEM, 8],
      ['agora estou ocupado', MatchTipo.CONTEM, 8],
      ['agora estou ocupada', MatchTipo.CONTEM, 8],
      ['me chama depois', MatchTipo.CONTEM, 8],
      ['me chama amanha', MatchTipo.CONTEM, 8],
      ['fala comigo amanha', MatchTipo.CONTEM, 8],
      ['semana que vem', MatchTipo.CONTEM, 7],
      ['outro dia', MatchTipo.CONTEM, 6],
      ['estou em atendimento', MatchTipo.CONTEM, 7],
      ['to ocupado', MatchTipo.CONTEM, 7],
      ['to ocupada', MatchTipo.CONTEM, 7],
    ],
  },
  {
    categoria: RespostaCategoria.PRECO,
    termos: [
      ['quanto', MatchTipo.PALAVRA, 6],
      ['quanto custa', MatchTipo.CONTEM, 9],
      ['quanto fica', MatchTipo.CONTEM, 9],
      ['quanto sai', MatchTipo.CONTEM, 9],
      ['qual o valor', MatchTipo.CONTEM, 9],
      ['qual valor', MatchTipo.CONTEM, 9],
      ['qual o preco', MatchTipo.CONTEM, 9],
      ['preco', MatchTipo.PALAVRA, 7],
      ['valores', MatchTipo.PALAVRA, 6],
      ['orcamento', MatchTipo.PALAVRA, 7],
      ['investimento', MatchTipo.PALAVRA, 5],
      ['e caro', MatchTipo.CONTEM, 6],
    ],
  },
  {
    categoria: RespostaCategoria.DUVIDA,
    termos: [
      ['como funciona', MatchTipo.CONTEM, 8],
      ['me explica', MatchTipo.CONTEM, 7],
      ['explica melhor', MatchTipo.CONTEM, 7],
      ['nao entendi', MatchTipo.CONTEM, 8],
      ['o que e', MatchTipo.CONTEM, 5],
      ['quem e voce', MatchTipo.CONTEM, 7],
      ['quem fala', MatchTipo.CONTEM, 6],
      ['de onde voce e', MatchTipo.CONTEM, 6],
      ['que empresa', MatchTipo.CONTEM, 6],
      ['do que se trata', MatchTipo.CONTEM, 7],
      ['como assim', MatchTipo.CONTEM, 6],
    ],
  },
  {
    categoria: RespostaCategoria.POSITIVO,
    termos: [
      ['sim', MatchTipo.EXATO, 8],
      ['s', MatchTipo.EXATO, 3],
      ['sou eu', MatchTipo.CONTEM, 7],
      ['sim sou eu', MatchTipo.CONTEM, 9],
      ['pode', MatchTipo.EXATO, 6],
      ['pode sim', MatchTipo.CONTEM, 9],
      ['pode mandar', MatchTipo.CONTEM, 9],
      ['pode mostrar', MatchTipo.CONTEM, 9],
      ['pode me mostrar', MatchTipo.CONTEM, 9],
      ['pode falar', MatchTipo.CONTEM, 8],
      ['claro', MatchTipo.PALAVRA, 7],
      ['manda', MatchTipo.PALAVRA, 7],
      ['manda ai', MatchTipo.CONTEM, 9],
      ['quero ver', MatchTipo.CONTEM, 9],
      ['quero sim', MatchTipo.CONTEM, 9],
      ['gostaria de ver', MatchTipo.CONTEM, 8],
      ['bora', MatchTipo.PALAVRA, 6],
      ['vamos', MatchTipo.PALAVRA, 5],
      ['ok', MatchTipo.EXATO, 5],
      ['isso', MatchTipo.EXATO, 5],
      ['exato', MatchTipo.EXATO, 5],
      ['positivo', MatchTipo.EXATO, 5],
      ['bom dia', MatchTipo.CONTEM, 2],
      ['boa tarde', MatchTipo.CONTEM, 2],
    ],
  },
  {
    categoria: RespostaCategoria.INTERESSE,
    termos: [
      ['interessante', MatchTipo.PALAVRA, 5],
      ['legal', MatchTipo.PALAVRA, 4],
      ['bacana', MatchTipo.PALAVRA, 4],
      ['gostei', MatchTipo.PALAVRA, 6],
      ['ficou bom', MatchTipo.CONTEM, 6],
      ['ficou otimo', MatchTipo.CONTEM, 6],
      ['muito bom', MatchTipo.CONTEM, 5],
      ['adorei', MatchTipo.PALAVRA, 6],
      ['top', MatchTipo.EXATO, 4],
      ['show', MatchTipo.EXATO, 4],
      ['massa', MatchTipo.EXATO, 4],
    ],
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
      create: { dominio: d.dominio, rotulo: d.rotulo, padrao: true },
    });
  }
  console.log(`  [ok] ${SOCIAL_DOMAINS.length} dominios sociais (nao contam como site proprio)`);

  // --- Dicionario de regras ---
  let totalTermos = 0;
  for (const grupo of KEYWORDS) {
    for (const [texto, matchTipo, peso] of grupo.termos) {
      const termo = normalizarTermo(texto);
      // Nao da para usar upsert aqui: o unique composto inclui
      // campaignStepId, que e NULL nos termos globais, e o Prisma nao
      // aceita NULL dentro de um `where` de chave composta.
      const existente = await prisma.responseKeyword.findFirst({
        where: { categoria: grupo.categoria, termo, campaignStepId: null },
      });
      if (existente) {
        await prisma.responseKeyword.update({
          where: { id: existente.id },
          data: { matchTipo, peso: peso ?? 0 },
        });
      } else {
        await prisma.responseKeyword.create({
          data: {
            categoria: grupo.categoria,
            termo,
            matchTipo,
            peso: peso ?? 0,
            padrao: true,
          },
        });
      }
      totalTermos++;
    }
  }
  console.log(`  [ok] ${totalTermos} termos do motor de regras em ${KEYWORDS.length} categorias`);

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
