/**
 * Tarefas e intervencao manual — contra Postgres real.
 *
 * O que se prova aqui e o que so o banco pode garantir: que a acao
 * manual muda o lead E deixa rastro, e que os efeitos colaterais certos
 * acontecem (fila cancelada, tarefas fechadas, notificacoes silenciadas).
 *
 * Um teste que so checasse o status devolvido pela rota passaria mesmo
 * se o LeadEvent nunca fosse gravado — e "quem mudou isso?" e a primeira
 * pergunta quando algo da errado.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { FastifyInstance } from 'fastify';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });
process.env.LOG_LEVEL = 'silent';

let app: FastifyInstance;
let cookie: string;
let prisma: typeof import('@prospector/database').prisma;

beforeAll(async () => {
  prisma = (await import('@prospector/database')).prisma;
  const { criarApp } = await import('../apps/api/src/app.js');
  ({ app } = await criarApp());
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: {
      email: process.env.SEED_USER_EMAIL ?? 'admin@local',
      senha: process.env.SEED_USER_PASSWORD ?? 'prospector123',
    },
  });
  if (login.statusCode !== 200) {
    throw new Error('Login falhou. Rode: pnpm db:migrate && pnpm db:seed');
  }
  cookie = login.headers['set-cookie']!.toString().split(';')[0]!;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await prisma.outboundMessage.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.task.deleteMany();
  await prisma.leadEvent.deleteMany();
  await prisma.campaignStep.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.captureSession.deleteMany();
});

let seq = 0;

async function criarLead(dados: Record<string, unknown> = {}) {
  seq += 1;
  return prisma.lead.create({
    data: {
      nomeCompleto: `Lead ${seq}`,
      empresa: `Empresa ${seq}`,
      telefone: `(19) 99999-${String(1000 + seq).slice(-4)}`,
      telefoneNormalizado: `5519999${String(100000 + seq).slice(-6)}`,
      cidade: 'Campinas',
      websiteStatus: 'NAO_INFORMADO',
      status: 'IMPORTADO',
      ...dados,
    } as never,
  });
}

function chamar(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { cookie }, payload: payload as never });
}

/** Cria uma mensagem na fila para conferir os cancelamentos. */
async function enfileirarPara(leadId: string) {
  const campanha = await prisma.campaign.create({
    data: { nome: `C${++seq}`, status: 'ATIVA' } as never,
  });
  const etapa = await prisma.campaignStep.create({
    data: { campaignId: campanha.id, ordem: 1, texto: 'oi', ativo: true },
  });
  return prisma.outboundMessage.create({
    data: {
      leadId,
      campaignId: campanha.id,
      campaignStepId: etapa.id,
      idempotencyKey: `k-${seq}-${Date.now()}`,
      status: 'AGENDADA',
      scheduledAt: new Date(Date.now() + 3600_000),
      dryRun: true,
    },
  });
}

// ------------------------------------------------------------------ status
describe('POST /api/leads/:id/status', () => {
  it('muda o status e grava o evento', async () => {
    const lead = await criarLead();

    const r = await chamar('POST', `/api/leads/${lead.id}/status`, {
      status: 'EM_CONVERSA',
      motivo: 'assumi no WhatsApp',
    });

    expect(r.statusCode).toBe(200);
    const atualizado = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(atualizado.status).toBe('EM_CONVERSA');

    const eventos = await prisma.leadEvent.findMany({ where: { leadId: lead.id } });
    expect(eventos.some((e) => e.tipo === 'STATUS_ALTERADO')).toBe(true);
    expect(eventos[0]?.descricao).toContain('assumi no WhatsApp');
    expect(eventos[0]?.origem).toBe('usuario');
  });

  it('sair do automático cancela a fila do lead', async () => {
    const lead = await criarLead();
    const msg = await enfileirarPara(lead.id);

    await chamar('POST', `/api/leads/${lead.id}/status`, { status: 'PAUSADO' });

    const depois = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(depois.status).toBe('CANCELADA');
  });

  it('recusa OPT_OUT — essa mudança tem rota própria', async () => {
    const lead = await criarLead();
    const r = await chamar('POST', `/api/leads/${lead.id}/status`, { status: 'OPT_OUT' });

    expect(r.statusCode).toBe(422);
    expect(r.json().erro.codigo).toBe('USE_ROTA_OPT_OUT');
  });

  it('recusa mudar o status de um lead em opt-out', async () => {
    const lead = await criarLead({ optOut: true, status: 'OPT_OUT' });
    const r = await chamar('POST', `/api/leads/${lead.id}/status`, { status: 'PRONTO' });

    expect(r.statusCode).toBe(422);
    expect(r.json().erro.codigo).toBe('LEAD_EM_OPT_OUT');
  });

  it('mudar para o mesmo status não gera evento duplicado', async () => {
    const lead = await criarLead({ status: 'EM_CONVERSA' });
    await chamar('POST', `/api/leads/${lead.id}/status`, { status: 'EM_CONVERSA' });

    expect(await prisma.leadEvent.count({ where: { leadId: lead.id } })).toBe(0);
  });
});

