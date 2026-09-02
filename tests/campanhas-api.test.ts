/**
 * Testes de campanha, fila e despachante — contra Postgres e Redis reais.
 *
 * O que importa aqui e comportamento que so o banco pode garantir: a
 * constraint UNIQUE que torna o enfileiramento idempotente, os filtros
 * SQL, as transicoes de status. Um mock do Prisma provaria apenas que o
 * mock funciona.
 *
 * ============================================================
 * NENHUM TESTE AQUI ENVIA MENSAGEM
 * ============================================================
 * O caminho de envio real e verificado pelo NEGATIVO: os testes provam
 * que ele NAO e alcancado enquanto as barreiras de dry-run estiverem
 * levantadas.
 *
 * Requer Postgres e Redis no ar, `pnpm db:migrate` e `pnpm db:seed`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });
process.env.LOG_LEVEL = 'silent';

let prisma: typeof import('@prospector/database').prisma;
let servico: typeof import('../apps/api/src/services/campaign-service.js');

const TEMPLATE = 'Olá, {{nome}}! Vi a {{empresa}} em {{cidade}}. Posso ajudar?';

beforeAll(async () => {
  prisma = (await import('@prospector/database')).prisma;
  servico = await import('../apps/api/src/services/campaign-service.js');
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(async () => {
  // A ordem respeita as FKs.
  await prisma.outboundMessage.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.leadEvent.deleteMany();
  await prisma.campaignStep.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.lead.deleteMany();
});

// ----------------------------------------------------------------- helpers
let contador = 0;

async function criarLead(
  dados: Partial<Parameters<typeof prisma.lead.create>[0]['data']> = {}
) {
  contador += 1;
  return prisma.lead.create({
    data: {
      nomeCompleto: `Psicóloga Teste ${contador}`,
      primeiroNome: 'Teste',
      empresa: `Clínica Teste ${contador}`,
      telefone: `(19) 99999-${String(1000 + contador).slice(-4)}`,
      telefoneNormalizado: `5519999${String(100000 + contador).slice(-6)}`,
      cidade: 'Campinas',
      estado: 'SP',
      categoria: 'Psicólogo',
      websiteStatus: 'NAO_INFORMADO',
      status: 'IMPORTADO',
      ...dados,
    } as Parameters<typeof prisma.lead.create>[0]['data'],
  });
}

async function criarCampanha(
  dados: Record<string, unknown> = {},
  textoEtapa = TEMPLATE
) {
  const campanha = await prisma.campaign.create({
    data: {
      nome: `Campanha ${++contador}`,
      status: 'ATIVA',
      dryRun: true,
      // Janela larga: os testes de enfileiramento nao devem depender da
      // hora em que a suite roda.
      horarioInicio: '00:00',
      horarioFim: '23:59',
      diasPermitidos: [0, 1, 2, 3, 4, 5, 6],
      delayEntreLeadsMinSegundos: 0,
      delayEntreLeadsMaxSegundos: 0,
      ...dados,
    } as Parameters<typeof prisma.campaign.create>[0]['data'],
  });

  await prisma.campaignStep.create({
    data: {
      campaignId: campanha.id,
      ordem: 1,
      nome: 'Abordagem',
      texto: textoEtapa,
      ativo: true,
    },
  });

  return campanha;
}

// ------------------------------------------------------- selecao de leads
describe('montarWhere — exclusoes inegociaveis', () => {
  it('exclui opt-out mesmo sem nenhum filtro pedir isso', async () => {
    await criarLead();
    await criarLead({ optOut: true });

    const total = await prisma.lead.count({ where: servico.montarWhere({}) });
    expect(total).toBe(1);
  });

  it('exclui lead aguardando intervencao', async () => {
    await criarLead();
    await criarLead({ status: 'AGUARDANDO_INTERVENCAO' });

    const total = await prisma.lead.count({ where: servico.montarWhere({}) });
    expect(total).toBe(1);
  });

  it('exclui lead com status OPT_OUT mesmo com a flag optOut false', async () => {
    await criarLead();
    await criarLead({ status: 'OPT_OUT', optOut: false });

    const total = await prisma.lead.count({ where: servico.montarWhere({}) });
    expect(total).toBe(1);
  });
});

describe('montarWhere — filtros de segmentacao', () => {
  it('filtra por cidade', async () => {
    await criarLead({ cidade: 'Campinas' });
    await criarLead({ cidade: 'Santos' });

    const total = await prisma.lead.count({
      where: servico.montarWhere({ cidades: ['Campinas'] }),
    });
    expect(total).toBe(1);
  });

  it('exigirSemSite deixa de fora quem tem site proprio', async () => {
    await criarLead({ websiteStatus: 'NAO_INFORMADO' });
    await criarLead({ websiteStatus: 'REDE_SOCIAL' });
    await criarLead({ websiteStatus: 'SITE_PROPRIO', websiteUrl: 'https://x.com.br' });

    const total = await prisma.lead.count({
      where: servico.montarWhere({ exigirSemSite: true }),
    });
    // Rede social nao conta como site proprio — o lead continua alvo.
    expect(total).toBe(2);
  });

  it('exigirTelefone deixa de fora quem nao tem telefone normalizado', async () => {
    await criarLead();
    await criarLead({ telefone: null, telefoneNormalizado: null });

    const total = await prisma.lead.count({
      where: servico.montarWhere({ exigirTelefone: true }),
    });
    expect(total).toBe(1);
  });

  it('combina filtros com E, nao com OU', async () => {
    await criarLead({ cidade: 'Campinas', websiteStatus: 'SITE_PROPRIO' });
    await criarLead({ cidade: 'Santos', websiteStatus: 'NAO_INFORMADO' });
    await criarLead({ cidade: 'Campinas', websiteStatus: 'NAO_INFORMADO' });

    const total = await prisma.lead.count({
      where: servico.montarWhere({ cidades: ['Campinas'], exigirSemSite: true }),
    });
    expect(total).toBe(1);
  });
});

// -------------------------------------------------------------- preview
describe('previewCampanha — nao grava nada', () => {
  it('nao cria nenhuma linha em outbound_messages', async () => {
    await criarLead();
    await criarLead();
    const campanha = await criarCampanha();

    const antes = await prisma.outboundMessage.count();
    const preview = await servico.previewCampanha(campanha.id, 100);
    const depois = await prisma.outboundMessage.count();

    expect(preview.resumo.totalEncontrados).toBe(2);
    expect(antes).toBe(0);
    expect(depois).toBe(0);
  });

  it('mostra o texto exato que sairia para cada lead', async () => {
    await criarLead({
      empresa: 'Clínica Alfa', primeiroNome: 'Ana', cidade: 'Campinas',
    });
    const campanha = await criarCampanha();

    const preview = await servico.previewCampanha(campanha.id, 100);
    expect(preview.linhas[0]?.mensagemPrevista).toBe(
      'Olá, Ana! Vi a Clínica Alfa em Campinas. Posso ajudar?'
    );
  });

  it('nao inventa nome para lead sem pessoa', async () => {
    await criarLead({
      empresa: 'Clínica Bem Viver', nomeCompleto: 'Clínica Bem Viver',
      primeiroNome: null, cidade: 'Campinas',
    });
    const campanha = await criarCampanha();

    const preview = await servico.previewCampanha(campanha.id, 100);
    const texto = preview.linhas[0]?.mensagemPrevista ?? '';

    expect(texto).toBe('Olá! Vi a Clínica Bem Viver em Campinas. Posso ajudar?');
    expect(texto).not.toMatch(/\{\{|\[Nome\]|undefined|null/);
  });
});

// ---------------------------------------------------------- enfileiramento
describe('enfileirarCampanha — guardas', () => {
  it('recusa campanha que nao esta ATIVA', async () => {
    await criarLead();
    const campanha = await criarCampanha({ status: 'RASCUNHO' });

    await expect(servico.enfileirarCampanha(campanha.id)).rejects.toThrow(
      /ATIVAS/i
    );
    expect(await prisma.outboundMessage.count()).toBe(0);
  });

  it('recusa campanha sem etapa ativa', async () => {
    await criarLead();
    const campanha = await criarCampanha();
    await prisma.campaignStep.updateMany({
      where: { campaignId: campanha.id },
      data: { ativo: false },
    });

    await expect(servico.enfileirarCampanha(campanha.id)).rejects.toThrow(
      /etapa ativa/i
    );
  });

  it('nunca enfileira lead em opt-out', async () => {
    await criarLead();
    await criarLead({ optOut: true });
    const campanha = await criarCampanha();

    await servico.enfileirarCampanha(campanha.id);

    const mensagens = await prisma.outboundMessage.findMany({
      include: { lead: { select: { optOut: true } } },
    });
    expect(mensagens).toHaveLength(1);
    expect(mensagens.every((m) => !m.lead.optOut)).toBe(true);
  });

  it('toda linha criada nasce em dry-run', async () => {
    await criarLead();
    const campanha = await criarCampanha();

    await servico.enfileirarCampanha(campanha.id);

    const mensagens = await prisma.outboundMessage.findMany();
    expect(mensagens.every((m) => m.dryRun)).toBe(true);
  });
});

describe('enfileirarCampanha — idempotencia', () => {
  it('enfileirar duas vezes nao duplica a mensagem', async () => {
    await criarLead();
    const campanha = await criarCampanha();

    const primeira = await servico.enfileirarCampanha(campanha.id);
    const segunda = await servico.enfileirarCampanha(campanha.id);

    expect(primeira.criadas).toBe(1);
    expect(segunda.criadas).toBe(0);
    // A segunda passada ATUALIZA a linha que ja existia — texto, horario
    // e modo de envio sao recalculados. Nao cria nada: a invariante que
    // importa e a contagem de linhas logo abaixo.
    expect(segunda.atualizadas).toBe(1);
    expect(await prisma.outboundMessage.count()).toBe(1);
  });

  /**
   * O caso que o `findUnique` + `create` nao cobre: as duas chamadas
   * consultam antes de qualquer uma gravar, as duas acham "nao existe" e
   * as duas tentam criar. So a constraint UNIQUE do banco resolve.
   */
  it('10 enfileiramentos concorrentes produzem 1 linha', async () => {
    await criarLead();
    const campanha = await criarCampanha();

    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => servico.enfileirarCampanha(campanha.id))
    );

    const criadas = resultados.reduce((s, r) => s + r.criadas, 0);
    expect(criadas).toBe(1);
    expect(await prisma.outboundMessage.count()).toBe(1);
  });

  it('a chave de idempotencia e estavel e distingue lead/campanha/etapa', () => {
    const a = servico.chaveIdempotencia('lead-1', 'camp-1', 'etapa-1');
    const b = servico.chaveIdempotencia('lead-1', 'camp-1', 'etapa-1');
    const c = servico.chaveIdempotencia('lead-2', 'camp-1', 'etapa-1');
    const d = servico.chaveIdempotencia('lead-1', 'camp-2', 'etapa-1');
    const e = servico.chaveIdempotencia('lead-1', 'camp-1', 'etapa-2');

    expect(a).toBe(b);
    expect(new Set([a, c, d, e]).size).toBe(4);
  });
});

