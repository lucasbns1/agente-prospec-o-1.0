/**
 * Avanco de etapa a partir de uma resposta do lead.
 *
 * ============================================================
 * O BURACO QUE ISTO FECHA
 * ============================================================
 * O motor ja sabia decidir "esta resposta e positiva, avance". Mas o
 * efeito `AVANCAR_ETAPA` so escrevia uma linha no historico dizendo
 * "acao reconhecida mas nao executada". Na pratica: o lead respondia
 * "quero sim", o CRM registrava tudo direito, o quadro mudava de cor —
 * e a mensagem 2 nunca saia.
 *
 * Isso fazia sentido enquanto o envio real estava travado: enfileirar
 * mensagens que nasceriam so para serem bloqueadas seria ruido. Com a
 * trava aberta, o mesmo codigo virou um beco sem saida — a sequencia
 * so andava se voce reenfileirasse a campanha na mao.
 *
 * ============================================================
 * O QUE ESTE MODULO NAO FAZ
 * ============================================================
 * Nao envia. Cria uma linha em `outbound_messages` com `scheduledAt`, e
 * o despachante + o worker de outbound decidem o resto — passando pelas
 * quatro barreiras, como qualquer outra mensagem. Nao ha aqui nenhum
 * caminho que alcance o WhatsApp.
 *
 * ============================================================
 * TRES SAIDAS QUE NAO SAO ENVIO
 * ============================================================
 *  - acabaram as etapas  -> LeadCampaign CONCLUIDO;
 *  - a proxima etapa e manual (`enviarAutomaticamente: false`, o caso da
 *    MSG 3 que depende da sua previa) -> LeadCampaign PAUSADO, que no
 *    quadro e a coluna "Precisa de voce", mais uma notificacao;
 *  - a mensagem nao renderiza (falta variavel obrigatoria) -> a linha e
 *    criada BLOQUEADA com o motivo, visivel na fila.
 *
 * Nenhuma delas inventa texto nem manda mensagem "generica" para nao
 * deixar o lead sem resposta. Silencio explicado vale mais que uma
 * mensagem errada.
 */
import { prisma, Prisma } from '@prospector/database';
import {
  renderizarMensagem,
  calcularAgendamento,
  chaveIdempotencia,
  chaveIdempotenciaResposta,
  type ContextoLead,
} from '@prospector/domain';
import { publicarEvento } from '../events.js';
import { criarNotificacaoIdempotente, criarTarefaSeNaoExistir } from './notificar.js';

/** Campos do lead necessarios para renderizar a mensagem. */
const SELECAO_LEAD = {
  id: true, nomeCompleto: true, primeiroNome: true, nomeContato: true,
  empresa: true, telefoneNormalizado: true, cidade: true, bairro: true,
  estado: true, categoria: true, avaliacao: true, totalAvaliacoes: true,
  optOut: true, status: true,
} as const;

type LeadSelecionado = Prisma.LeadGetPayload<{ select: typeof SELECAO_LEAD }>;

/**
 * Mesmo mapeamento usado no enfileiramento da campanha.
 *
 * `nome_contato` sai SO de `nomeContato`. Um estabelecimento chamado
 * "Studio LK Lash Designer" nao vira "Oi, Studio!" — a regra vale aqui
 * tanto quanto no primeiro envio.
 */
function paraContexto(l: LeadSelecionado): ContextoLead {
  return {
    nome: l.nomeCompleto,
    primeiro_nome: l.primeiroNome,
    nome_contato: l.nomeContato,
    empresa: l.empresa ?? l.nomeCompleto,
    cidade: l.cidade,
    bairro: l.bairro,
    estado: l.estado,
    categoria: l.categoria,
    telefone: l.telefoneNormalizado,
    avaliacao: l.avaliacao,
    totalAvaliacoes: l.totalAvaliacoes,
    site_preview_url: null,
  };
}

export type MotivoNaoAvancou =
  | 'CAMPANHA_NAO_ENCONTRADA'
  | 'CAMPANHA_INATIVA'
  | 'LEAD_OPT_OUT'
  | 'SEM_PROXIMA_ETAPA'
  | 'ETAPA_MANUAL'
  | 'ETAPA_SEM_TEXTO'
  | 'SEM_ETAPA_ANCORA'
  | 'JA_ENFILEIRADA';