// ----------------------------------------------------- resolver intervencao
describe('POST /api/leads/:id/resolver-intervencao', () => {
  it('destrava o lead, guarda a nota e registra o evento', async () => {
    const lead = await criarLead({
      status: 'AGUARDANDO_INTERVENCAO',
      proximaAcao: 'resposta não reconhecida',
    });

    const r = await chamar('POST', `/api/leads/${lead.id}/resolver-intervencao`, {
      novoStatus: 'EM_CONVERSA',
      nota: 'Liguei; pediu orçamento por e-mail.',
    });

    expect(r.statusCode).toBe(200);

    const atualizado = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(atualizado.status).toBe('EM_CONVERSA');
    expect(atualizado.observacoes).toContain('orçamento por e-mail');
    // A próxima ação descrevia a intervenção que acabou de ser resolvida.
    expect(atualizado.proximaAcao).toBeNull();

    const eventos = await prisma.leadEvent.findMany({ where: { leadId: lead.id } });
    expect(eventos.some((e) => e.tipo === 'INTERVENCAO_RESOLVIDA')).toBe(true);
  });

  it('fecha as tarefas que descreviam o mesmo problema', async () => {
    const lead = await criarLead({ status: 'AGUARDANDO_INTERVENCAO' });
    await prisma.task.create({
      data: {
        leadId: lead.id,
        tipo: 'RESPOSTA_NAO_RECONHECIDA',
        titulo: 'Responder manualmente',
        status: 'ABERTA',
      },
    });

    const r = await chamar('POST', `/api/leads/${lead.id}/resolver-intervencao`, {});

    expect(r.json().tarefasConcluidas).toBe(1);
    const tarefa = await prisma.task.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(tarefa.status).toBe('CONCLUIDA');
    expect(tarefa.concluidaEm).not.toBeNull();
  });

  it('silencia as notificações de intervenção do lead', async () => {
    const lead = await criarLead({ status: 'AGUARDANDO_INTERVENCAO' });
    await prisma.notification.create({
      data: {
        leadId: lead.id,
        tipo: 'INTERVENCAO_NECESSARIA',
        titulo: 'Precisa de você',
        mensagem: 'Resposta não reconhecida',
        prioridade: 1,
      },
    });

    await chamar('POST', `/api/leads/${lead.id}/resolver-intervencao`, {});

    const n = await prisma.notification.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(n.lida).toBe(true);
  });

  it('recusa quando o lead não está aguardando intervenção', async () => {
    const lead = await criarLead({ status: 'PRONTO' });
    const r = await chamar('POST', `/api/leads/${lead.id}/resolver-intervencao`, {});

    expect(r.statusCode).toBe(422);
    expect(r.json().erro.codigo).toBe('SEM_INTERVENCAO_PENDENTE');
  });
});

