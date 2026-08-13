/**
 * Pipeline de recebimento — o que acontece quando um lead responde.
 *
 * ```
 * mensagem do canal
 *      ↓  idempotencia por provider_message_id
 *      ↓  normalizacao do telefone (E.164)
 *      ↓  identificacao do lead   (dominio, nao adivinha)
 *      ↓  gravacao em messages
 *      ↓  motor de regras          (deterministico, sem IA)
 *      ↓  decisao + efeitos
 *      ↓  CRM atualizado + SSE
 * ```
 *
 * ============================================================
 * NADA AQUI ENVIA MENSAGEM
 * ============================================================
 * Quando a decisao manda RESPONDER ou AVANCAR, este servico apenas
 * ENFILEIRA. O envio depende do worker, que passa pela guarda de fase —
 * e nesta fase ela esta travada.
 */
import { prisma, Prisma } from '@prospector/database';
import {
  normalizarTelefone,
  identificarLead,
  classificarResposta,
  decidirAcao,
  PRECEDENCIA_PADRAO,
  type LeadCandidato,
  type TermoRegra,
  type RegraCategoria,
  type TemplateDisponivel,
  type EfeitoDecisao,
  avaliarAck,
  estadoDeStatus,
  type ResultadoClassificacao,
} from '@prospector/domain';
import type { MensagemEntrada } from '@prospector/integrations';
import { PRIORIDADE_NOTIFICACAO } from '@prospector/shared';
import { publicarEvento } from '../events.js';

/**
 * Cria uma notificacao a partir do worker.
 *
 * A API tem uma funcao equivalente, mas ela usa o barramento em memoria
 * do proprio processo. O worker roda separado: o caminho ate a tela e o
 * pub/sub do Redis. Compartilhar o codigo exigiria um pacote so para
 * isso, e sao oito linhas.
 */
async function criarNotificacao(dados: {
  tipo: string;
  titulo: string;
  mensagem: string;
  nivel?: 'INFO' | 'SUCESSO' | 'ALERTA' | 'ERRO';
  leadId?: string | null;
}): Promise<void> {
  await prisma.notification.create({
    data: {
      tipo: dados.tipo as never,
      titulo: dados.titulo,
      mensagem: dados.mensagem,
      nivel: (dados.nivel ?? 'INFO') as never,
      prioridade: PRIORIDADE_NOTIFICACAO[dados.tipo] ?? 50,
      leadId: dados.leadId ?? null,
    },
  });
  await publicarEvento('notificacao.criada', { titulo: dados.titulo });
}

export interface ResultadoInbound {
  /** false quando a mensagem ja tinha sido processada. */
  processada: boolean;
  motivo?: string;
  messageId?: string;
  leadId?: string | null;
  categoria?: string;
  confianca?: number;
  acao?: string;
  /** Preenchido quando ninguem reconheceu o remetente. */
  contatoDesconhecidoId?: string;
}

/** Carrega o dicionario e a precedencia configurados no banco. */
async function carregarConfiguracaoDoMotor(campaignStepId: string | null): Promise<{
  termos: TermoRegra[];
  precedencia: typeof PRECEDENCIA_PADRAO;
}> {
  const [keywords, setting] = await Promise.all([
    prisma.responseKeyword.findMany({ where: { ativo: true } }),
    prisma.setting.findUnique({ where: { chave: 'regras.precedencia' } }),
  ]);

  const termos: TermoRegra[] = keywords.map((k) => ({
    id: k.id,
    categoria: k.categoria,
    termo: k.termo,
    matchTipo: k.matchTipo,
    peso: k.peso,
    ativo: k.ativo,
    subtipo: k.subtipo,
    campaignStepId: k.campaignStepId,
  }));

  const precedencia = Array.isArray(setting?.valor)
    ? (setting.valor as typeof PRECEDENCIA_PADRAO)
    : PRECEDENCIA_PADRAO;

  void campaignStepId;
  return { termos, precedencia };
}