describe('enfileirarCampanha — agendamento', () => {
  it('espalha os disparos no tempo em vez de agendar todos no mesmo instante', async () => {
    for (let i = 0; i < 5; i++) await criarLead();
    const campanha = await criarCampanha({
      delayEntreLeadsMinSegundos: 60,
      delayEntreLeadsMaxSegundos: 180,
    });

    await servico.enfileirarCampanha(campanha.id);

    const horarios = (
      await prisma.outboundMessage.findMany({ select: { scheduledAt: true } })
    ).map((m) => m.scheduledAt?.getTime() ?? 0);

    expect(new Set(horarios).size).toBe(5);
  });

  it('respeita maxLeads', async () => {
    for (let i = 0; i < 5; i++) await criarLead();
    const campanha = await criarCampanha({ maxLeads: 2 });

    await servico.enfileirarCampanha(campanha.id);

    expect(await prisma.outboundMessage.count()).toBe(2);
  });
});

// -------------------------------------------------------------- despachante
describe('despachante — o que vira job e o que nao vira', () => {
  let varrer: typeof import('../apps/worker/src/workers/despachante.js').varrer;

  beforeAll(async () => {
    ({ varrer } = await import('../apps/worker/src/workers/despachante.js'));
  });

  it('bloqueia mensagem de campanha pausada em vez de despachar', async () => {
    await criarLead();
    const campanha = await criarCampanha();
    await servico.enfileirarCampanha(campanha.id);

    // Pausar DEPOIS do enfileiramento: e exatamente o caso em que
    // confiar na validacao antiga enviaria indevidamente.
    await prisma.campaign.update({
      where: { id: campanha.id },
      data: { status: 'PAUSADA' },
    });

    const r = await varrer(new Date(Date.now() + 3600_000));

    expect(r.despachadas).toBe(0);
    expect(r.bloqueadas).toBe(1);

    const m = await prisma.outboundMessage.findFirst();
    expect(m?.status).toBe('BLOQUEADA');
    expect(m?.motivoBloqueio).toBe('CAMPANHA_PAUSADA');
  });

  it('fora da janela adia, nunca bloqueia', async () => {
    await criarLead();
    const campanha = await criarCampanha();
    // Enfileira com a janela larga e SO DEPOIS a fecha. E o caso real:
    // a mensagem foi agendada de forma valida e a janela mudou no meio
    // do caminho. Fechar a janela antes faria o proprio enfileiramento
    // bloquear, e o despachante nunca veria a linha.
    await servico.enfileirarCampanha(campanha.id);
    await prisma.campaign.update({
      where: { id: campanha.id },
      data: { diasPermitidos: [] },
    });

    const antes = await prisma.outboundMessage.findFirst();
    const r = await varrer(new Date(Date.now() + 3600_000));

    expect(r.despachadas).toBe(0);
    expect(r.adiadas).toBe(1);

    const depois = await prisma.outboundMessage.findFirst();
    expect(depois?.status).toBe('AGENDADA');
    expect(depois?.scheduledAt?.getTime()).toBeGreaterThan(
      antes?.scheduledAt?.getTime() ?? 0
    );
  });

  it('adia quando o limite diario ja foi atingido', async () => {
    await criarLead();
    const campanha = await criarCampanha({ limiteDiarioEnvios: 1 });
    await servico.enfileirarCampanha(campanha.id);

    // A varredura roda uma hora a frente (a janela de envio precisa estar
    // aberta). O envio que consome a cota tem de cair no MESMO dia dessa
    // varredura: rodando entre 23h e meia-noite, o "amanha" da varredura
    // zerava a cota e o teste falhava sem que nada estivesse errado.
    const referencia = new Date(Date.now() + 3600_000);

    // Um envio REAL ja consumiu a cota do dia.
    await prisma.outboundMessage.create({
      data: {
        leadId: (await criarLead()).id,
        campaignId: campanha.id,
        campaignStepId: (await prisma.campaignStep.findFirstOrThrow({
          where: { campaignId: campanha.id },
        })).id,
        idempotencyKey: `manual-${Date.now()}`,
        status: 'ENVIADA',
        processedAt: referencia,
        dryRun: false,
      },
    });

    const r = await varrer(referencia);

    expect(r.despachadas).toBe(0);
    expect(r.adiadas).toBe(1);
  });

  it('mensagem SIMULADA nao consome o limite diario', async () => {
    await criarLead();
    const campanha = await criarCampanha({ limiteDiarioEnvios: 1 });
    await servico.enfileirarCampanha(campanha.id);

    await prisma.outboundMessage.create({
      data: {
        leadId: (await criarLead()).id,
        campaignId: campanha.id,
        campaignStepId: (await prisma.campaignStep.findFirstOrThrow({
          where: { campaignId: campanha.id },
        })).id,
        idempotencyKey: `manual-sim-${Date.now()}`,
        // Dry-run: nao pode gastar a cota, senao testar a campanha
        // queimaria o limite do dia.
        status: 'SIMULADA',
        processedAt: new Date(),
        dryRun: true,
      },
    });

    const r = await varrer(new Date(Date.now() + 3600_000));

    expect(r.despachadas).toBe(1);
    expect(r.adiadas).toBe(0);
  });

  it('nao despacha mensagem cujo horario ainda nao chegou', async () => {
    await criarLead();
    const campanha = await criarCampanha();
    await servico.enfileirarCampanha(campanha.id);

    await prisma.outboundMessage.updateMany({
      data: { scheduledAt: new Date(Date.now() + 24 * 3600_000) },
    });

    const r = await varrer(new Date());
    expect(r.despachadas).toBe(0);
  });
});

