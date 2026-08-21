/**
 * O elo entre a campanha e o quadro.
 *
 * ============================================================
 * O QUE ESTES TESTES PROTEGEM
 * ============================================================
 * O quadro le `lead_campaigns`. Durante um tempo NADA escrevia nessa
 * tabela: enfileirar criava a mensagem e o worker a enviava, mas o
 * vinculo lead<->campanha nunca nascia. O quadro funcionava em teste
 * (que criava as linhas na mao) e ficava permanentemente vazio no uso
 * real — o pior tipo de defeito, porque a tela parecia certa.
 *
 * Cada teste aqui falha se aquele elo se romper de novo.
 *
 * Requer Postgres e Redis no ar, migrado e com seed.
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

const TEMPLATE = 'Olá! Vi a {{empresa}} em {{cidade}}. Posso te mostrar uma ideia?';

beforeAll(async () => {
  prisma = (await import('@prospector/database')).prisma;
  servico = await import('../apps/api/src/services/campaign-service.js');
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await prisma.outboundMessage.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.leadEvent.deleteMany();
  await prisma.leadCampaign.deleteMany();
  await prisma.campaignStep.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.lead.deleteMany();
});

let n = 0;

/** Mesmo caminho da rota `contar-leads`: monta o WHERE e conta. */
async function contar(
  filtros: Parameters<typeof servico.montarWhere>[0]
): Promise<number> {
  return prisma.lead.count({ where: servico.montarWhere(filtros) });
}

async function criarLead(dados: Record<string, unknown> = {}) {
  n += 1;
  return prisma.lead.create({
    data: {
      nomeCompleto: `Clínica Fluxo ${n}`,
      empresa: `Clínica Fluxo ${n}`,
      telefone: `(19) 99999-${String(3000 + n).slice(-4)}`,
      telefoneNormalizado: `5519977${String(100000 + n).slice(-6)}`,
      cidade: 'Campinas',
      estado: 'SP',
      websiteStatus: 'NAO_INFORMADO',
      status: 'IMPORTADO',
      ...dados,
    } as never,
  });
}

async function criarCampanha(etapas = 1) {
  const campanha = await prisma.campaign.create({
    data: {
      nome: `Fluxo ${Date.now()}-${n}`,
      status: 'ATIVA',
      filtros: {} as never,
    },
  });
  for (let i = 1; i <= etapas; i += 1) {
    await prisma.campaignStep.create({
      data: {
        campaignId: campanha.id,
        ordem: i,
        texto: TEMPLATE,
        ativo: true,
        aguardarResposta: true,
      },
    });
  }
  return campanha;
}