/**
 * Registra a mensagem de quem nao e lead.
 *
 * Nao criamos um lead automaticamente: isso encheria o CRM de numeros
 * que voce nunca prospectou. E nao descartamos: se alguem responde de um
 * segundo numero, ou se o telefone do lead esta cadastrado errado, a
 * mensagem sumiria sem deixar rastro.
 */
async function registrarDesconhecido(
  entrada: MensagemEntrada,
  motivo: string,
  candidatos: string[] | null
): Promise<string | null> {
  try {
    const criado = await prisma.unknownContact.create({
      data: {
        telefone: entrada.telefone,
        nomeContato: entrada.nomeContato,
        chatId: entrada.chatId,
        texto: entrada.texto,
        providerMessageId: entrada.providerMessageId,
        motivo,
        recebidaEm: entrada.recebidaEm,
        ...(candidatos ? { leadsCandidatos: candidatos as Prisma.InputJsonValue } : {}),
      },
    });
    return criado.id;
  } catch (err) {
    // P2002 = o mesmo evento chegou duas vezes. Nao e erro.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return null;
    }
    throw err;
  }
}

/** Aplica os efeitos que a decisao produziu. Nenhum deles envia mensagem. */
async function aplicarEfeitos(
  leadId: string,
  efeitos: EfeitoDecisao[],
  contexto: { campaignId: string | null; campaignStepId: string | null }
): Promise<void> {
  for (const efeito of efeitos) {
    switch (efeito.tipo) {
      case 'ALTERAR_STATUS':
        await prisma.lead.update({
          where: { id: leadId },
          data: { status: efeito.para as never, proximaAcao: efeito.motivo },
        });
        void publicarEvento('lead.status_alterado', { leadId, status: efeito.para });
        break;

      case 'ALTERAR_TEMPERATURA':
        await prisma.lead.update({
          where: { id: leadId },
          data: { temperatura: efeito.para as never },
        });
        void publicarEvento('lead.temperatura_alterada', {
          leadId,
          temperatura: efeito.para,
        });
        break;

      case 'REGISTRAR_OPT_OUT':
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            optOut: true,
            optOutEm: new Date(),
            status: 'OPT_OUT',
            proximaAcao: null,
          },
        });
        // Opt-out sem cancelar a fila seria promessa quebrada: a pessoa
        // pediu para parar e receberia a próxima etapa mesmo assim.
        await prisma.outboundMessage.updateMany({
          where: { leadId, status: { in: ['PENDENTE', 'AGENDADA'] } },
          data: { status: 'CANCELADA', erro: 'Lead pediu opt-out' },
        });
        void publicarEvento('lead.status_alterado', { leadId, status: 'OPT_OUT' });
        break;

      case 'CANCELAR_JOBS_PENDENTES':
        await prisma.outboundMessage.updateMany({
          where: { leadId, status: { in: ['PENDENTE', 'AGENDADA'] } },
          data: { status: 'CANCELADA', erro: efeito.motivo },
        });
        break;

      case 'CRIAR_TAREFA':
        await prisma.task.create({
          data: {
            leadId,
            tipo: efeito.tipo_tarefa as never,
            titulo: efeito.titulo,
            prioridade: 'ALTA',
          },
        });
        void publicarEvento('tarefa.criada', { leadId });
        break;

      case 'CRIAR_INTERVENCAO':
        await criarNotificacao({
          tipo: 'INTERVENCAO_NECESSARIA',
          titulo: efeito.titulo,
          mensagem: efeito.mensagem,
          nivel: 'ALERTA',
          leadId,
        });
        break;

      case 'REGISTRAR_EVENTO':
        await prisma.leadEvent.create({
          data: {
            leadId,
            tipo: efeito.eventoTipo as never,
            descricao: efeito.descricao,
            origem: 'motor',
            ...(efeito.dados
              ? { dados: efeito.dados as Prisma.InputJsonValue }
              : {}),
          },
        });
        break;

      case 'AGENDAR_SNOOZE':
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            status: 'AGENDADO',
            proximaAcaoEm: efeito.retomarEm,
            proximaAcao: `Retomar em ${efeito.horas}h`,
          },
        });
        await prisma.outboundMessage.updateMany({
          where: { leadId, status: { in: ['PENDENTE', 'AGENDADA'] } },
          data: { scheduledAt: efeito.retomarEm },
        });
        break;

      case 'PARAR_SEQUENCIA':
        await prisma.outboundMessage.updateMany({
          where: { leadId, status: { in: ['PENDENTE', 'AGENDADA'] } },
          data: { status: 'CANCELADA', erro: efeito.motivo },
        });
        break;

      case 'ENVIAR_TEMPLATE':
      case 'AVANCAR_ETAPA':
      case 'AGUARDAR_RESPOSTA':
        // Estes efeitos SAO de envio. Nesta fase eles não enfileiram
        // nada: o objetivo é provar o recebimento e a classificação.
        // Enfileirar aqui criaria mensagens de saída que existiriam só
        // para serem bloqueadas depois — ruído sem informação.
        await prisma.leadEvent.create({
          data: {
            leadId,
            tipo: 'RESPOSTA_CLASSIFICADA',
            descricao: `Ação "${efeito.tipo}" reconhecida mas não executada — envio desativado nesta fase`,
            origem: 'motor',
            dados: { efeito: efeito.tipo, ...contexto } as Prisma.InputJsonValue,
          },
        });
        break;
    }
  }
}

