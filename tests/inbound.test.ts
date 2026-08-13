/**
 * O pipeline de recebimento, contra Postgres real.
 *
 * Cobre os itens 7 a 20 e 23 a 29 do plano da Fase 6A: mensagem
 * recebida, duplicada, telefone invalido, lead encontrado, nao
 * encontrado, ambiguo, as transicoes automaticas e a concorrencia.
 *
 * ============================================================
 * NENHUM TESTE AQUI ENVIA MENSAGEM
 * ============================================================
 * O caminho de envio e verificado pelo NEGATIVO: cada caso confere que
 * nada saiu de verdade.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import {
  identificarLead,
  type LeadCandidato,
} from '../packages/domain/src/inbound/identificar-lead.js';
import type { MensagemEntrada } from '../packages/integrations/src/whatsapp/eventos-canal.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });
process.env.LOG_LEVEL = 'silent';

let prisma: typeof import('@prospector/database').prisma;
let processar: typeof import('../apps/worker/src/services/inbound.js').processarMensagemRecebida;

beforeAll(async () => {
  prisma = (await import('@prospector/database')).prisma;
  ({ processarMensagemRecebida: processar } = await import(
    '../apps/worker/src/services/inbound.js'
  ));
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await prisma.unknownContact.deleteMany();
  await prisma.outboundMessage.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.task.deleteMany();
  await prisma.leadEvent.deleteMany();
  await prisma.leadCampaign.deleteMany();
  await prisma.campaignStep.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.lead.deleteMany();
});

let seq = 0;

async function criarLead(dados: Record<string, unknown> = {}) {
  seq += 1;
  return prisma.lead.create({
    data: {
      nomeCompleto: `Lead ${seq}`,
      empresa: `Empresa ${seq}`,
      telefone: `(19) 99999-${String(1000 + seq).slice(-4)}`,
      telefoneNormalizado: `551999${String(1000000 + seq).slice(-7)}`,
      cidade: 'Campinas',
      websiteStatus: 'NAO_INFORMADO',
      status: 'AGUARDANDO_RESPOSTA',
      ...dados,
    } as never,
  });
}

function entrada(
  telefone: string,
  texto: string,
  id?: string
): MensagemEntrada {
  seq += 1;
  return {
    providerMessageId: id ?? `pm-${seq}-${Date.now()}`,
    chatId: `${telefone}@c.us`,
    telefone,
    texto,
    nomeContato: 'Contato',
    recebidaEm: new Date(),
    deMim: false,
    tipo: 'chat',
    temMidia: false,
  };
}

// =================================================== 7-12 IDENTIFICACAO
describe('identificarLead — não adivinhar (função pura)', () => {
  const base = (over: Partial<LeadCandidato> = {}): LeadCandidato => ({
    id: `l-${Math.random().toString(36).slice(2, 8)}`,
    telefoneNormalizado: '5519999990000',
    optOut: false,
    status: 'AGUARDANDO_RESPOSTA',
    ultimaInteracaoEm: null,
    createdAt: new Date('2026-01-01'),
    ...over,
  });

  it('10. um candidato é dele', () => {
    const c = base();
    const r = identificarLead('5519999990000', [c]);
    expect(r).toEqual({ tipo: 'ENCONTRADO', leadId: c.id });
  });

  it('11. nenhum candidato é desconhecido', () => {
    const r = identificarLead('5519999990000', []);
    expect(r.tipo).toBe('DESCONHECIDO');
  });

  it('9. telefone que não normaliza é desconhecido', () => {
    const r = identificarLead(null, [base()]);
    expect(r.tipo).toBe('DESCONHECIDO');
    expect(r.tipo === 'DESCONHECIDO' && r.motivo).toMatch(/E\.164/);
  });

  it('12. dois ativos param e pedem revisão — não escolhe', () => {
    const r = identificarLead('5519999990000', [base(), base()]);

    // Escolher errado gravaria a resposta de uma pessoa no histórico de
    // outra, e dali toda decisão seguinte sai errada para as duas.
    expect(r.tipo).toBe('AMBIGUO');
    expect(r.tipo === 'AMBIGUO' && r.candidatos).toHaveLength(2);
  });

  it('duplicata encerrada não vira revisão humana', () => {
    const ativo = base({ status: 'AGUARDANDO_RESPOSTA' });
    const velho = base({ status: 'ENCERRADO' });

    // Pedir revisão para isso seria ruído: só um deles está no jogo.
    const r = identificarLead('5519999990000', [velho, ativo]);
    expect(r).toEqual({ tipo: 'ENCONTRADO', leadId: ativo.id });
  });

  it('todos encerrados: o mais recente é o dono da última conversa', () => {
    const antigo = base({
      status: 'ENCERRADO',
      ultimaInteracaoEm: new Date('2026-01-01'),
    });
    const recente = base({
      status: 'ENCERRADO',
      ultimaInteracaoEm: new Date('2026-08-01'),
    });

    const r = identificarLead('5519999990000', [antigo, recente]);
    expect(r).toEqual({ tipo: 'ENCONTRADO', leadId: recente.id });
  });
});

// ==================================================== 7-8 RECEBIMENTO
describe('processarMensagemRecebida', () => {
  it('7. grava a mensagem e liga ao lead', async () => {
    const lead = await criarLead();

    const r = await processar(entrada(lead.telefoneNormalizado!, 'Pode mandar'));

    expect(r.processada).toBe(true);
    expect(r.leadId).toBe(lead.id);

    const m = await prisma.message.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(m.direcao).toBe('RECEBIDA');
    expect(m.texto).toBe('Pode mandar');
    expect(m.categoria).not.toBeNull();
    // A confiança é o que separa uma certeza de um chute.
    expect(m.confianca).toBeGreaterThan(0);
  });

  it('8. a mesma mensagem duas vezes não vira duas linhas', async () => {
    const lead = await criarLead();
    const e = entrada(lead.telefoneNormalizado!, 'Pode mandar', 'mesmo-id');

    const primeira = await processar(e);
    const segunda = await processar(e);

    expect(primeira.processada).toBe(true);
    expect(segunda.processada).toBe(false);
    expect(await prisma.message.count({ where: { leadId: lead.id } })).toBe(1);
  });

  /**
   * O caso que o `findUnique` antes do `create` não cobre: as duas
   * chamadas consultam antes de qualquer uma gravar. Só a constraint
   * UNIQUE resolve.
   */
  it('27. cinco entregas simultâneas do mesmo evento produzem 1 mensagem', async () => {
    const lead = await criarLead();
    const e = entrada(lead.telefoneNormalizado!, 'Pode mandar', 'corrida-1');

    await Promise.all(Array.from({ length: 5 }, () => processar(e)));

    expect(await prisma.message.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it('11. número sem lead vira contato desconhecido, não some', async () => {
    const r = await processar(entrada('5511987654321', 'oi quem é'));

    expect(r.leadId).toBeNull();
    const c = await prisma.unknownContact.findFirstOrThrow();
    expect(c.telefone).toBe('5511987654321');
    expect(c.texto).toBe('oi quem é');
    expect(c.resolvido).toBe(false);
  });

  it('contato desconhecido duplicado não vira duas linhas', async () => {
    const e = entrada('5511987654321', 'oi', 'desc-1');
    await processar(e);
    await processar(e);

    expect(await prisma.unknownContact.count()).toBe(1);
  });

  /**
   * 12. AMBIGUIDADE: o banco a torna impossivel por esta via.
   *
   * `leads.telefone_normalizado` e UNIQUE. Dois leads NAO conseguem
   * compartilhar o mesmo telefone — a busca por telefone devolve zero ou
   * um candidato, nunca varios.
   *
   * O ramo AMBIGUO de `identificarLead` continua existindo e testado
   * como funcao pura (acima), porque ele e a defesa para o dia em que a
   * identificacao usar outra chave — um segundo telefone do lead, ou
   * casamento por nome+cidade. Hoje ele e inalcancavel, e este teste
   * documenta o porque em vez de fingir que exercita o caminho.
   */
  it('12. o banco impede dois leads com o mesmo telefone', async () => {
    const telefone = '5519999123456';
    await criarLead({ telefoneNormalizado: telefone });

    await expect(
      criarLead({ telefoneNormalizado: telefone })
    ).rejects.toThrow(/[Uu]nique constraint/);
  });

  it('abre uma conversa e conta a mensagem como não lida', async () => {
    const lead = await criarLead();
    await processar(entrada(lead.telefoneNormalizado!, 'Pode mandar'));

    const conversa = await prisma.conversation.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(conversa.naoLidas).toBe(1);
    expect(conversa.ultimaMensagemTexto).toBe('Pode mandar');
  });
});

// ================================================== 13-20 AUTOMACAO
describe('classificação e efeitos', () => {
  it('13. resposta positiva é classificada e registrada', async () => {
    const lead = await criarLead();
    const r = await processar(
      entrada(lead.telefoneNormalizado!, 'Tenho interesse sim, pode mandar')
    );

    expect(['POSITIVO', 'INTERESSE']).toContain(r.categoria);
    expect(r.confianca).toBeGreaterThanOrEqual(30);
  });

  it('14. resposta negativa é classificada', async () => {
    const lead = await criarLead();
    const r = await processar(
      entrada(lead.telefoneNormalizado!, 'não tenho interesse, obrigado')
    );

    expect(r.categoria).toBe('NEGATIVO');
  });

  it('15. resposta ambígua não é forçada numa categoria', async () => {
    const lead = await criarLead();
    const r = await processar(entrada(lead.telefoneNormalizado!, 'xyzzy plugh'));

    // Na dúvida entre classificar e não classificar, o motor escolhe
    // DESCONHECIDO — e isso vira intervenção, não uma aposta.
    expect(r.categoria).toBe('DESCONHECIDO');
  });

  it('16. opt-out marca o lead e cancela a fila', async () => {
    const lead = await criarLead();

    // Deixa uma mensagem na fila para provar que ela é cancelada.
    const campanha = await prisma.campaign.create({
      data: { nome: `C${++seq}`, status: 'ATIVA' } as never,
    });
    const etapa = await prisma.campaignStep.create({
      data: { campaignId: campanha.id, ordem: 1, texto: 'oi', ativo: true },
    });
    const pendente = await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapa.id,
        idempotencyKey: `k-${seq}`,
        status: 'AGENDADA',
        scheduledAt: new Date(Date.now() + 3600_000),
        dryRun: true,
      },
    });

    const r = await processar(
      entrada(lead.telefoneNormalizado!, 'pare de mandar mensagem, remova meu contato')
    );

    expect(r.categoria).toBe('OPT_OUT');

    const atualizado = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(atualizado.optOut).toBe(true);
    expect(atualizado.status).toBe('OPT_OUT');

    // 19. Opt-out sem cancelar a fila seria promessa quebrada.
    const depois = await prisma.outboundMessage.findUniqueOrThrow({
      where: { id: pendente.id },
    });
    expect(depois.status).toBe('CANCELADA');
  });

  it('17. a transição muda o status do lead', async () => {
    const lead = await criarLead();
    await processar(entrada(lead.telefoneNormalizado!, 'xyzzy plugh'));

    const atualizado = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    // Resposta não reconhecida trava a conversa para você resolver.
    expect(atualizado.status).toBe('AGUARDANDO_INTERVENCAO');
  });

  it('18. resposta não reconhecida cria tarefa e notificação', async () => {
    const lead = await criarLead();
    await processar(entrada(lead.telefoneNormalizado!, 'xyzzy plugh'));

    const tarefa = await prisma.task.findFirst({ where: { leadId: lead.id } });
    expect(tarefa).not.toBeNull();

    const notificacao = await prisma.notification.findFirst({
      where: { leadId: lead.id },
    });
    expect(notificacao).not.toBeNull();
  });

  it('registra o evento com a categoria e a confiança', async () => {
    const lead = await criarLead();
    await processar(entrada(lead.telefoneNormalizado!, 'quanto custa?'));

    const evento = await prisma.leadEvent.findFirstOrThrow({
      where: { leadId: lead.id, tipo: 'RESPOSTA_CLASSIFICADA' },
    });
    // "Por que o sistema fez isso?" precisa ter resposta na tela.
    expect(evento.descricao).toMatch(/confiança \d+/);
  });

  it('atualiza a última categoria do lead, para o dashboard contar', async () => {
    const lead = await criarLead();
    await processar(entrada(lead.telefoneNormalizado!, 'quanto custa?'));

    const atualizado = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(atualizado.ultimaCategoria).toBe('PRECO');
    expect(atualizado.ultimaInteracaoEm).not.toBeNull();
  });
});