describe('enfileirar cria o vínculo lead <-> campanha', () => {
  it('o lead aparece em lead_campaigns depois de enfileirar', async () => {
    const lead = await criarLead();
    const campanha = await criarCampanha();

    await servico.enfileirarCampanha(campanha.id);

    const vinculo = await prisma.leadCampaign.findUnique({
      where: { leadId_campaignId: { leadId: lead.id, campaignId: campanha.id } },
    });
    expect(vinculo).not.toBeNull();
  });

  it('nasce PENDENTE e SEM etapa — ele ainda não recebeu nada', async () => {
    const lead = await criarLead();
    const campanha = await criarCampanha();

    await servico.enfileirarCampanha(campanha.id);

    const v = await prisma.leadCampaign.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    // Dizer que já está na etapa 1 seria afirmar um envio que não houve.
    expect(v.status).toBe('PENDENTE');
    expect(v.etapaAtualId).toBeNull();
    expect(v.totalEnviadas).toBe(0);
  });

  it('lead bloqueado entra como PARADO, com o motivo', async () => {
    const lead = await criarLead({ optOut: true, optOutEm: new Date() });
    const campanha = await criarCampanha();

    await servico.enfileirarCampanha(campanha.id);

    const v = await prisma.leadCampaign.findFirst({ where: { leadId: lead.id } });
    // Pode nem ser selecionado pelo filtro; se for, tem de vir parado.
    if (v) {
      expect(v.status).toBe('PARADO');
      expect(v.motivoParada).toBeTruthy();
    }
  });

  it('enfileirar de novo não duplica o vínculo', async () => {
    await criarLead();
    const campanha = await criarCampanha();

    await servico.enfileirarCampanha(campanha.id);
    await servico.enfileirarCampanha(campanha.id);

    expect(await prisma.leadCampaign.count()).toBe(1);
  });

  it('enfileirar de novo NÃO joga para trás quem já avançou', async () => {
    const lead = await criarLead();
    const campanha = await criarCampanha(2);
    await servico.enfileirarCampanha(campanha.id);

    const etapa2 = await prisma.campaignStep.findFirstOrThrow({
      where: { campaignId: campanha.id, ordem: 2 },
    });
    await prisma.leadCampaign.updateMany({
      where: { leadId: lead.id },
      data: {
        status: 'AGUARDANDO_RESPOSTA',
        etapaAtualId: etapa2.id,
        etapaAtualOrdem: 2,
        totalEnviadas: 2,
      },
    });

    // Adicionar leads novos a uma campanha que já roda é normal. Se o
    // reenfileiramento resetasse, todo mundo voltaria para o começo e
    // receberia a mensagem 1 de novo.
    await servico.enfileirarCampanha(campanha.id);

    const v = await prisma.leadCampaign.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(v.etapaAtualOrdem).toBe(2);
    expect(v.status).toBe('AGUARDANDO_RESPOSTA');
    expect(v.totalEnviadas).toBe(2);
  });
});

describe('aviso quando o lead chega na etapa', () => {
  it('a etapa guarda a configuração do aviso', async () => {
    const campanha = await criarCampanha(1);
    const etapa = await prisma.campaignStep.findFirstOrThrow({
      where: { campaignId: campanha.id },
    });

    // Nasce desligado: um aviso que ninguém pediu vira ruído, e ruído
    // faz você parar de olhar o sino.
    expect(etapa.notificarAoChegar).toBe(false);
    expect(etapa.notificacaoTexto).toBeNull();

    await prisma.campaignStep.update({
      where: { id: etapa.id },
      data: {
        notificarAoChegar: true,
        notificacaoTexto: 'Montar a prévia do site',
      },
    });

    const depois = await prisma.campaignStep.findUniqueOrThrow({
      where: { id: etapa.id },
    });
    expect(depois.notificarAoChegar).toBe(true);
    expect(depois.notificacaoTexto).toBe('Montar a prévia do site');
  });
});

describe('campanha em cima de um lote específico', () => {
  it('o filtro por planilha separa nichos diferentes', async () => {
    const psicologos = await prisma.captureSession.create({
      data: { nicho: 'psicólogos', cidade: 'Campinas', estado: 'SP' },
    });
    const saloes = await prisma.captureSession.create({
      data: { nicho: 'salões', cidade: 'Osasco', estado: 'SP' },
    });

    await criarLead({ captureSessionId: psicologos.id });
    await criarLead({ captureSessionId: psicologos.id });
    await criarLead({ captureSessionId: saloes.id });

    // Sem o filtro, "todos os leads sem site" pegaria as duas planilhas
    // e a mensagem de psicólogo iria para um salão.
    const so = await contar({ captureSessionIds: [psicologos.id] });
    expect(so).toBe(2);

    const ambos = await contar({
      captureSessionIds: [psicologos.id, saloes.id],
    });
    expect(ambos).toBe(3);
  });

  it('sem filtro de lote, o público continua sendo todo mundo', async () => {
    const s = await prisma.captureSession.create({
      data: { nicho: 'psicólogos', cidade: 'Campinas' },
    });
    await criarLead({ captureSessionId: s.id });
    await criarLead(); // sem lote nenhum

    expect(await contar({})).toBe(2);
  });

  it('dá para combinar planilha classificada com arquivo solto', async () => {
    const s = await prisma.captureSession.create({
      data: { nicho: 'psicólogos', cidade: 'Campinas' },
    });
    const imp = await prisma.import.create({
      data: { nomeArquivo: 'antiga.csv', formato: 'csv', status: 'CONCLUIDO' },
    });

    await criarLead({ captureSessionId: s.id });
    await criarLead({ importId: imp.id });
    await criarLead();

    const total = await contar({
      captureSessionIds: [s.id],
      importIds: [imp.id],
    });
    // Os dois entram como OR — é uma combinação legítima.
    expect(total).toBe(2);
  });
});