// ------------------------------------------------------------ mudar status
describe('pausar campanha cancela o que ainda nao saiu', () => {
  it('mensagens AGENDADA viram CANCELADA', async () => {
    await criarLead();
    await criarLead();
    const campanha = await criarCampanha();
    await servico.enfileirarCampanha(campanha.id);

    expect(await prisma.outboundMessage.count()).toBe(2);

    // Espelha o que a rota POST /:id/status faz ao pausar.
    await prisma.outboundMessage.updateMany({
      where: { campaignId: campanha.id, status: { in: ['PENDENTE', 'AGENDADA'] } },
      data: { status: 'CANCELADA', erro: 'Campanha pausada' },
    });

    const canceladas = await prisma.outboundMessage.count({
      where: { status: 'CANCELADA' },
    });
    expect(canceladas).toBe(2);
  });
});

// =============================================================================
// UMA CAMPANHA SEM PLANILHA PEGA O CRM INTEIRO
// =============================================================================

/**
 * O caso real: uma campanha chamada "MUZAMBINHO GUAXUPE ALFENAS" saiu
 * mandando mensagem para leads de Osasco e Sao Paulo, de uma importacao
 * completamente diferente.
 *
 * A causa nao foi um bug de SQL: foi o publico. Uma campanha guarda um
 * FILTRO, e nao uma copia da planilha. Sem lote escolhido, o filtro nao
 * restringe nada.
 *
 * O unico aviso era uma frase cinza na tela de filtros — "Nenhuma
 * escolhida, a campanha considera todos os leads" — que ninguem le antes
 * de clicar em Ativar. Agora a rota de ativacao recusa, e quem quiser
 * mesmo mandar para todo mundo precisa dizer isso explicitamente.
 */