/**
 * Processa uma mensagem recebida, do inicio ao fim.
 *
 * IDEMPOTENTE por `provider_message_id`: o mesmo evento chegando duas
 * vezes nao cria duas mensagens nem reaplica os efeitos.
 */
export async function processarMensagemRecebida(
  entrada: MensagemEntrada
): Promise<ResultadoInbound> {
  // --- 1. Idempotência ---
  //
  // Consulta antes de tudo para evitar trabalho inútil; a garantia real
  // vem da constraint UNIQUE mais abaixo, não deste SELECT.
  const jaExiste = await prisma.message.findUnique({
    where: { whatsappMessageId: entrada.providerMessageId },
    select: { id: true, leadId: true },
  });
  if (jaExiste) {
    return {
      processada: false,
      motivo: 'Mensagem já processada',
      messageId: jaExiste.id,
      leadId: jaExiste.leadId,
    };
  }

  // --- 2. Telefone em E.164 ---
  const telefone = normalizarTelefone(entrada.telefone);

  // --- 3. Identificar o lead ---
  const candidatos = telefone.e164
    ? await prisma.lead.findMany({
        where: { telefoneNormalizado: telefone.e164 },
        select: {
          id: true,
          telefoneNormalizado: true,
          optOut: true,
          status: true,
          ultimaInteracaoEm: true,
          createdAt: true,
        },
      })
    : [];

  const identificacao = identificarLead(
    telefone.e164,
    candidatos as LeadCandidato[]
  );

  if (identificacao.tipo !== 'ENCONTRADO') {
    const candidatosIds =
      identificacao.tipo === 'AMBIGUO' ? identificacao.candidatos : null;

    const id = await registrarDesconhecido(
      entrada,
      identificacao.motivo,
      candidatosIds
    );

    // Ambiguidade pede olho humano: escolher errado grava a resposta de
    // uma pessoa no histórico de outra.
    if (identificacao.tipo === 'AMBIGUO') {
      await criarNotificacao({
        tipo: 'INTERVENCAO_NECESSARIA',
        titulo: 'Mensagem com remetente ambíguo',
        mensagem: `${identificacao.motivo}. O sistema não escolheu — decida no painel.`,
        nivel: 'ALERTA',
      });
    }

    void publicarEvento('dashboard.atualizar');
    return {
      processada: true,
      motivo: identificacao.motivo,
      leadId: null,
      ...(id ? { contatoDesconhecidoId: id } : {}),
    };
  }

  const leadId = identificacao.leadId;

  // --- 4. Contexto da campanha ---
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: {
      id: true,
      nomeCompleto: true,
      optOut: true,
      temperatura: true,
      campaignId: true,
      leadCampaigns: {
        // A campanha que ainda esta rodando. `CONCLUIDO` e `PARADO`
        // ficam de fora: a etapa deles nao descreve mais onde o lead
        // esta, e usa-la para escolher regras aplicaria a configuracao
        // de uma sequencia que ja terminou.
        where: { status: { notIn: ['CONCLUIDO', 'PARADO', 'OPT_OUT'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { campaignId: true, etapaAtualId: true },
      },
    },
  });

  const campaignId = lead.leadCampaigns[0]?.campaignId ?? lead.campaignId ?? null;
  const campaignStepId = lead.leadCampaigns[0]?.etapaAtualId ?? null;

  // --- 5. Classificar (motor determinístico, sem IA) ---
  const { termos, precedencia } = await carregarConfiguracaoDoMotor(campaignStepId);
  const classificacao: ResultadoClassificacao = classificarResposta(entrada.texto, {
    termos,
    precedencia,
    campaignStepId,
  });

  // --- 6. Gravar a mensagem ---
  const conversa = await prisma.conversation.upsert({
    where: { id: `${leadId}-${campaignId ?? 'sem-campanha'}` },
    update: {
      ultimaMensagemEm: entrada.recebidaEm,
      ultimaMensagemTexto: entrada.texto.slice(0, 200),
      naoLidas: { increment: 1 },
    },
    create: {
      id: `${leadId}-${campaignId ?? 'sem-campanha'}`,
      leadId,
      campaignId,
      chatId: entrada.chatId,
      ultimaMensagemEm: entrada.recebidaEm,
      ultimaMensagemTexto: entrada.texto.slice(0, 200),
      naoLidas: 1,
    },
  });

  let mensagem;
  try {
    mensagem = await prisma.message.create({
      data: {
        conversationId: conversa.id,
        leadId,
        campaignId,
        campaignStepId,
        direcao: 'RECEBIDA',
        status: 'ENTREGUE',
        texto: entrada.texto,
        // A constraint UNIQUE é a garantia real de idempotência: duas
        // entregas simultâneas do mesmo evento colidem aqui.
        whatsappMessageId: entrada.providerMessageId,
        recebidaEm: entrada.recebidaEm,
        categoria: classificacao.categoria,
        categoriasDetectadas: classificacao.categoriasDetectadas as Prisma.InputJsonValue,
        termosCasados: classificacao.termosCasados as unknown as Prisma.InputJsonValue,
        textoNormalizado: classificacao.textoNormalizado,
        subtipo: classificacao.subtipo,
        confianca: classificacao.confianca,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { processada: false, motivo: 'Mensagem já processada (corrida)', leadId };
    }
    throw err;
  }

  // --- 7. Decidir o que fazer ---
  const [regras, templates] = await Promise.all([
    // Sem etapa atual, nao ha regra especifica: o motor cai nos padroes.
    campaignStepId
      ? prisma.campaignStepRule.findMany({ where: { campaignStepId } })
      : Promise.resolve([]),
    prisma.responseTemplate.findMany({ where: { ativo: true } }),
  ]);

  const decisao = decidirAcao(classificacao, {
    leadId,
    nome: lead.nomeCompleto,
    optOut: lead.optOut,
    temperatura: lead.temperatura,
    temProximaEtapa: false,
  }, {
    regras: regras as unknown as RegraCategoria[],
    templates: templates.map((t) => ({
      templateId: t.templateId,
      categoria: t.categoria,
      subtipo: t.subtipo,
      campaignStepId: t.campaignStepId,
      ativo: t.ativo,
    })) as TemplateDisponivel[],
    campaignStepId,
  });

  // --- 8. Aplicar os efeitos ---
  await aplicarEfeitos(leadId, decisao.efeitos, { campaignId, campaignStepId });

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      ultimaInteracaoEm: entrada.recebidaEm,
      ultimaMensagemEm: entrada.recebidaEm,
      ultimaCategoria: classificacao.categoria,
    },
  });

  await prisma.leadEvent.create({
    data: {
      leadId,
      tipo: 'RESPOSTA_CLASSIFICADA',
      descricao: `Classificada como ${classificacao.categoria} (confiança ${classificacao.confianca}) — ${decisao.resumo}`,
      origem: 'motor',
      dados: {
        categoria: classificacao.categoria,
        confianca: classificacao.confianca,
        subtipo: classificacao.subtipo,
        acao: decisao.acao,
      } as Prisma.InputJsonValue,
    },
  });

  void publicarEvento('mensagem.recebida', {
    leadId,
    categoria: classificacao.categoria,
  });
  void publicarEvento('dashboard.atualizar');

  return {
    processada: true,
    messageId: mensagem.id,
    leadId,
    categoria: classificacao.categoria,
    confianca: classificacao.confianca,
    acao: decisao.acao,
  };
}

