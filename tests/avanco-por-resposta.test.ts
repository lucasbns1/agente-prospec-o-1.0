/**
 * A sequência anda quando o lead responde.
 *
 * ============================================================
 * O DEFEITO QUE ESTES TESTES TRANCAM
 * ============================================================
 * Durante as fases de dry-run, dois pedaços do fluxo estavam
 * deliberadamente desligados — e continuaram desligados depois que o
 * envio real foi liberado:
 *
 *   1. `temProximaEtapa` era passado FIXO em `false` para o motor. O
 *      efeito não era "não envia": era `decidirAcao` transformar TODO
 *      avanço em fim de sequência. O lead respondia "quero sim" e a
 *      regra AVANCAR o ENCERRAVA na etapa 1.
 *
 *   2. os efeitos `AVANCAR_ETAPA` e `ENVIAR_TEMPLATE` só escreviam
 *      "ação reconhecida mas não executada" no histórico. Nada era
 *      enfileirado.
 *
 * Juntos, faziam a mensagem 2 nunca sair. O CRM registrava tudo certo,
 * o quadro mudava de coluna, e a conversa morria. Só andava se você
 * reenfileirasse a campanha na mão.
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
let avanco: typeof import('../apps/worker/src/services/avancar-etapa.js');

const MSG1 = 'Olá! Vi a {{empresa}} em {{cidade}}. Posso te mostrar uma ideia?';
const MSG2 = 'Que bom! Consigo te mandar uma prévia do site da {{empresa}}.';
const MSG3 = 'Aqui está a prévia da {{empresa}}.';

beforeAll(async () => {
  prisma = (await import('@prospector/database')).prisma;
  avanco = await import('../apps/worker/src/services/avancar-etapa.js');
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await prisma.outboundMessage.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.leadEvent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.task.deleteMany();
  await prisma.leadCampaign.deleteMany();
  await prisma.campaignStep.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.lead.deleteMany();
});

let n = 0;

async function criarLead(dados: Record<string, unknown> = {}) {
  n += 1;
  return prisma.lead.create({
    data: {
      nomeCompleto: `Studio Avanço ${n}`,
      empresa: `Studio Avanço ${n}`,
      telefone: `(19) 98888-${String(4000 + n).slice(-4)}`,
      telefoneNormalizado: `5519988${String(200000 + n).slice(-6)}`,
      cidade: 'Campinas',
      estado: 'SP',
      websiteStatus: 'NAO_INFORMADO',
      status: 'AGUARDANDO_RESPOSTA',
      ...dados,
    } as never,
  });
}

/**
 * Campanha de três etapas, como a do uso real: abordagem, resposta ao
 * interesse, e a prévia (que fica manual).
 */
async function criarCampanha(opcoes: {
  dryRun?: boolean;
  status?: string;
  etapa3Manual?: boolean;
  notificarNaEtapa2?: boolean;
} = {}) {
  const campanha = await prisma.campaign.create({
    data: {
      nome: `Avanço ${Date.now()}-${n}`,
      status: (opcoes.status ?? 'ATIVA') as never,
      dryRun: opcoes.dryRun ?? true,
      // Sem espera: o teste não pode depender de relógio.
      delayMinSegundos: 0,
      delayMaxSegundos: 0,
      filtros: {} as never,
    },
  });

  const textos = [MSG1, MSG2, MSG3];
  const etapas = [];
  for (let i = 1; i <= 3; i += 1) {
    etapas.push(
      await prisma.campaignStep.create({
        data: {
          campaignId: campanha.id,
          ordem: i,
          texto: textos[i - 1]!,
          ativo: true,
          aguardarResposta: true,
          enviarAutomaticamente: i === 3 ? !(opcoes.etapa3Manual ?? false) : true,
          notificarAoChegar: i === 2 ? (opcoes.notificarNaEtapa2 ?? false) : false,
        },
      })
    );
  }
  return { campanha, etapas };
}

async function vincular(leadId: string, campaignId: string, etapaAtualId: string | null) {
  return prisma.leadCampaign.create({
    data: {
      leadId,
      campaignId,
      status: 'AGUARDANDO_RESPOSTA',
      etapaAtualId,
      ...(etapaAtualId ? { etapaAtualOrdem: 1 } : {}),
    },
  });
}

// ---------------------------------------------------------------------------