// ----------------------------------------------------------------- opt-out
describe('opt-out', () => {
  it('registrar cancela a fila e grava o evento', async () => {
    const lead = await criarLead();
    const msg = await enfileirarPara(lead.id);

    const r = await chamar('POST', `/api/leads/${lead.id}/opt-out`, {});

    expect(r.statusCode).toBe(200);
    expect(r.json().canceladas).toBe(1);

    const atualizado = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(atualizado.optOut).toBe(true);
    expect(atualizado.optOutEm).not.toBeNull();
    expect(atualizado.status).toBe('OPT_OUT');

    const depois = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(depois.status).toBe('CANCELADA');

    const eventos = await prisma.leadEvent.findMany({ where: { leadId: lead.id } });
    expect(eventos.some((e) => e.tipo === 'OPT_OUT_REGISTRADO')).toBe(true);
  });

  it('lead em opt-out sai de qualquer campanha futura', async () => {
    const lead = await criarLead();
    await chamar('POST', `/api/leads/${lead.id}/opt-out`, {});

    const { montarWhere } = await import(
      '../apps/api/src/services/campaign-service.js'
    );
    const alcancaveis = await prisma.lead.count({ where: montarWhere({}) });
    expect(alcancaveis).toBe(0);
  });

  it('reverter exige confirmação explícita E justificativa', async () => {
    const lead = await criarLead({ optOut: true, status: 'OPT_OUT' });

    // 422 é o código de validação deste projeto (ver lib/errors.ts).
    const semConfirmar = await chamar(
      'POST',
      `/api/leads/${lead.id}/opt-out/reverter`,
      { motivo: 'marquei errado' }
    );
    expect(semConfirmar.statusCode).toBe(422);

    const semMotivo = await chamar('POST', `/api/leads/${lead.id}/opt-out/reverter`, {
      confirmar: true,
    });
    expect(semMotivo.statusCode).toBe(422);

    // Nenhuma das tentativas pode ter revertido nada.
    const inalterado = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(inalterado.optOut).toBe(true);
  });

  it('reverter volta o lead como PAUSADO, nunca direto para a campanha', async () => {
    const lead = await criarLead({ optOut: true, status: 'OPT_OUT' });

    const r = await chamar('POST', `/api/leads/${lead.id}/opt-out/reverter`, {
      confirmar: true,
      motivo: 'marquei o lead errado',
    });

    expect(r.statusCode).toBe(200);
    const atualizado = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(atualizado.optOut).toBe(false);
    // Retomar o envio automático precisa ser um segundo ato consciente.
    expect(atualizado.status).toBe('PAUSADO');

    const eventos = await prisma.leadEvent.findMany({ where: { leadId: lead.id } });
    expect(eventos[0]?.descricao).toContain('REVERTIDO');
    expect(eventos[0]?.descricao).toContain('marquei o lead errado');
  });
});

// ----------------------------------------------------------------- tarefas
describe('tarefas', () => {
  it('cria e lista', async () => {
    const lead = await criarLead();
    const criada = await chamar('POST', '/api/tasks', {
      leadId: lead.id,
      titulo: 'Montar preview',
      tipo: 'CRIAR_PREVIEW',
      prioridade: 'ALTA',
    });

    expect(criada.statusCode).toBe(201);

    const lista = await chamar('GET', '/api/tasks');
    expect(lista.json().tarefas).toHaveLength(1);
    expect(lista.json().tarefas[0].lead.id).toBe(lead.id);
  });

  it('concluir preenche concluidaEm', async () => {
    const criada = await chamar('POST', '/api/tasks', { titulo: 'Qualquer coisa' });
    const id = criada.json().tarefa.id;

    const r = await chamar('POST', `/api/tasks/${id}/concluir`);

    expect(r.statusCode).toBe(200);
    expect(r.json().tarefa.status).toBe('CONCLUIDA');
    expect(r.json().tarefa.concluidaEm).not.toBeNull();
  });

  it('reabrir limpa concluidaEm — não existe tarefa aberta com data de conclusão', async () => {
    const criada = await chamar('POST', '/api/tasks', { titulo: 'Reabrir' });
    const id = criada.json().tarefa.id;

    await chamar('POST', `/api/tasks/${id}/concluir`);
    const r = await chamar('PATCH', `/api/tasks/${id}`, { status: 'ABERTA' });

    expect(r.json().tarefa.status).toBe('ABERTA');
    expect(r.json().tarefa.concluidaEm).toBeNull();
  });

  it('conta as atrasadas', async () => {
    await chamar('POST', '/api/tasks', {
      titulo: 'Vencida',
      prazo: new Date(Date.now() - 86_400_000).toISOString(),
    });
    // Sem prazo nunca conta como atrasada. É proposital, não esquecimento.
    await chamar('POST', '/api/tasks', { titulo: 'Sem prazo' });

    const lista = await chamar('GET', '/api/tasks');
    expect(lista.json().atrasadas).toBe(1);
  });

  it('recusa tarefa para lead inexistente', async () => {
    const r = await chamar('POST', '/api/tasks', {
      leadId: '00000000-0000-0000-0000-000000000000',
      titulo: 'Órfã',
    });
    expect(r.statusCode).toBe(404);
  });
});