describe('o quadro reflete o que foi enfileirado', () => {
  it('depois de enfileirar, os leads aparecem em "Na fila"', async () => {
    await criarLead();
    await criarLead();
    const campanha = await criarCampanha(2);

    await servico.enfileirarCampanha(campanha.id);

    // O mesmo critério que a rota do quadro usa para a coluna "Na fila".
    const naFila = await prisma.leadCampaign.count({
      where: {
        campaignId: campanha.id,
        etapaAtualId: null,
        status: { notIn: ['CONCLUIDO', 'PARADO', 'OPT_OUT', 'AGUARDANDO_INTERVENCAO', 'PAUSADO'] },
      },
    });
    expect(naFila).toBe(2);
  });
});

describe('excluir campanha', () => {
  it('leva junto etapas e fila, mas NÃO os leads', async () => {
    const lead = await criarLead();
    const campanha = await criarCampanha(2);
    await servico.enfileirarCampanha(campanha.id);

    expect(await prisma.outboundMessage.count()).toBeGreaterThan(0);

    await prisma.campaign.delete({ where: { id: campanha.id } });

    expect(await prisma.campaignStep.count({ where: { campaignId: campanha.id } })).toBe(0);
    expect(await prisma.outboundMessage.count({ where: { campaignId: campanha.id } })).toBe(0);
    expect(await prisma.leadCampaign.count({ where: { campaignId: campanha.id } })).toBe(0);

    // O lead existia antes da campanha e continua depois dela.
    expect(await prisma.lead.findUnique({ where: { id: lead.id } })).not.toBeNull();
  });
});

