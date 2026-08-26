/**
 * A mensagem que VOCÊ manda do celular.
 *
 * ============================================================
 * O QUE ESTAVA ACONTECENDO
 * ============================================================
 * O sistema descartava tudo que saía do número conectado:
 *
 *   if (m.fromMe) return;
 *
 * E o `whatsapp-web.js` nem avisava — `message` só dispara para o que
 * chega; o outro sentido é `message_create`.
 *
 * O efeito era o pior tipo de cegueira: a conversa na tela mostrava só o
 * lado do lead, a IA decidia sem saber o que você já tinha dito, e a
 * cadência podia disparar a etapa 3 por cima de uma negociação em
 * andamento.
 *
 * ============================================================
 * O RISCO DO CONSERTO
 * ============================================================
 * Deixar passar sem distinguir seria pior: a sua própria fala entraria
 * no motor de classificação e viraria "resposta positiva do lead". O
 * funil encheria de interessados que são você mesmo.
 *
 * É isso que a maior parte deste arquivo defende.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// O `.env` antes de qualquer import do Prisma: o cliente lê a
// DATABASE_URL no momento em que o módulo é carregado, e não na primeira
// consulta.
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });
process.env.LOG_LEVEL = 'silent';

let prisma: typeof import('@prospector/database').prisma;
let inbound: typeof import('../apps/worker/src/services/inbound.js');

beforeAll(async () => {
  prisma = (await import('@prospector/database')).prisma;
  inbound = await import('../apps/worker/src/services/inbound.js');
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.leadEvent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.task.deleteMany();
  await prisma.outboundMessage.deleteMany();
  await prisma.leadCampaign.deleteMany();
  await prisma.campaignStep.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.lead.deleteMany();
});

let n = 0;
async function cenario() {
  n += 1;
  const lead = await prisma.lead.create({
    data: {
      nomeCompleto: `Manual ${n}`,
      empresa: `Manual ${n}`,
      telefone: `(11) 9${String(50000000 + n).slice(-8)}`,
      telefoneNormalizado: `55119${String(50000000 + n).slice(-8)}`,
      websiteStatus: 'NAO_INFORMADO',
      status: 'AGUARDANDO_RESPOSTA',
    } as never,
  });
  const campanha = await prisma.campaign.create({
    data: { nome: `Manual ${Date.now()}-${n}`, status: 'ATIVA', filtros: {} as never },
  });
  await prisma.leadCampaign.create({
    data: {
      leadId: lead.id,
      campaignId: campanha.id,
      status: 'AGUARDANDO_RESPOSTA',
    },
  });
  return { lead, campanha };
}

const entrada = (lead: { telefoneNormalizado: string | null }, texto: string, deMim: boolean) => ({
  providerMessageId: `wa-${Date.now()}-${Math.random()}`,
  chatId: `${lead.telefoneNormalizado}@c.us`,
  telefone: lead.telefoneNormalizado!,
  texto,
  nomeContato: null,
  recebidaEm: new Date(),
  deMim,
  tipo: 'chat',
  temMidia: false,
});

describe('a sua mensagem entra na conversa', () => {
  it('é gravada como ENVIADA, e não como resposta do lead', async () => {
    const { lead } = await cenario();

    const r = await inbound.processarMensagemRecebida(
      entrada(lead, 'Oi! Posso te mandar o orçamento amanhã?', true)
    );
    expect(r.processada).toBe(true);

    const msgs = await prisma.message.findMany({ where: { leadId: lead.id } });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.direcao).toBe('ENVIADA');
    expect(msgs[0]!.texto).toContain('orçamento');
  });

  it('NÃO é classificada — a sua fala não vira intenção do lead', async () => {
    // "Posso te mandar?" tem cara de POSITIVO para um dicionário. Se
    // fosse classificada, o funil ganharia um interessado que é você.
    const { lead } = await cenario();

    await inbound.processarMensagemRecebida(
      entrada(lead, 'claro, pode sim, quero te mostrar', true)
    );

    const m = await prisma.message.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(m.categoria).toBeNull();
    expect(m.confianca).toBeNull();
  });

  it('não conta como não lida', async () => {
    // A mensagem é sua. Marcá-la como pendente faria o sino pedir
    // atenção para algo que você acabou de escrever.
    const { lead } = await cenario();

    await inbound.processarMensagemRecebida(entrada(lead, 'já te respondo', true));

    const c = await prisma.conversation.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(c.naoLidas).toBe(0);
  });
});

describe('assumir a conversa pausa o robô', () => {
  it('a automação daquele lead para', async () => {
    // Continuar a sequência por cima seria mandar a mensagem 3 enquanto
    // você negocia preço.
    const { lead, campanha } = await cenario();

    await inbound.processarMensagemRecebida(
      entrada(lead, 'deixa eu ver aqui e te falo', true)
    );

    const v = await prisma.leadCampaign.findFirstOrThrow({
      where: { leadId: lead.id, campaignId: campanha.id },
    });
    expect(v.status).toBe('PAUSADO');
    expect(v.aguardandoLiberacao).toBe(true);
    expect(v.motivoParada).toContain('assumiu');
  });

  it('não ressuscita um lead que já saiu', async () => {
    // Mandar "obrigado, boa sorte" para quem pediu opt-out não pode
    // devolvê-lo para a fila como "pausado".
    const { lead, campanha } = await cenario();
    await prisma.leadCampaign.updateMany({
      where: { leadId: lead.id },
      data: { status: 'OPT_OUT' },
    });

    await inbound.processarMensagemRecebida(entrada(lead, 'ok, obrigado', true));

    const v = await prisma.leadCampaign.findFirstOrThrow({
      where: { leadId: lead.id, campaignId: campanha.id },
    });
    expect(v.status).toBe('OPT_OUT');
  });
});

describe('o lead muda de lugar no quadro', () => {
  it('assumir a conversa deixa o lead EM_CONVERSA e QUENTE', async () => {
    // Sem isto, você respondia pelo celular e o lead continuava
    // aparecendo como "aguardando resposta", frio, na mesma coluna de
    // quem nunca falou com você. O quadro mentia justamente sobre os
    // leads mais avançados.
    const { lead } = await cenario();

    await inbound.processarMensagemRecebida(
      entrada(lead, 'boa noite! consigo te mostrar amanhã', true)
    );

    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(l.status).toBe('EM_CONVERSA');
    expect(l.temperatura).toBe('QUENTE');
    expect(l.proximaAcao).toContain('conduzindo');
    expect(l.ultimaInteracaoEm).not.toBeNull();
  });

  it('NÃO ressuscita um lead em opt-out', async () => {
    // "Desculpa, já te tirei da lista" não pode devolver ao funil quem
    // pediu para sair. OPT_OUT é terminal — é a mesma barreira que
    // impede o resto do sistema de voltar a falar com ele.
    const { lead } = await cenario();
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'OPT_OUT', temperatura: 'FRIO' },
    });

    await inbound.processarMensagemRecebida(
      entrada(lead, 'desculpa, já tirei da lista', true)
    );

    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(l.status).toBe('OPT_OUT');
    expect(l.temperatura).toBe('FRIO');
  });

  it('NÃO rebaixa quem já está adiante', async () => {
    // Um "bom dia" para um cliente fechado não pode empurrá-lo de volta
    // para o meio do funil, ou o número de fechamentos derrete sozinho
    // toda vez que você conversa com quem já comprou.
    const { lead } = await cenario();
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'CLIENTE' },
    });

    await inbound.processarMensagemRecebida(entrada(lead, 'bom dia!', true));

    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(l.status).toBe('CLIENTE');
    // Mas a conversa se mexeu, e isso conta.
    expect(l.ultimaInteracaoEm).not.toBeNull();
  });
});

// ============================================================
// O ECO DO PRÓPRIO SISTEMA
// ============================================================
// `message_create` dispara para TUDO que sai do número conectado — o
// que você digita no celular E o que o worker acabou de enviar. Os dois
// chegam com `deMim: true`.
//
// A primeira versão separava os dois pela UNIQUE do
// `whatsapp_message_id`, apostando que o worker já teria gravado a linha
// em `messages` quando o eco chegasse. Ele NÃO grava antes: envia, muda
// o status para ENVIADA, e só então grava o histórico.
//
// Em uso real isso deu 46 leads marcados QUENTE numa base com UMA
// resposta — cada mensagem da campanha voltava como se fosse você
// assumindo a conversa.
describe('o eco de um envio do sistema não é mensagem sua', () => {
  /** Uma ordem de envio já processada, como o worker a deixa. */
  async function ordemEnviada(
    leadId: string,
    campanhaId: string,
    texto: string
  ) {
    const etapa = await prisma.campaignStep.create({
      data: { campaignId: campanhaId, ordem: 1, texto, ativo: true },
    });
    return prisma.outboundMessage.create({
      data: {
        leadId,
        campaignId: campanhaId,
        campaignStepId: etapa.id,
        idempotencyKey: `eco-${leadId}-${Date.now()}`,
        status: 'ENVIADA',
        textoRenderizado: texto,
        processedAt: new Date(),
        dryRun: false,
      },
    });
  }

  it('NÃO marca o lead como QUENTE — este é o bug dos 46 quentes', async () => {
    // A asserção que descreve o sintoma relatado.
    const { lead, campanha } = await cenario();
    const TEXTO = 'Oi, prazer, me chamo Lucas.';
    await ordemEnviada(lead.id, campanha.id, TEXTO);

    await inbound.processarMensagemRecebida(entrada(lead, TEXTO, true));

    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(l.temperatura).toBe('FRIO');
    expect(l.status).toBe('AGUARDANDO_RESPOSTA');
  });

  it('vale mesmo quando o worker AINDA NÃO gravou em messages', async () => {
    // A corrida em si: nenhuma linha em `messages` existe ainda, então
    // a UNIQUE do `whatsapp_message_id` não tem o que barrar. O que
    // separa os dois é a ORDEM DE ENVIO, que nasce no enfileiramento.
    const { lead, campanha } = await cenario();
    const TEXTO = 'Mensagem 2 da sequência';
    await ordemEnviada(lead.id, campanha.id, TEXTO);
    expect(await prisma.message.count({ where: { leadId: lead.id } })).toBe(0);

    const r = await inbound.processarMensagemRecebida(entrada(lead, TEXTO, true));

    expect(r.processada).toBe(false);
    expect(r.motivo).toContain('Eco');
    // E não cria a linha sem etapa que competiria com a do worker.
    expect(await prisma.message.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it('não pausa a automação do lead', async () => {
    // O pior efeito colateral: a campanha inteira se pausando sozinha a
    // cada mensagem que ela mesma manda.
    const { lead, campanha } = await cenario();
    const TEXTO = 'Mensagem 1 da campanha';
    await ordemEnviada(lead.id, campanha.id, TEXTO);
    await prisma.leadCampaign.updateMany({
      where: { leadId: lead.id },
      data: { status: 'EM_ANDAMENTO' },
    });

    await inbound.processarMensagemRecebida(entrada(lead, TEXTO, true));

    const v = await prisma.leadCampaign.findFirstOrThrow({
      where: { leadId: lead.id, campaignId: campanha.id },
    });
    expect(v.status).toBe('EM_ANDAMENTO');
    expect(v.aguardandoLiberacao).toBe(false);
  });

  it('mas uma mensagem SUA de verdade continua passando', async () => {
    // A garantia do outro lado: o filtro não pode ter desligado o
    // recurso inteiro. Texto que nenhuma ordem de envio tem.
    const { lead, campanha } = await cenario();
    await ordemEnviada(lead.id, campanha.id, 'Oi, prazer, me chamo Lucas.');

    await inbound.processarMensagemRecebida(
      entrada(lead, 'consigo te mostrar uma prévia amanhã, pode ser?', true)
    );

    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(l.status).toBe('EM_CONVERSA');
    expect(l.temperatura).toBe('QUENTE');
  });

  it('uma ordem ainda PENDENTE não silencia nada', async () => {
    // Ela não produziu eco nenhum — não passou pelo transporte. Se
    // silenciasse, uma mensagem sua com o texto de uma etapa futura
    // sumiria.
    const { lead, campanha } = await cenario();
    const TEXTO = 'Texto de uma etapa que ainda não saiu';
    const etapa = await prisma.campaignStep.create({
      data: { campaignId: campanha.id, ordem: 1, texto: TEXTO, ativo: true },
    });
    await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapa.id,
        idempotencyKey: `pend-${lead.id}-${Date.now()}`,
        status: 'PENDENTE',
        textoRenderizado: TEXTO,
        dryRun: false,
      },
    });

    const r = await inbound.processarMensagemRecebida(entrada(lead, TEXTO, true));
    expect(r.processada).toBe(true);
  });

  it('o eco de OUTRO lead não silencia este', async () => {
    // O texto de uma campanha é o mesmo para todos os leads. Sem o
    // recorte por lead, mandar na mão para o lead A seria descartado
    // porque o lead B recebeu aquele texto.
    const { lead: outro, campanha } = await cenario();
    const TEXTO = 'Oi, prazer, me chamo Lucas.';
    await ordemEnviada(outro.id, campanha.id, TEXTO);

    const { lead } = await cenario();
    const r = await inbound.processarMensagemRecebida(entrada(lead, TEXTO, true));

    expect(r.processada).toBe(true);
  });
});