// --------------------------------------------------------------- dashboard
describe('GET /api/dashboard — precisa da sua atenção', () => {
  it('lista o lead em intervenção com a ação necessária', async () => {
    await criarLead({ status: 'AGUARDANDO_INTERVENCAO' });

    const r = await chamar('GET', '/api/dashboard');
    const atencao = r.json().atencao;

    expect(atencao).toHaveLength(1);
    expect(atencao[0].motivo).toBe('INTERVENCAO_NECESSARIA');
    expect(atencao[0].acaoNecessaria).toBe('Responder manualmente');
  });

  it('lead quente que virou cliente sai da lista', async () => {
    await criarLead({ temperatura: 'QUENTE', status: 'CLIENTE' });

    const r = await chamar('GET', '/api/dashboard');
    expect(r.json().atencao).toHaveLength(0);
  });

  it('lead em opt-out nunca aparece', async () => {
    await criarLead({ temperatura: 'QUENTE', optOut: true, status: 'OPT_OUT' });

    const r = await chamar('GET', '/api/dashboard');
    expect(r.json().atencao).toHaveLength(0);
  });

  it('resolver a intervenção tira o lead da lista', async () => {
    const lead = await criarLead({ status: 'AGUARDANDO_INTERVENCAO' });

    expect((await chamar('GET', '/api/dashboard')).json().atencao).toHaveLength(1);
    await chamar('POST', `/api/leads/${lead.id}/resolver-intervencao`, {});
    expect((await chamar('GET', '/api/dashboard')).json().atencao).toHaveLength(0);
  });
});

// ------------------------------------------------------------ notificacoes
describe('notificações', () => {
  /** Notificações não têm rota de criação: são geradas pelo sistema. */
  async function semear(qtd: number, prioridade = 50) {
    for (let i = 0; i < qtd; i++) {
      await prisma.notification.create({
        data: {
          tipo: 'SISTEMA',
          titulo: `Aviso ${i}`,
          mensagem: 'texto',
          prioridade,
        },
      });
    }
  }

  it('lista com o contador de não lidas', async () => {
    await semear(3);

    const r = await chamar('GET', '/api/notifications');
    expect(r.json().notificacoes).toHaveLength(3);
    expect(r.json().naoLidas).toBe(3);
  });

  it('marcar uma como lida abaixa o contador', async () => {
    await semear(2);
    const lista = await chamar('GET', '/api/notifications');
    const id = lista.json().notificacoes[0].id;

    const r = await chamar('POST', `/api/notifications/${id}/read`);
    expect(r.statusCode).toBe(200);
    expect(r.json().notificacao.lida).toBe(true);
    expect(r.json().notificacao.lidaEm).not.toBeNull();

    const depois = await chamar('GET', '/api/notifications');
    expect(depois.json().naoLidas).toBe(1);
  });

  it('marcar todas zera o contador', async () => {
    await semear(4);

    const r = await chamar('POST', '/api/notifications/read-all');
    expect(r.json().marcadas).toBe(4);

    const depois = await chamar('GET', '/api/notifications');
    expect(depois.json().naoLidas).toBe(0);
  });

  /**
   * A ordem é por PRIORIDADE, não por data: uma intervenção necessária
   * de ontem importa mais que uma importação concluída agora.
   */
  it('a mais urgente vem antes da mais recente', async () => {
    await prisma.notification.create({
      data: {
        tipo: 'IMPORTACAO_CONCLUIDA',
        titulo: 'Importação concluída',
        mensagem: 'agora',
        prioridade: 50,
      },
    });
    await prisma.notification.create({
      data: {
        tipo: 'INTERVENCAO_NECESSARIA',
        titulo: 'Precisa de você',
        mensagem: 'ontem',
        prioridade: 1,
      },
    });

    const r = await chamar('GET', '/api/notifications');
    expect(r.json().notificacoes[0].titulo).toBe('Precisa de você');
  });

  it('as lidas vão para o fim da lista', async () => {
    await semear(1, 1);
    const lista = await chamar('GET', '/api/notifications');
    const urgente = lista.json().notificacoes[0].id;
    await chamar('POST', `/api/notifications/${urgente}/read`);

    await semear(1, 50);

    const depois = await chamar('GET', '/api/notifications');
    expect(depois.json().notificacoes[0].lida).toBe(false);
  });

  it('404 para notificação inexistente', async () => {
    const r = await chamar(
      'POST',
      '/api/notifications/00000000-0000-0000-0000-000000000000/read'
    );
    expect(r.statusCode).toBe(404);
  });
});