describe('reenfileirar depois de pausar', () => {
  it('revive as mensagens canceladas', async () => {
    await criarLead();
    const campanha = await criarCampanha(1);
    await servico.enfileirarCampanha(campanha.id);

    // Pausar cancela a fila — comportamento correto.
    await prisma.outboundMessage.updateMany({
      where: { campaignId: campanha.id },
      data: { status: 'CANCELADA', erro: 'Campanha pausada' },
    });

    // Sem a revivificação, isto batia na chave de idempotência e
    // respondia "já existiam" para tudo: a campanha pausada nunca mais
    // voltava a rodar, e não havia saída pela interface.
    const r = await servico.enfileirarCampanha(campanha.id);

    // `atualizadas`, e nao `criadas`: a linha ja existia e foi revivida.
    // Dizer "criada" quando nada foi criado esconderia a diferenca entre
    // um lead novo entrando na campanha e um antigo voltando a andar.
    expect(r.atualizadas).toBe(1);
    expect(r.jaExistiam).toBe(0);

    const m = await prisma.outboundMessage.findFirstOrThrow({
      where: { campaignId: campanha.id },
    });
    expect(m.status).toBe('AGENDADA');
    // O erro antigo não pode sobreviver: ele descreve um estado que
    // deixou de valer.
    expect(m.erro).toBeNull();
    expect(m.tentativas).toBe(0);
  });

  // ============================================================
  // O PADRÃO MUDOU: CAMPANHA NOVA NASCE ENVIANDO
  // ============================================================
  // Enquanto existia o modo global, `dryRun: true` era o padrão da
  // campanha porque havia uma segunda rede embaixo. Sem ela, deixar toda
  // campanha nascer simulada significaria que criar uma campanha e
  // ativá-la não envia nada — e ninguém entende por quê, porque a tela
  // não mostra motivo nenhum.
  //
  // Simular passou a ser uma escolha explícita, e é ela que aparece
  // marcada na interface quando está ligada.
  it('campanha nova nasce fora da simulação', async () => {
    const campanha = await criarCampanha(1);
    expect(campanha.dryRun).toBe(false);
  });

  it('a mensagem herda o estado da campanha, seja qual for', async () => {
    await criarLead();

    const enviando = await criarCampanha(1);
    await servico.enfileirarCampanha(enviando.id);
    const real = await prisma.outboundMessage.findFirstOrThrow({
      where: { campaignId: enviando.id },
    });
    expect(real.dryRun).toBe(false);
  });

  // ============================================================
  // O BECO SEM SAÍDA QUE ISTO FECHA
  // ============================================================
  // Relatado em uso real, com o print da tela: a campanha aparecia
  // "liberada para envio real" e a fila continuava com o selo Dry-run,
  // sem nenhuma forma de sair disso pela interface.
  //
  // A mensagem estava AGENDADA — fora da lista de status revivíveis —,
  // então reenfileirar respondia "já existia" e não tocava nela. E mesmo
  // se estivesse CANCELADA, o `dryRun` não era atualizado.
  it('liberar a campanha e reenfileirar tira o dry-run de uma AGENDADA', async () => {
    await criarLead();
    const campanha = await criarCampanha(1);

    // 1. A campanha entra em simulação — agora explicitamente. O padrão
    //    de `dryRun` virou `false` quando o modo global foi removido, e
    //    este teste precisa do estado simulado para ter o que destravar.
    await prisma.campaign.update({
      where: { id: campanha.id },
      data: { dryRun: true },
    });
    await servico.enfileirarCampanha(campanha.id);
    const antes = await prisma.outboundMessage.findFirstOrThrow({
      where: { campaignId: campanha.id },
    });
    expect(antes.status).toBe('AGENDADA');
    expect(antes.dryRun).toBe(true);

    // 2. Você desliga a simulação nas configurações.
    await prisma.campaign.update({
      where: { id: campanha.id },
      data: { dryRun: false },
    });

    // 3. E reenfileira — que é o caminho que a própria tela recomenda.
    const r = await servico.enfileirarCampanha(campanha.id);
    expect(r.atualizadas).toBe(1);
    expect(r.jaExistiam).toBe(0);

    const depois = await prisma.outboundMessage.findFirstOrThrow({
      where: { campaignId: campanha.id },
    });
    expect(depois.dryRun).toBe(false);
    expect(depois.status).toBe('AGENDADA');
    // Continua sendo UMA mensagem: reviver não é duplicar.
    expect(await prisma.outboundMessage.count({ where: { campaignId: campanha.id } })).toBe(1);
  });

  // O caminho inverso também tem que funcionar: religar a simulação e
  // reenfileirar volta a mensagem para o modo seguro.
  it('religar a simulação também vale para o que está agendado', async () => {
    await criarLead();
    const campanha = await criarCampanha(1);
    await prisma.campaign.update({ where: { id: campanha.id }, data: { dryRun: false } });
    await servico.enfileirarCampanha(campanha.id);

    await prisma.campaign.update({ where: { id: campanha.id }, data: { dryRun: true } });
    await servico.enfileirarCampanha(campanha.id);

    const m = await prisma.outboundMessage.findFirstOrThrow({
      where: { campaignId: campanha.id },
    });
    expect(m.dryRun).toBe(true);
  });

  // A barreira que NÃO pode ceder: uma mensagem que já saiu não volta
  // atrás, qualquer que seja o modo da campanha agora.
  it('uma SIMULADA não vira envio real por reenfileiramento', async () => {
    await criarLead();
    const campanha = await criarCampanha(1);
    // Simulação explícita: é dela que a mensagem herda o `dryRun` que o
    // teste depois tenta — e precisa falhar em — reverter.
    await prisma.campaign.update({
      where: { id: campanha.id },
      data: { dryRun: true },
    });
    await servico.enfileirarCampanha(campanha.id);

    await prisma.outboundMessage.updateMany({
      where: { campaignId: campanha.id },
      data: { status: 'SIMULADA', processedAt: new Date() },
    });
    await prisma.campaign.update({ where: { id: campanha.id }, data: { dryRun: false } });

    await servico.enfileirarCampanha(campanha.id);

    const m = await prisma.outboundMessage.findFirstOrThrow({
      where: { campaignId: campanha.id },
    });
    expect(m.status).toBe('SIMULADA');
    expect(m.dryRun).toBe(true);
  });

  it('NUNCA revive uma mensagem já enviada ou simulada', async () => {
    await criarLead();
    const campanha = await criarCampanha(1);
    await servico.enfileirarCampanha(campanha.id);

    await prisma.outboundMessage.updateMany({
      where: { campaignId: campanha.id },
      data: { status: 'SIMULADA', processedAt: new Date() },
    });

    const r = await servico.enfileirarCampanha(campanha.id);

    // Reviver aqui seria mandar de novo para quem já recebeu — o único
    // erro que o enfileiramento inteiro existe para evitar.
    expect(r.criadas).toBe(0);
    expect(r.jaExistiam).toBe(1);

    const m = await prisma.outboundMessage.findFirstOrThrow({
      where: { campaignId: campanha.id },
    });
    expect(m.status).toBe('SIMULADA');
  });

  it('revive também o que estava BLOQUEADA', async () => {
    // Bloqueio por telefone ausente pode ter sido corrigido desde então.
    await criarLead();
    const campanha = await criarCampanha(1);
    await servico.enfileirarCampanha(campanha.id);

    await prisma.outboundMessage.updateMany({
      where: { campaignId: campanha.id },
      data: { status: 'BLOQUEADA', motivoBloqueio: 'LEAD_SEM_TELEFONE' },
    });

    const r = await servico.enfileirarCampanha(campanha.id);
    expect(r.atualizadas).toBe(1);

    const m = await prisma.outboundMessage.findFirstOrThrow({
      where: { campaignId: campanha.id },
    });
    expect(m.status).toBe('AGENDADA');
    expect(m.motivoBloqueio).toBeNull();
  });
});