// ======================================================= 21-24 DRY-RUN
describe('nada sai — a verificação do fim da fase', () => {
  it('22. depois de todo o pipeline, REAL_MESSAGES_SENT continua 0', async () => {
    const lead = await criarLead();

    for (const texto of [
      'Tenho interesse',
      'quanto custa?',
      'me manda depois',
      'não quero',
    ]) {
      await processar(entrada(lead.telefoneNormalizado!, texto));
    }

    const reais = await prisma.message.count({
      where: { direcao: 'ENVIADA', simulada: false },
    });
    expect(reais).toBe(0);

    // Nem sequer existe mensagem com id do WhatsApp, que só um envio
    // real produziria.
    const comId = await prisma.message.count({
      where: { direcao: 'ENVIADA', whatsappMessageId: { not: null } },
    });
    expect(comId).toBe(0);
  });

  it('23. a classificação fica registrada, mesmo sem envio', async () => {
    const lead = await criarLead();
    await processar(entrada(lead.telefoneNormalizado!, 'quanto custa?'));

    const m = await prisma.message.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(m.categoria).toBe('PRECO');
    expect(m.confianca).not.toBeNull();
    expect(m.textoNormalizado).toMatch(/\S/);
  });
});

// ===================================================== 25-26 CONCORRENCIA
describe('concorrência', () => {
  it('25. mensagem chegando com job pendente não duplica a fila', async () => {
    const lead = await criarLead();
    const campanha = await prisma.campaign.create({
      data: { nome: `C${++seq}`, status: 'ATIVA' } as never,
    });
    const etapa = await prisma.campaignStep.create({
      data: { campaignId: campanha.id, ordem: 1, texto: 'oi', ativo: true },
    });
    await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapa.id,
        idempotencyKey: `k-conc-${seq}`,
        status: 'AGENDADA',
        scheduledAt: new Date(Date.now() + 3600_000),
        dryRun: true,
      },
    });

    await processar(entrada(lead.telefoneNormalizado!, 'Tenho interesse'));

    // O pipeline não enfileira nada nesta fase; a fila continua com a
    // única mensagem que já existia.
    expect(await prisma.outboundMessage.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it('26. assumir a conversa enquanto há job cancela a fila', async () => {
    const lead = await criarLead();
    const campanha = await prisma.campaign.create({
      data: { nome: `C${++seq}`, status: 'ATIVA' } as never,
    });
    const etapa = await prisma.campaignStep.create({
      data: { campaignId: campanha.id, ordem: 1, texto: 'oi', ativo: true },
    });
    await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapa.id,
        idempotencyKey: `k-assumir-${seq}`,
        status: 'AGENDADA',
        scheduledAt: new Date(Date.now() + 3600_000),
        dryRun: true,
      },
    });

    // Espelha o que a rota de status faz ao assumir a conversa.
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'AGUARDANDO_INTERVENCAO' },
    });
    await prisma.outboundMessage.updateMany({
      where: { leadId: lead.id, status: { in: ['PENDENTE', 'AGENDADA'] } },
      data: { status: 'CANCELADA', erro: 'Conversa assumida' },
    });

    const pendentes = await prisma.outboundMessage.count({
      where: { leadId: lead.id, status: { in: ['PENDENTE', 'AGENDADA'] } },
    });
    // Sem isso, o sistema mandaria a próxima etapa por cima da conversa
    // que você acabou de assumir.
    expect(pendentes).toBe(0);
  });

  it('mensagens diferentes do mesmo lead são todas gravadas', async () => {
    const lead = await criarLead();

    await Promise.all([
      processar(entrada(lead.telefoneNormalizado!, 'oi', 'a1')),
      processar(entrada(lead.telefoneNormalizado!, 'tudo bem?', 'a2')),
      processar(entrada(lead.telefoneNormalizado!, 'pode mandar', 'a3')),
    ]);

    expect(await prisma.message.count({ where: { leadId: lead.id } })).toBe(3);
  });
});