// -------------------------------------------------------- "já mandei"
//
// ============================================================
// O BOTÃO DA LISTA DE QUEM NÃO RESPONDEU
// ============================================================
// Pedido: "colocar um botão de marcado como mandado em cada lead e
// atualizar a lista — porque ai eu mando".
//
// Aquela lista é uma fila de trabalho: você passa por ela abrindo o
// WhatsApp e escrevendo na mão. Sem uma forma de riscar o que já foi
// feito, ela nunca encolhe, e na próxima visita você reescreve para os
// mesmos leads — que é a forma mais rápida de queimar um número.
describe('POST /api/leads/:id/marcar-mandado', () => {
  it('grava o rastro, move o lead e para a automação', async () => {
    const lead = await criarLead({ status: 'AGUARDANDO_RESPOSTA' });
    const fila = await enfileirarPara(lead.id);

    const r = await chamar('POST', `/api/leads/${lead.id}/marcar-mandado`);
    expect(r.statusCode).toBe(200);

    const depois = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(depois.status).toBe('EM_CONVERSA');
    expect(depois.temperatura).toBe('QUENTE');

    // O rastro: "quem mudou isso?" tem que ter resposta.
    const ev = await prisma.leadEvent.findFirstOrThrow({
      where: { leadId: lead.id, origem: 'marcado-a-mao' },
    });
    expect(ev.tipo).toBe('MENSAGEM_ENVIADA');

    // A automação para: mandar a etapa 2 por cima seria o robô falando
    // junto com você.
    const m = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: fila.id } });
    expect(m.status).toBe('CANCELADA');
  });

  it('NÃO envia mensagem nenhuma', async () => {
    // É uma anotação — "cuidei deste". Se criasse uma linha em
    // `messages`, o funil de envios passaria a contar o que você fez na
    // mão como se o sistema tivesse mandado.
    const lead = await criarLead();

    await chamar('POST', `/api/leads/${lead.id}/marcar-mandado`);

    expect(await prisma.message.count({ where: { leadId: lead.id } })).toBe(0);
    expect(await prisma.outboundMessage.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it('recusa um lead em opt-out', async () => {
    // A tela pode estar velha. Esta é a última chance de não registrar
    // "mandei mensagem" para quem pediu para parar.
    const lead = await criarLead({ optOut: true, status: 'OPT_OUT' });

    const r = await chamar('POST', `/api/leads/${lead.id}/marcar-mandado`);
    expect(r.statusCode).toBe(422);

    expect(
      await prisma.leadEvent.count({
        where: { leadId: lead.id, origem: 'marcado-a-mao' },
      })
    ).toBe(0);
  });

  it('não rebaixa quem já está adiante', async () => {
    const lead = await criarLead({ status: 'CLIENTE' });

    await chamar('POST', `/api/leads/${lead.id}/marcar-mandado`);

    const depois = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(depois.status).toBe('CLIENTE');
  });

  it('desfazer devolve o lead à lista', async () => {
    // Um clique errado numa lista de trinta nomes tem que ter volta.
    const lead = await criarLead();
    await chamar('POST', `/api/leads/${lead.id}/marcar-mandado`);

    const r = await app.inject({
      method: 'DELETE',
      url: `/api/leads/${lead.id}/marcar-mandado`,
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().desfeitos).toBe(1);

    expect(
      await prisma.leadEvent.count({
        where: { leadId: lead.id, origem: 'marcado-a-mao' },
      })
    ).toBe(0);
  });
});

// ============================================================
// E A LISTA ENCOLHE
// ============================================================
// "…e atualizar a lista". O botão só serve se o lead sair de "não
// responderam" — senão você marca, volta ao dashboard e o mesmo nome
// continua lá pedindo trabalho que já foi feito.
describe('GET /api/dashboard/sem-resposta depois do "já mandei"', () => {
  async function enviadaPara(leadId: string) {
    seq += 1;
    const campanha = await prisma.campaign.create({
      data: { nome: `SR${seq}-${Date.now()}`, status: 'ATIVA' } as never,
    });
    const etapa = await prisma.campaignStep.create({
      data: { campaignId: campanha.id, ordem: 1, texto: 'oi', ativo: true },
    });
    await prisma.outboundMessage.create({
      data: {
        leadId,
        campaignId: campanha.id,
        campaignStepId: etapa.id,
        idempotencyKey: `sr-${seq}-${Date.now()}`,
        status: 'ENVIADA',
        processedAt: new Date(),
        dryRun: false,
      },
    });
  }

  const idsNaLista = async (): Promise<string[]> => {
    const r = await chamar('GET', '/api/dashboard/sem-resposta');
    return r
      .json()
      .grupos.flatMap((g: { leads: { leadId: string }[] }) =>
        g.leads.map((l) => l.leadId)
      );
  };

  it('o lead marcado sai da lista; o não marcado fica', async () => {
    const marcado = await criarLead({ status: 'AGUARDANDO_RESPOSTA' });
    const outro = await criarLead({ status: 'AGUARDANDO_RESPOSTA' });
    await enviadaPara(marcado.id);
    await enviadaPara(outro.id);

    expect(await idsNaLista()).toEqual(
      expect.arrayContaining([marcado.id, outro.id])
    );

    await chamar('POST', `/api/leads/${marcado.id}/marcar-mandado`);

    const depois = await idsNaLista();
    expect(depois).not.toContain(marcado.id);
    // A garantia do outro lado: o filtro tira UM lead, e não a lista.
    expect(depois).toContain(outro.id);
  });

  it('desfazer devolve o lead à lista', async () => {
    const lead = await criarLead({ status: 'AGUARDANDO_RESPOSTA' });
    await enviadaPara(lead.id);

    await chamar('POST', `/api/leads/${lead.id}/marcar-mandado`);
    expect(await idsNaLista()).not.toContain(lead.id);

    await app.inject({
      method: 'DELETE',
      url: `/api/leads/${lead.id}/marcar-mandado`,
      headers: { cookie },
    });
    expect(await idsNaLista()).toContain(lead.id);
  });
});

// ============================================================
// POR NICHO
// ============================================================
// Pedido: "quero que tenha um total — todos os nichos mandados — e as
// informações de quantos mandaram e etc de cada nicho também".
//
// O que só o banco prova: que o nicho sai mesmo da CaptureSession que a
// importação criou, e não de um campo do lead que ninguém preenche.
describe('GET /api/dashboard/nichos', () => {
  async function leadDoNicho(nicho: string, comEnvio: boolean) {
    seq += 1;
    const sessao = await prisma.captureSession.create({
      data: { nicho, cidade: 'Campinas' },
    });
    const lead = await criarLead({ captureSessionId: sessao.id });

    if (comEnvio) {
      const campanha = await prisma.campaign.create({
        data: { nome: `N${seq}-${Date.now()}`, status: 'ATIVA' } as never,
      });
      const etapa = await prisma.campaignStep.create({
        data: { campaignId: campanha.id, ordem: 1, texto: 'oi', ativo: true },
      });
      await prisma.outboundMessage.create({
        data: {
          leadId: lead.id,
          campaignId: campanha.id,
          campaignStepId: etapa.id,
          idempotencyKey: `n-${seq}-${Date.now()}`,
          status: 'ENVIADA',
          processedAt: new Date(),
          dryRun: false,
        },
      });
    }
    return lead;
  }

  it('separa por nicho e traz o total de todos', async () => {
    await leadDoNicho('Estética automotiva', true);
    await leadDoNicho('Estética automotiva', true);
    await leadDoNicho('Psicólogo', false);

    const r = await chamar('GET', '/api/dashboard/nichos');
    expect(r.statusCode).toBe(200);
    const corpo = r.json();

    expect(corpo.total.nicho).toBe('Todos os nichos');
    expect(corpo.total.leads).toBe(3);
    expect(corpo.total.abordados).toBe(2);
    expect(corpo.total.naFila).toBe(1);

    const estetica = corpo.nichos.find(
      (n: { nicho: string }) => n.nicho === 'Estética automotiva'
    );
    expect(estetica.abordados).toBe(2);

    const psi = corpo.nichos.find(
      (n: { nicho: string }) => n.nicho === 'Psicólogo'
    );
    expect(psi.abordados).toBe(0);
    // Ninguém abordado: a taxa não pode virar 0%.
    expect(psi.taxaResposta).toBeNull();
  });

  it('lead sem planilha etiquetada aparece como "Sem nicho"', async () => {
    // Ele não pode sumir da conta: o total deixaria de bater com a
    // realidade justamente nos leads mais antigos.
    await criarLead();

    const corpo = (await chamar('GET', '/api/dashboard/nichos')).json();

    expect(corpo.nichos.map((n: { nicho: string }) => n.nicho)).toContain(
      'Sem nicho'
    );
    expect(corpo.total.leads).toBe(1);
  });
});