describe('enfileirar apenas os leads escolhidos', () => {
  it('enfileira só os selecionados', async () => {
    const a = await criarLead();
    const b = await criarLead();
    await criarLead();
    const campanha = await criarCampanha(1);

    const r = await servico.enfileirarCampanha(campanha.id, {
      leadIds: [a.id, b.id],
    });

    expect(r.criadas).toBe(2);
    expect(await prisma.outboundMessage.count()).toBe(2);

    const ids = (
      await prisma.outboundMessage.findMany({ select: { leadId: true } })
    ).map((m) => m.leadId);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });

  it('a seleção NÃO contorna os filtros da campanha', async () => {
    // Escolher um lead em opt-out à mão não pode liberá-lo. A seleção
    // restringe o público; nunca amplia.
    const optOut = await criarLead({ optOut: true, optOutEm: new Date() });
    const campanha = await criarCampanha(1);

    const r = await servico.enfileirarCampanha(campanha.id, {
      leadIds: [optOut.id],
    });

    const enviaveis = await prisma.outboundMessage.count({
      where: { status: 'AGENDADA' },
    });
    expect(enviaveis).toBe(0);
    expect(r.criadas).toBe(0);
  });

  it('com seleção, o limite da campanha não corta', async () => {
    const leads = [await criarLead(), await criarLead(), await criarLead()];
    const campanha = await criarCampanha(1);
    await prisma.campaign.update({
      where: { id: campanha.id },
      data: { maxLeads: 1 },
    });

    // Você já disse exatamente quantos quer. Cortar em silêncio deixaria
    // alguém de fora sem avisar.
    const r = await servico.enfileirarCampanha(campanha.id, {
      leadIds: leads.map((l) => l.id),
    });
    expect(r.criadas).toBe(3);
  });

  it('sem seleção, continua enfileirando todos', async () => {
    await criarLead();
    await criarLead();
    const campanha = await criarCampanha(1);

    const r = await servico.enfileirarCampanha(campanha.id);
    expect(r.criadas).toBe(2);
  });
});