export interface ResultadoAvanco {
  enfileirou: boolean;
  motivo: MotivoNaoAvancou | 'ENFILEIRADA' | 'ENFILEIRADA_BLOQUEADA';
  proximaEtapaId?: string;
  outboundMessageId?: string;
  detalhe?: string;
}

/**
 * Existe alguma etapa ativa depois da atual?
 *
 * Consultada ANTES de decidir, porque o motor precisa saber disso para
 * escolher entre AVANCAR e PARAR. Sem esta resposta ele recebia sempre
 * `temProximaEtapa: false` e transformava todo avanco em fim de
 * sequencia — o lead respondia "quero" e era encerrado.
 */
export async function temProximaEtapa(
  campaignId: string | null,
  etapaAtualId: string | null
): Promise<boolean> {
  if (!campaignId) return false;
  const proxima = await localizarProximaEtapa(campaignId, etapaAtualId);
  return proxima !== null;
}

async function localizarProximaEtapa(
  campaignId: string,
  etapaAtualId: string | null
): Promise<{ id: string; ordem: number } | null> {
  // Sem etapa atual a "proxima" e a primeira: o lead respondeu antes de
  // qualquer envio nosso (aconteceu com quem ja tinha conversa aberta).
  let ordemAtual = 0;
  if (etapaAtualId) {
    const atual = await prisma.campaignStep.findUnique({
      where: { id: etapaAtualId },
      select: { ordem: true },
    });
    // Etapa apagada depois do envio: tratar como "nao sei onde ele
    // esta" e nao avancar seria mais seguro, mas prenderia o lead para
    // sempre. Recomeçar do zero reenviaria a mensagem 1. A chave de
    // idempotencia protege: se ele ja recebeu a etapa, a linha colide.
    ordemAtual = atual?.ordem ?? 0;
  }

  return prisma.campaignStep.findFirst({
    where: { campaignId, ativo: true, ordem: { gt: ordemAtual } },
    orderBy: { ordem: 'asc' },
    select: { id: true, ordem: true },
  });
}

// A funcao local `notificar` foi removida: ela era um `create()` seco e
// deixava o mesmo acontecimento virar dois avisos no sino. A versao
// idempotente vive em `notificar.ts` e e usada por todos os pontos que
// avisam alguma coisa. Ver o comentario de la para o porque de a dedupe
// ser por constraint e nao por consulta.

/**
 * Coloca a proxima etapa da campanha na fila para este lead.
 *
 * IDEMPOTENTE pela mesma chave usada no enfileiramento da campanha: se
 * a etapa ja foi enfileirada para este lead — por esta funcao ou pela
 * API — a segunda tentativa colide e nao cria nada.
 */