describe('temProximaEtapa — a resposta que decide entre avançar e encerrar', () => {
  it('é true quando existe etapa depois da atual', async () => {
    const { campanha, etapas } = await criarCampanha();
    await expect(
      avanco.temProximaEtapa(campanha.id, etapas[0]!.id)
    ).resolves.toBe(true);
  });

  it('é false na última etapa', async () => {
    const { campanha, etapas } = await criarCampanha();
    await expect(
      avanco.temProximaEtapa(campanha.id, etapas[2]!.id)
    ).resolves.toBe(false);
  });

  it('ignora etapas desativadas', async () => {
    const { campanha, etapas } = await criarCampanha();
    await prisma.campaignStep.updateMany({
      where: { campaignId: campanha.id, ordem: { gt: 1 } },
      data: { ativo: false },
    });
    await expect(
      avanco.temProximaEtapa(campanha.id, etapas[0]!.id)
    ).resolves.toBe(false);
  });

  it('sem campanha, é false — não há sequência para andar', async () => {
    await expect(avanco.temProximaEtapa(null, null)).resolves.toBe(false);
  });
});

describe('enfileirarProximaEtapa', () => {
  it('cria a mensagem da etapa 2 quando o lead está na 1', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha();
    await vincular(lead.id, campanha.id, etapas[0]!.id);

    const r = await avanco.enfileirarProximaEtapa({
      leadId: lead.id,
      campaignId: campanha.id,
      etapaAtualId: etapas[0]!.id,
    });

    expect(r.enfileirou).toBe(true);
    expect(r.proximaEtapaId).toBe(etapas[1]!.id);

    const criada = await prisma.outboundMessage.findFirstOrThrow({
      where: { leadId: lead.id, campaignStepId: etapas[1]!.id },
    });
    expect(criada.status).toBe('AGENDADA');
    // O texto sai renderizado: nada de {{empresa}} chegando ao WhatsApp.
    expect(criada.textoRenderizado).toContain(lead.empresa);
    expect(criada.textoRenderizado).not.toContain('{{');
  });

  it('herda o dryRun da campanha — responder não promove simulação a envio real', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha({ dryRun: true });
    await vincular(lead.id, campanha.id, etapas[0]!.id);

    await avanco.enfileirarProximaEtapa({
      leadId: lead.id,
      campaignId: campanha.id,
      etapaAtualId: etapas[0]!.id,
    });

    const criada = await prisma.outboundMessage.findFirstOrThrow({
      where: { leadId: lead.id, campaignStepId: etapas[1]!.id },
    });
    expect(criada.dryRun).toBe(true);
  });

  it('é idempotente: duas respostas seguidas não geram duas mensagens', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha();
    await vincular(lead.id, campanha.id, etapas[0]!.id);

    const params = {
      leadId: lead.id,
      campaignId: campanha.id,
      etapaAtualId: etapas[0]!.id,
    };
    const primeira = await avanco.enfileirarProximaEtapa(params);
    const segunda = await avanco.enfileirarProximaEtapa(params);

    expect(primeira.enfileirou).toBe(true);
    expect(segunda.enfileirou).toBe(false);
    expect(segunda.motivo).toBe('JA_ENFILEIRADA');

    const total = await prisma.outboundMessage.count({
      where: { leadId: lead.id, campaignStepId: etapas[1]!.id },
    });
    expect(total).toBe(1);
  });

  it('na última etapa, conclui o lead em vez de enfileirar', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha();
    await vincular(lead.id, campanha.id, etapas[2]!.id);

    const r = await avanco.enfileirarProximaEtapa({
      leadId: lead.id,
      campaignId: campanha.id,
      etapaAtualId: etapas[2]!.id,
    });

    expect(r.enfileirou).toBe(false);
    expect(r.motivo).toBe('SEM_PROXIMA_ETAPA');

    const v = await prisma.leadCampaign.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(v.status).toBe('CONCLUIDO');
    expect(await prisma.outboundMessage.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it('etapa marcada como manual não enfileira: vai para "Precisa de você" e notifica', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha({ etapa3Manual: true });
    await vincular(lead.id, campanha.id, etapas[1]!.id);

    const r = await avanco.enfileirarProximaEtapa({
      leadId: lead.id,
      campaignId: campanha.id,
      etapaAtualId: etapas[1]!.id,
    });

    expect(r.enfileirou).toBe(false);
    expect(r.motivo).toBe('ETAPA_MANUAL');

    // Uma linha AGENDADA que ninguém pode despachar ficaria na fila
    // fingindo que vai sair.
    expect(await prisma.outboundMessage.count({ where: { leadId: lead.id } })).toBe(0);

    const v = await prisma.leadCampaign.findFirstOrThrow({ where: { leadId: lead.id } });
    // PAUSADO é o status que o quadro lê como "Precisa de você".
    expect(v.status).toBe('PAUSADO');
    expect(v.aguardandoLiberacao).toBe(true);

    const aviso = await prisma.notification.findFirst({ where: { leadId: lead.id } });
    expect(aviso?.tipo).toBe('PEDIDO_PREVIEW');
  });

  it('notifica ao chegar na etapa, quando a etapa pede', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha({ notificarNaEtapa2: true });
    await vincular(lead.id, campanha.id, etapas[0]!.id);

    await avanco.enfileirarProximaEtapa({
      leadId: lead.id,
      campaignId: campanha.id,
      etapaAtualId: etapas[0]!.id,
    });

    const aviso = await prisma.notification.findFirst({ where: { leadId: lead.id } });
    expect(aviso).not.toBeNull();
    expect(aviso?.tipo).toBe('PEDIDO_PREVIEW');
  });

  it('campanha pausada não volta a andar por causa de uma resposta', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha({ status: 'PAUSADA' });
    await vincular(lead.id, campanha.id, etapas[0]!.id);

    const r = await avanco.enfileirarProximaEtapa({
      leadId: lead.id,
      campaignId: campanha.id,
      etapaAtualId: etapas[0]!.id,
    });

    expect(r.enfileirou).toBe(false);
    expect(r.motivo).toBe('CAMPANHA_INATIVA');
    expect(await prisma.outboundMessage.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it('lead em opt-out nunca avança, aconteça o que acontecer', async () => {
    const lead = await criarLead({ optOut: true, optOutEm: new Date(), status: 'OPT_OUT' });
    const { campanha, etapas } = await criarCampanha();
    await vincular(lead.id, campanha.id, etapas[0]!.id);

    const r = await avanco.enfileirarProximaEtapa({
      leadId: lead.id,
      campaignId: campanha.id,
      etapaAtualId: etapas[0]!.id,
    });

    expect(r.enfileirou).toBe(false);
    expect(r.motivo).toBe('LEAD_OPT_OUT');
    expect(await prisma.outboundMessage.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it('mensagem que não renderiza entra BLOQUEADA, com o motivo visível', async () => {
    // `empresa` é variável OBRIGATÓRIA: uma mensagem que diz "vi a
    // {{empresa}} no Google" sem a empresa não faz sentido nenhum.
    // Sem ela, a etapa 2 não pode virar texto.
    const lead = await criarLead({ empresa: null, nomeCompleto: null });
    const { campanha, etapas } = await criarCampanha();
    await vincular(lead.id, campanha.id, etapas[0]!.id);

    const r = await avanco.enfileirarProximaEtapa({
      leadId: lead.id,
      campaignId: campanha.id,
      etapaAtualId: etapas[0]!.id,
    });

    expect(r.enfileirou).toBe(false);
    const criada = await prisma.outboundMessage.findFirstOrThrow({
      where: { leadId: lead.id, campaignStepId: etapas[1]!.id },
    });
    expect(criada.status).toBe('BLOQUEADA');
    expect(criada.detalheBloqueio).toBeTruthy();
    // Nada foi renderizado — não há texto meio pronto para alguém
    // disparar por engano.
    expect(criada.textoRenderizado).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PONTA A PONTA: a mensagem chega, é classificada, e a etapa 2 entra na fila
//
// Este é o teste que reproduz o que você faz na mão: o lead responde
// "quero sim" e a mensagem 2 tem de aparecer agendada. Antes da
// correção, este caminho terminava com o lead ENCERRADO na etapa 1.
// ---------------------------------------------------------------------------
describe('resposta do lead → próxima etapa na fila (ponta a ponta)', () => {
  async function montarCenario(acao: 'AVANCAR' | 'PARAR' = 'AVANCAR') {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha();
    await vincular(lead.id, campanha.id, etapas[0]!.id);

    await prisma.campaignStepRule.create({
      data: {
        campaignStepId: etapas[0]!.id,
        categoria: 'POSITIVO',
        acao,
        novaTemperatura: 'QUENTE',
      },
    });

    return { lead, campanha, etapas };
  }

  function entrada(telefone: string, texto: string) {
    n += 1;
    return {
      providerMessageId: `pm-avanco-${n}-${Date.now()}`,
      chatId: `${telefone}@c.us`,
      telefone,
      texto,
      nomeContato: 'Contato',
      recebidaEm: new Date(),
      deMim: false,
      tipo: 'chat' as const,
      temMidia: false,
    };
  }

  it('resposta positiva agenda a mensagem da etapa 2', async () => {
    const { lead, etapas } = await montarCenario('AVANCAR');
    const { processarMensagemRecebida } = await import(
      '../apps/worker/src/services/inbound.js'
    );

    const r = await processarMensagemRecebida(
      entrada(lead.telefoneNormalizado!, 'quero sim, tenho interesse')
    );

    expect(r.processada).toBe(true);
    expect(r.categoria).toBe('POSITIVO');
    // A ação tem de ser AVANCAR. Com `temProximaEtapa` fixo em false
    // ela virava PARAR, e a sequência morria aqui.
    expect(r.acao).toBe('AVANCAR');

    const proxima = await prisma.outboundMessage.findFirst({
      where: { leadId: lead.id, campaignStepId: etapas[1]!.id },
    });
    expect(proxima).not.toBeNull();
    expect(proxima?.status).toBe('AGENDADA');
    expect(proxima?.textoRenderizado).not.toContain('{{');
  });

  it('resposta positiva na última etapa conclui, sem inventar mensagem', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha();
    await vincular(lead.id, campanha.id, etapas[2]!.id);
    await prisma.leadCampaign.updateMany({
      where: { leadId: lead.id },
      data: { etapaAtualId: etapas[2]!.id, etapaAtualOrdem: 3 },
    });
    await prisma.campaignStepRule.create({
      data: { campaignStepId: etapas[2]!.id, categoria: 'POSITIVO', acao: 'AVANCAR' },
    });

    const { processarMensagemRecebida } = await import(
      '../apps/worker/src/services/inbound.js'
    );
    await processarMensagemRecebida(
      entrada(lead.telefoneNormalizado!, 'quero sim, tenho interesse')
    );

    expect(await prisma.outboundMessage.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it('opt-out cancela a fila e nunca avança', async () => {
    const { lead, campanha, etapas } = await montarCenario('AVANCAR');
    // Uma mensagem já agendada, para provar que ela é cancelada.
    await avanco.enfileirarProximaEtapa({
      leadId: lead.id,
      campaignId: campanha.id,
      etapaAtualId: etapas[0]!.id,
    });

    const { processarMensagemRecebida } = await import(
      '../apps/worker/src/services/inbound.js'
    );
    await processarMensagemRecebida(
      entrada(lead.telefoneNormalizado!, 'pare de me mandar mensagem, sair da lista')
    );

    const depois = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(depois.optOut).toBe(true);

    const pendentes = await prisma.outboundMessage.count({
      where: { leadId: lead.id, status: { in: ['PENDENTE', 'AGENDADA'] } },
    });
    expect(pendentes).toBe(0);
  });

  it('resposta que o motor não reconhece não avança — cai em "Precisa de você"', async () => {
    const { lead, etapas } = await montarCenario('AVANCAR');

    const { processarMensagemRecebida } = await import(
      '../apps/worker/src/services/inbound.js'
    );
    const r = await processarMensagemRecebida(
      entrada(lead.telefoneNormalizado!, 'xpto blergh zzz')
    );

    expect(r.acao).toBe('INTERVENCAO');
    expect(
      await prisma.outboundMessage.count({
        where: { leadId: lead.id, campaignStepId: etapas[1]!.id },
      })
    ).toBe(0);

    const aviso = await prisma.notification.findFirst({ where: { leadId: lead.id } });
    expect(aviso?.tipo).toBe('INTERVENCAO_NECESSARIA');
  });
});

describe('a chave de idempotência é a mesma da API', () => {
  it('avançar para a etapa 2 colide com um reenfileiramento da mesma etapa', async () => {
    const lead = await criarLead();
    const { campanha, etapas } = await criarCampanha();
    await vincular(lead.id, campanha.id, etapas[0]!.id);

    await avanco.enfileirarProximaEtapa({
      leadId: lead.id,
      campaignId: campanha.id,
      etapaAtualId: etapas[0]!.id,
    });

    const servico = await import('../apps/api/src/services/campaign-service.js');
    const criada = await prisma.outboundMessage.findFirstOrThrow({
      where: { leadId: lead.id, campaignStepId: etapas[1]!.id },
    });

    // Se as duas chaves divergirem, o lead recebe a MESMA mensagem duas
    // vezes — e a constraint UNIQUE não protege mais nada.
    expect(criada.idempotencyKey).toBe(
      servico.chaveIdempotencia(lead.id, campanha.id, etapas[1]!.id)
    );
  });
});