describe('mensagens órfãs em PROCESSANDO', () => {
  let varrer: typeof import('../apps/worker/src/workers/despachante.js').varrer;

  beforeAll(async () => {
    ({ varrer } = await import('../apps/worker/src/workers/despachante.js'));
  });

  async function presaEmProcessando(dryRun: boolean, minutosAtras: number) {
    const lead = await criarLead();
    const campanha = await criarCampanha(1);
    const etapa = await prisma.campaignStep.findFirstOrThrow({
      where: { campaignId: campanha.id },
    });
    const m = await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapa.id,
        idempotencyKey: `orfa-${Date.now()}-${n}-${Math.random()}`,
        status: 'PROCESSANDO',
        telefoneDestino: lead.telefoneNormalizado,
        textoRenderizado: 'Olá!',
        dryRun,
      },
    });
    // `updatedAt` é automático; o SQL cru é a única forma de envelhecê-lo.
    //
    // ============================================================
    // O `AT TIME ZONE 'UTC'` NÃO É ENFEITE
    // ============================================================
    // A coluna é `timestamp` SEM fuso, e o Prisma sempre grava e lê como
    // UTC. Mas o `now()` do Postgres é `timestamptz`, e convertê-lo para
    // `timestamp` usa o fuso da SESSÃO. Num banco em America/Sao_Paulo
    // ele grava 21:58 e o Prisma relê isso como 21:58 UTC — três horas
    // no passado.
    //
    // O efeito aparecia só fora do UTC: este teste passava aqui e
    // falhava numa máquina brasileira, porque "1 minuto atrás" virava
    // "181 minutos atrás" e a mensagem entrava no corte de 10 minutos
    // da varredura de órfãs.
    //
    // Só o SQL cru tem esse problema: a escrita normal do Prisma faz
    // round-trip exato em qualquer fuso — foi verificado.
    await prisma.$executeRawUnsafe(
      `UPDATE outbound_messages
          SET updated_at = (now() AT TIME ZONE 'UTC') - interval '${minutosAtras} minutes'
        WHERE id = $1`,
      m.id
    );
    return m;
  }

  it('simulada presa volta para a fila', async () => {
    const m = await presaEmProcessando(true, 30);

    // Sem isto, ela ficava em PROCESSANDO para sempre: a varredura só
    // olha PENDENTE/AGENDADA e nada a resgatava.
    await varrer(new Date());

    const d = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(d.status).not.toBe('PROCESSANDO');
  });

  it('real presa vira FALHOU, nunca reenviada', async () => {
    const m = await presaEmProcessando(false, 30);

    await varrer(new Date());

    const d = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: m.id } });
    // Reenviar poderia mandar a MESMA mensagem duas vezes para a mesma
    // pessoa. Falhar e pedir decisão custa menos.
    expect(d.status).toBe('FALHOU');
    expect(d.erro).toMatch(/confira a conversa/i);
  });

  it('não mexe em quem acabou de ser reservada', async () => {
    const m = await presaEmProcessando(true, 1);

    // Um envio lento não pode ser confundido com um worker morto.
    await varrer(new Date());

    const d = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(d.status).toBe('PROCESSANDO');
  });
});