export async function enfileirarProximaEtapa(params: {
  leadId: string;
  campaignId: string;
  etapaAtualId: string | null;
  agora?: Date;
}): Promise<ResultadoAvanco> {
  const agora = params.agora ?? new Date();

  const campanha = await prisma.campaign.findUnique({
    where: { id: params.campaignId },
    select: {
      id: true, nome: true, status: true, dryRun: true,
      delayMinSegundos: true, delayMaxSegundos: true,
      horarioInicio: true, horarioFim: true, diasPermitidos: true,
      limiteDiarioEnvios: true, limiteHorarioEnvios: true,
    },
  });
  if (!campanha) {
    return { enfileirou: false, motivo: 'CAMPANHA_NAO_ENCONTRADA' };
  }

  // Campanha pausada nao volta a andar por causa de uma resposta. Se
  // andasse, pausar deixaria de significar alguma coisa.
  if (campanha.status !== 'ATIVA') {
    return {
      enfileirou: false,
      motivo: 'CAMPANHA_INATIVA',
      detalhe: `Campanha esta ${campanha.status}`,
    };
  }

  const lead = await prisma.lead.findUnique({
    where: { id: params.leadId },
    select: SELECAO_LEAD,
  });
  if (!lead || lead.optOut || lead.status === 'OPT_OUT') {
    return { enfileirou: false, motivo: 'LEAD_OPT_OUT' };
  }

  const proxima = await localizarProximaEtapa(campanha.id, params.etapaAtualId);

  // --- Fim da sequencia ---
  if (!proxima) {
    await prisma.leadCampaign.updateMany({
      where: { leadId: lead.id, campaignId: campanha.id },
      data: { status: 'CONCLUIDO', concluidoEm: agora },
    });
    return { enfileirou: false, motivo: 'SEM_PROXIMA_ETAPA' };
  }

  const etapa = await prisma.campaignStep.findUniqueOrThrow({
    where: { id: proxima.id },
    select: {
      id: true, ordem: true, nome: true, texto: true,
      enviarAutomaticamente: true, notificarAoChegar: true,
      notificacaoTexto: true,
      delayMinSegundos: true, delayMaxSegundos: true,
      template: { select: { texto: true } },
    },
  });

  // --- Etapa que voce quis manual (o caso da MSG 3 com previa) ---
  //
  // Nao enfileiramos nada: uma linha AGENDADA que ninguem pode despachar
  // ficaria parada na fila fingindo que vai sair. O lead vai para a
  // coluna "Precisa de voce" e voce recebe o aviso.
  if (!etapa.enviarAutomaticamente) {
    await prisma.leadCampaign.updateMany({
      where: { leadId: lead.id, campaignId: campanha.id },
      data: {
        status: 'PAUSADO',
        aguardandoLiberacao: true,
        motivoParada: `Etapa ${etapa.ordem} exige liberação manual`,
      },
    });
    await criarNotificacaoIdempotente({
      tipo: 'PEDIDO_PREVIEW',
      titulo: `${lead.empresa ?? lead.nomeCompleto} chegou na etapa ${etapa.ordem}`,
      mensagem:
        etapa.notificacaoTexto?.trim() ||
        `A resposta liberou a etapa ${etapa.ordem}, que está marcada para envio manual. ` +
          `Prepare a prévia e libere no quadro da campanha.`,
      nivel: 'ALERTA',
      leadId: lead.id,
      // A etapa e o que identifica o acontecimento. Sem ela, "chegou na
      // etapa 3" e "chegou na etapa 5" colidiriam e a segunda sumiria.
      referencia: `etapa-manual:${etapa.id}`,
    });

    // ============================================================
    // NOTIFICACAO E TAREFA SAO COISAS DIFERENTES
    // ============================================================
    // A notificacao avisa. Ela e lida e some — cumpriu o papel dela.
    //
    // A tarefa e o trabalho: "montar a previa deste lead". Ela precisa
    // sobreviver ao aviso ter sido lido, aparecer na lista de pendencias
    // e so sumir quando alguem fizer o que ela pede.
    //
    // So com a notificacao, um lead pronto para a etapa manual sumia da
    // vista no momento em que voce clicava no sino.
    //
    // `findFirst` antes de criar: o avanco pode ser tentado de novo (uma
    // segunda resposta do lead, uma varredura), e duas tarefas identicas
    // para o mesmo trabalho e ruido.
    await criarTarefaSeNaoExistir({
      leadId: lead.id,
      tipo: 'CRIAR_PREVIEW',
      prioridade: 'ALTA',
      titulo: `Preparar a prévia de ${lead.empresa ?? lead.nomeCompleto}`,
      descricao:
        `O lead chegou na etapa ${etapa.ordem}, que exige liberação manual. ` +
        `Prepare o material e libere o envio no quadro da campanha.`,
    });

    void publicarEvento('dashboard.atualizar');
    return {
      enfileirou: false,
      motivo: 'ETAPA_MANUAL',
      proximaEtapaId: etapa.id,
    };
  }

  const template = etapa.template?.texto ?? etapa.texto;
  if (!template || template.trim() === '') {
    return {
      enfileirou: false,
      motivo: 'ETAPA_SEM_TEXTO',
      proximaEtapaId: etapa.id,
    };
  }

  // --- Render ---
  const r = renderizarMensagem(template, paraContexto(lead));
  const motivoBloqueio = r.ok
    ? null
    : r.faltando.length > 0
      ? ('VARIAVEL_OBRIGATORIA_AUSENTE' as const)
      : ('MENSAGEM_VAZIA' as const);

  // --- Agendamento ---
  //
  // A partir de AGORA, com o delay da etapa (ou o da campanha). Isso da
  // o intervalo humano entre a resposta do lead e a nossa: responder no
  // mesmo segundo denuncia automacao.
  let scheduledAt: Date | null = null;
  const detalheBloqueio: string | null = r.ok ? null : r.motivoBloqueio;
  const motivoFinal = motivoBloqueio;

  if (!motivoBloqueio) {
    const ag = calcularAgendamento({
      agora,
      intervalo: {
        minSegundos: etapa.delayMinSegundos ?? campanha.delayMinSegundos,
        maxSegundos: etapa.delayMaxSegundos ?? campanha.delayMaxSegundos,
      },
      janela: {
        horarioInicio: campanha.horarioInicio,
        horarioFim: campanha.horarioFim,
        diasPermitidos: campanha.diasPermitidos,
      },
      limites: {
        limiteDiario: campanha.limiteDiarioEnvios,
        limiteHorario: campanha.limiteHorarioEnvios,
        // O despachante reconta na hora do envio; contar aqui seria
        // uma foto velha do consumo.
        enviadosHoje: 0,
        enviadosNaHora: 0,
      },
    });
    if ('bloqueado' in ag) {
      // Fora da janela nao bloqueia: o despachante adia de 15 em 15
      // minutos ate a janela abrir. Perder o lead porque ele respondeu
      // as 22h seria absurdo.
      scheduledAt = agora;
    } else {
      scheduledAt = ag.scheduledAt;
    }
  }

  const idempotencyKey = chaveIdempotencia(lead.id, campanha.id, etapa.id);

  try {
    const criada = await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: campanha.id,
        campaignStepId: etapa.id,
        idempotencyKey,
        status: motivoFinal ? 'BLOQUEADA' : 'AGENDADA',
        motivoBloqueio: motivoFinal,
        detalheBloqueio,
        telefoneDestino: lead.telefoneNormalizado,
        textoRenderizado: r.ok ? r.texto : null,
        textoTemplate: template,
        variaveisUsadas: (r.ok ? r.variaveisUsadas : {}) as Prisma.InputJsonValue,
        scheduledAt,
        // Herdado da campanha, como no primeiro envio. A resposta do
        // lead nao pode promover uma campanha em simulacao a envio real.
        dryRun: campanha.dryRun,
      },
      select: { id: true },
    });

    if (etapa.notificarAoChegar) {
      await criarNotificacaoIdempotente({
        tipo: 'PEDIDO_PREVIEW',
        titulo: `${lead.empresa ?? lead.nomeCompleto} chegou na etapa ${etapa.ordem}`,
        mensagem:
          etapa.notificacaoTexto?.trim() ||
          `A resposta avançou o lead para a etapa ${etapa.ordem}.`,
        nivel: 'INFO',
        leadId: lead.id,
        referencia: `chegou-etapa:${etapa.id}`,
      });
    }

    void publicarEvento('dashboard.atualizar');

    return {
      enfileirou: !motivoFinal,
      motivo: motivoFinal ? 'ENFILEIRADA_BLOQUEADA' : 'ENFILEIRADA',
      proximaEtapaId: etapa.id,
      outboundMessageId: criada.id,
      ...(detalheBloqueio ? { detalhe: detalheBloqueio } : {}),
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Ja existe mensagem desta etapa para este lead. Nao e erro: duas
      // respostas seguidas do mesmo lead chegam assim.
      return {
        enfileirou: false,
        motivo: 'JA_ENFILEIRADA',
        proximaEtapaId: etapa.id,
      };
    }
    throw err;
  }
}