// -----------------------------------------------------------------------------
// CONFIRMACAO DE ENTREGA
// -----------------------------------------------------------------------------

/**
 * Aplica um `message_ack` vindo do provedor.
 *
 * ============================================================
 * ACKS CHEGAM FORA DE ORDEM E REPETIDOS
 * ============================================================
 * Nao e excecao — e o normal. `avaliarAck` decide se a transicao avanca;
 * um ack de "servidor recebeu" que chega depois do de "lida" e
 * descartado, senao a mensagem "desleria" e o historico passaria a
 * mentir.
 *
 * NESTA FASE isto quase nunca roda: sem envio real nao ha mensagem
 * nossa para o WhatsApp confirmar. Existe implementado e testado para
 * que ligar o envio nao exija escrever esta parte com pressa no dia da
 * ativacao.
 */
export async function processarConfirmacaoEntrega(dados: {
  providerMessageId: string;
  ack: number;
}): Promise<{ aplicado: boolean; motivo: string; estado?: string }> {
  const mensagem = await prisma.message.findUnique({
    where: { whatsappMessageId: dados.providerMessageId },
    select: { id: true, leadId: true, status: true, simulada: true },
  });

  if (!mensagem) {
    // Ack de mensagem que nao e nossa (ou que nunca foi gravada).
    // Silencioso de proposito: o WhatsApp confirma tudo que passa pela
    // conta, inclusive o que voce mandou do celular na mao.
    return { aplicado: false, motivo: 'Mensagem não encontrada' };
  }

  if (mensagem.simulada) {
    return { aplicado: false, motivo: 'Mensagem simulada não recebe confirmação real' };
  }

  const veredicto = avaliarAck(estadoDeStatus(mensagem.status), dados.ack);
  if (!veredicto.aplicar || !veredicto.statusMensagem) {
    return { aplicado: false, motivo: veredicto.motivo };
  }

  const agora = new Date();
  await prisma.message.update({
    where: { id: mensagem.id },
    data: {
      status: veredicto.statusMensagem,
      ...(veredicto.novoEstado === 'ENTREGUE' ? { entregueEm: agora } : {}),
      ...(veredicto.novoEstado === 'LIDA' ? { lidaEm: agora } : {}),
    },
  });

  await prisma.leadEvent.create({
    data: {
      leadId: mensagem.leadId,
      tipo: veredicto.novoEstado === 'FALHOU' ? 'MENSAGEM_FALHOU' : 'MENSAGEM_ENVIADA',
      descricao: `Confirmação de entrega: ${veredicto.motivo}`,
      origem: 'canal',
      dados: {
        providerMessageId: dados.providerMessageId,
        ack: dados.ack,
        estado: veredicto.novoEstado,
      } as Prisma.InputJsonValue,
    },
  });

  void publicarEvento('mensagem.enviada', {
    leadId: mensagem.leadId,
    estado: veredicto.novoEstado,
  });

  return {
    aplicado: true,
    motivo: veredicto.motivo,
    ...(veredicto.novoEstado ? { estado: veredicto.novoEstado } : {}),
  };
}