describe('o que NÃO mudou', () => {
  it('a resposta do LEAD continua sendo classificada', async () => {
    // A garantia do outro lado: o conserto não pode ter desligado o
    // caminho normal.
    const { lead } = await cenario();

    await inbound.processarMensagemRecebida(entrada(lead, 'quero sim', false));

    const m = await prisma.message.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(m.direcao).toBe('RECEBIDA');
    expect(m.categoria).not.toBeNull();
  });

  it('o eco de um envio do próprio sistema não vira mensagem nova', async () => {
    // O `message_create` também dispara para o que o Prospector manda. A
    // UNIQUE do `whatsappMessageId` descarta — o envio já gravou aquela
    // chave.
    const { lead, campanha } = await cenario();
    const conversa = await prisma.conversation.create({
      data: { id: `eco-${lead.id}`, leadId: lead.id, campaignId: campanha.id },
    });
    const ID = `wa-eco-${Date.now()}`;
    await prisma.message.create({
      data: {
        conversationId: conversa.id,
        leadId: lead.id,
        campaignId: campanha.id,
        direcao: 'ENVIADA',
        status: 'ENVIADA',
        texto: 'Mensagem 1 da campanha',
        whatsappMessageId: ID,
      },
    });

    const r = await inbound.processarMensagemRecebida({
      ...entrada(lead, 'Mensagem 1 da campanha', true),
      providerMessageId: ID,
    });

    expect(r.processada).toBe(false);
    expect(await prisma.message.count({ where: { leadId: lead.id } })).toBe(1);
  });
});