/**
 * Enfileira uma RESPOSTA de template (efeito `ENVIAR_TEMPLATE`).
 *
 * Diferente do avanco de etapa: aqui o texto vem de `response_templates`
 * — o que voce configurou para "quando alguem perguntar preco, responda
 * isto" — e o lead NAO muda de etapa. Ele continua onde estava.
 *
 * A chave de idempotencia e a da mensagem recebida, nao a da etapa: usar
 * a da etapa faria a resposta colidir com o envio da propria etapa e
 * sumir sem deixar rastro.
 */
export async function enfileirarRespostaDeTemplate(params: {
  leadId: string;
  campaignId: string | null;
  campaignStepId: string | null;
  templateId: string;
  mensagemRecebidaId: string;
  agora?: Date;
}): Promise<ResultadoAvanco> {
  const agora = params.agora ?? new Date();

  const [lead, template] = await Promise.all([
    prisma.lead.findUnique({ where: { id: params.leadId }, select: SELECAO_LEAD }),
    // `templateId` aqui e o identificador estavel ("template_preco_01"),
    // nao o uuid: e ele que as regras guardam.
    prisma.responseTemplate.findUnique({
      where: { templateId: params.templateId },
      select: { texto: true, ativo: true },
    }),
  ]);

  if (!lead || lead.optOut || lead.status === 'OPT_OUT') {
    return { enfileirou: false, motivo: 'LEAD_OPT_OUT' };
  }
  if (!template || !template.ativo || template.texto.trim() === '') {
    return { enfileirou: false, motivo: 'ETAPA_SEM_TEXTO' };
  }

  // Sem campanha nao ha de onde tirar dryRun, janela nem limites — e
  // uma mensagem sem campanha nao passaria pela barreira #3. Melhor nao
  // criar e deixar o caso para a intervencao humana.
  if (!params.campaignId) {
    return { enfileirou: false, motivo: 'CAMPANHA_NAO_ENCONTRADA' };
  }

  // `outbound_messages.campaign_step_id` e obrigatorio: toda mensagem de
  // saida esta ancorada em uma etapa. Sem saber em que etapa o lead
  // esta, a alternativa seria chutar uma — e a etapa e o que decide
  // quais regras e quais templates valem daqui para frente. Chutar
  // errado desalinharia a sequencia inteira em silencio.
  if (!params.campaignStepId) {
    return { enfileirou: false, motivo: 'SEM_ETAPA_ANCORA' };
  }
  const campaignStepId = params.campaignStepId;

  const campanha = await prisma.campaign.findUnique({
    where: { id: params.campaignId },
    select: {
      status: true, dryRun: true,
      delayMinSegundos: true, delayMaxSegundos: true,
    },
  });
  if (!campanha) return { enfileirou: false, motivo: 'CAMPANHA_NAO_ENCONTRADA' };
  if (campanha.status !== 'ATIVA') {
    return { enfileirou: false, motivo: 'CAMPANHA_INATIVA' };
  }

  const r = renderizarMensagem(template.texto, paraContexto(lead));
  const motivoBloqueio = r.ok
    ? null
    : r.faltando.length > 0
      ? ('VARIAVEL_OBRIGATORIA_AUSENTE' as const)
      : ('MENSAGEM_VAZIA' as const);

  const espera =
    campanha.delayMinSegundos +
    Math.random() * Math.max(0, campanha.delayMaxSegundos - campanha.delayMinSegundos);

  try {
    const criada = await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        campaignId: params.campaignId,
        campaignStepId,
        idempotencyKey: chaveIdempotenciaResposta(lead.id, params.mensagemRecebidaId),
        status: motivoBloqueio ? 'BLOQUEADA' : 'AGENDADA',
        motivoBloqueio,
        detalheBloqueio: r.ok ? null : r.motivoBloqueio,
        telefoneDestino: lead.telefoneNormalizado,
        textoRenderizado: r.ok ? r.texto : null,
        textoTemplate: template.texto,
        variaveisUsadas: (r.ok ? r.variaveisUsadas : {}) as Prisma.InputJsonValue,
        scheduledAt: motivoBloqueio ? null : new Date(agora.getTime() + espera * 1000),
        dryRun: campanha.dryRun,
      },
      select: { id: true },
    });

    void publicarEvento('dashboard.atualizar');
    return {
      enfileirou: !motivoBloqueio,
      motivo: motivoBloqueio ? 'ENFILEIRADA_BLOQUEADA' : 'ENFILEIRADA',
      outboundMessageId: criada.id,
      ...(!r.ok && r.motivoBloqueio ? { detalhe: r.motivoBloqueio } : {}),
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { enfileirou: false, motivo: 'JA_ENFILEIRADA' };
    }
    throw err;
  }
}