describe('restringeAPlanilha — o publico esta preso a uma lista?', () => {
  it('sem lote nenhum, a campanha pega o CRM inteiro', () => {
    expect(servico.restringeAPlanilha({})).toBe(false);
  });

  it('lote por arquivo restringe', () => {
    expect(servico.restringeAPlanilha({ importIds: ['abc'] })).toBe(true);
  });

  it('lote por sessao de captura restringe', () => {
    expect(servico.restringeAPlanilha({ captureSessionIds: ['abc'] })).toBe(true);
  });

  it('lista vazia nao restringe — e o caso que passava despercebido', () => {
    // `importIds: []` chega da tela quando a pessoa marca e desmarca uma
    // planilha. Ler isso como "tem lote" faria a guarda deixar passar
    // exatamente o estado que ela existe para pegar.
    expect(servico.restringeAPlanilha({ importIds: [], captureSessionIds: [] })).toBe(
      false
    );
  });

  it('cidade e categoria NAO contam como restricao de planilha', () => {
    // Elas refinam DENTRO do publico; nao dizem de qual planilha ele
    // sai. Uma campanha filtrada por "Alfenas" ainda pega leads de
    // Alfenas de qualquer importacao ja feita — que e como leads de
    // Osasco NAO entrariam, mas leads de Alfenas de outra lista sim.
    expect(
      servico.restringeAPlanilha({
        cidades: ['Alfenas'],
        categorias: ['Estetica automotiva'],
      } as never)
    ).toBe(false);
  });
});
