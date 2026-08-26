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
  acaoDoMotor,
  estadoDeStatus,
  type ResultadoClassificacao,
} from '@prospector/domain';
import type { MensagemEntrada } from '@prospector/integrations';
import { publicarEvento } from '../events.js';
import { criarNotificacaoIdempotente } from './notificar.js';
import { dispararGatilho, iaComanda } from './gatilhos-ia.js';
import {
  enfileirarProximaEtapa,
  enfileirarRespostaDeTemplate,
  temProximaEtapa,
} from './avancar-etapa.js';

/**
 * Cria uma notificacao a partir do worker.
 *
 * A API tem uma funcao equivalente, mas ela usa o barramento em memoria
 * do proprio processo. O worker roda separado: o caminho ate a tela e o
 * pub/sub do Redis. Compartilhar o codigo exigiria um pacote so para
 * isso, e sao oito linhas.
 */
/**
 * Delega para a versao idempotente.
 *
 * Antes isto era um `create()` seco, e o mesmo acontecimento — uma
 * segunda resposta do lead, um job reexecutado — virava dois avisos no
 * sino. Quem passa `referencia` ganha a protecao; quem nao passa (aviso
 * avulso, sem acontecimento que o identifique) mantem o comportamento
 * antigo, que ali e o correto.
 */
async function criarNotificacao(dados: {
  tipo: string;
  titulo: string;
  mensagem: string;
  nivel?: 'INFO' | 'SUCESSO' | 'ALERTA' | 'ERRO';
  leadId?: string | null;
  referencia?: string | null;
}): Promise<void> {
  await criarNotificacaoIdempotente(dados);
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

/**
 * Aplica os efeitos que a decisao produziu.
 *
 * NENHUM DELES ENVIA MENSAGEM. Os dois efeitos de envio (`AVANCAR_ETAPA`
 * e `ENVIAR_TEMPLATE`) apenas criam linhas em `outbound_messages` — quem
 * envia e o worker de outbound, depois das barreiras de envio.
 */
/**
 * Os efeitos que sobrevivem numa etapa que NAO espera resposta.
 *
 * ============================================================
 * POR QUE ESTA LISTA EXISTE
 * ============================================================
 * Uma etapa com `aguardarResposta: false` anda no relogio, e nao na
 * resposta. A abordagem e o caso classico: "Oi, prazer, me chamo
 * Lucas." — a mensagem 2 sai um minuto depois, tenha o lead respondido
 * o que for, ou nada.
 *
 * Mas ate agora a resposta continuava mandando na cadencia mesmo assim.
 * As regras da etapa rodavam igual, e uma delas e
 * `DUVIDA -> AGUARDAR_INTERVENCAO`. Efeito pratico: a saudacao
 * automatica do WhatsApp Business ("Ola! Recebemos sua mensagem...")
 * chegava, o dicionario nao reconhecia, e o lead era congelado com um
 * pedido de intervencao — antes de a conversa ter comecado.
 *
 * O relogio manda na cadencia; a resposta so registra.
 *
 * ============================================================
 * O QUE NAO ENTRA NESTA REGRA, NUNCA
 * ============================================================
 * Parar. Se a pessoa pediu para nao receber mais, ou disse que nao
 * quer, isso vale na etapa 1 como vale em qualquer outra — e vale
 * ainda que a etapa esteja configurada para ignorar respostas.
 *
 * "Ignorar a resposta" significa nao AVANCAR por causa dela e nao
 * INCOMODAR voce por causa dela. Nunca significa continuar mandando
 * para quem disse para parar: isso e o que queima um numero de
 * WhatsApp, alem de ser errado.
 */
const EFEITOS_QUE_SOBREVIVEM_SEM_ESPERA = new Set([
  // Parar, nas suas tres formas.
  'REGISTRAR_OPT_OUT',
  'CANCELAR_JOBS_PENDENTES',
  'PARAR_SEQUENCIA',
  // Registrar. Nao muda o rumo de nada.
  'ALTERAR_TEMPERATURA',
  'REGISTRAR_EVENTO',
]);

/**
 * Peneira os efeitos quando a etapa atual nao espera resposta.
 *
 * Fica de fora tudo que AVANCA (`AVANCAR_ETAPA`, `ENVIAR_TEMPLATE`),
 * tudo que CHAMA VOCE (`CRIAR_INTERVENCAO`, `CRIAR_TAREFA`) e tudo que
 * ADIA (`AGENDAR_SNOOZE`, `AGUARDAR_RESPOSTA`). `ALTERAR_STATUS`
 * tambem sai: sem a intervencao junto, um lead marcado
 * "AGUARDANDO_INTERVENCAO" ficaria esperando um aviso que nunca foi
 * criado.
 */
export function peneirarEfeitosSemEspera(efeitos: EfeitoDecisao[]): EfeitoDecisao[] {
  return efeitos.filter((e) => EFEITOS_QUE_SOBREVIVEM_SEM_ESPERA.has(e.tipo));
}

async function aplicarEfeitos(
  leadId: string,
  efeitos: EfeitoDecisao[],
  contexto: {
    campaignId: string | null;
    campaignStepId: string | null;
    mensagemRecebidaId: string;
    /**
     * true = a IA esta conduzindo a cadencia neste evento.
     *
     * ============================================================
     * O QUE ESTE SINALIZADOR PROTEGE
     * ============================================================
     * Quando a IA comanda, ela ja executou (ou vai executar) a decisao
     * de cadencia. Aplicar tambem os efeitos AVANCAR_ETAPA e
     * ENVIAR_TEMPLATE do motor faria os dois agirem sobre o mesmo
     * evento.
     *
     * Mensagem dobrada nao sairia — a UNIQUE do banco barra o segundo
     * enfileiramento. Mas os efeitos colaterais aconteceriam duas
     * vezes, e a trilha passaria a mentir sobre quem decidiu.
     *
     * SO estes dois sao pulados. Tudo o mais continua valendo:
     * opt-out, status, temperatura, snooze, parada de sequencia,
     * intervencao, tarefa e historico. O motor nunca deixa de ser a
     * barreira determinista — ele deixa de ser o CONDUTOR.
     */
    iaConduz?: boolean;
  }
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
          // A mensagem que provocou a intervencao e o que a identifica.
          referencia: `intervencao:${contexto.mensagemRecebidaId}`,
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

      // -------------------------------------------------------------
      // OS DOIS EFEITOS QUE COLOCAM MENSAGEM NA FILA
      //
      // Durante as fases de dry-run eles só escreviam no histórico
      // "ação reconhecida mas não executada". Isso fazia sentido
      // enquanto nada podia sair: enfileirar mensagens que nasceriam
      // só para serem bloqueadas seria ruído.
      //
      // Com o envio liberado, o mesmo código virou um beco: o lead
      // respondia "quero sim", o CRM registrava tudo — e a mensagem 2
      // nunca saía. A sequência só andava se você reenfileirasse a
      // campanha na mão.
      //
      // Continuam SEM ENVIAR: criam a linha agendada e param. As
      // barreiras de envio seguem entre isto e o WhatsApp.
      // -------------------------------------------------------------
      case 'AVANCAR_ETAPA': {
        if (contexto.iaConduz) break;
        if (!contexto.campaignId) break;
        const r = await enfileirarProximaEtapa({
          leadId,
          campaignId: contexto.campaignId,
          etapaAtualId: contexto.campaignStepId,
        });
        await prisma.leadEvent.create({
          data: {
            leadId,
            tipo: r.enfileirou ? 'ETAPA_AVANCADA' : 'RESPOSTA_CLASSIFICADA',
            descricao: r.enfileirou
              ? `Próxima etapa agendada a partir da resposta`
              : `Avanço não gerou envio: ${r.motivo}${r.detalhe ? ` — ${r.detalhe}` : ''}`,
            origem: 'motor',
            dados: { efeito: efeito.tipo, ...r, ...contexto } as Prisma.InputJsonValue,
          },
        });
        break;
      }

      case 'ENVIAR_TEMPLATE': {
        if (contexto.iaConduz) break;
        const r = await enfileirarRespostaDeTemplate({
          leadId,
          campaignId: contexto.campaignId,
          campaignStepId: contexto.campaignStepId,
          templateId: efeito.templateId,
          mensagemRecebidaId: contexto.mensagemRecebidaId,
        });

        // Regra de ouro: entre responder errado e não responder, não
        // responder vence — mas em silêncio, não. Se o template existia
        // na decisão e não virou mensagem, você precisa saber.
        if (!r.enfileirou && r.motivo !== 'JA_ENFILEIRADA') {
          await criarNotificacao({
            tipo: 'INTERVENCAO_NECESSARIA',
            titulo: 'Resposta automática não pôde ser enviada',
            mensagem:
              `O motor escolheu o template "${efeito.templateId}", mas a mensagem ` +
              `não foi criada (${r.motivo}). Responda manualmente.`,
            nivel: 'ALERTA',
            leadId,
            referencia: `template-falhou:${contexto.mensagemRecebidaId}`,
          });
        }

        await prisma.leadEvent.create({
          data: {
            leadId,
            tipo: 'RESPOSTA_CLASSIFICADA',
            descricao: r.enfileirou
              ? `Resposta automática agendada (template ${efeito.templateId})`
              : `Template ${efeito.templateId} não gerou envio: ${r.motivo}`,
            origem: 'motor',
            dados: { efeito: efeito.tipo, ...r, ...contexto } as Prisma.InputJsonValue,
          },
        });
        break;
      }

      case 'AGUARDAR_RESPOSTA':
        // Este não envia nada por definição: a sequência congela até o
        // lead falar. Só registramos para o histórico não ter buraco.
        await prisma.leadEvent.create({
          data: {
            leadId,
            tipo: 'RESPOSTA_CLASSIFICADA',
            descricao: 'Sequência aguardando a próxima resposta do lead',
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
/**
 * Uma mensagem que VOCE mandou do celular, na mao.
 *
 * ============================================================
 * ELA NAO E UMA RESPOSTA DO LEAD
 * ============================================================
 * Ate agora o sistema descartava tudo que saia do numero conectado. O
 * efeito era o pior tipo de cegueira: a conversa na tela mostrava so o
 * lado do lead, a IA decidia sem saber o que voce ja tinha dito, e a
 * cadencia podia disparar a proxima etapa por cima de uma negociacao em
 * andamento.
 *
 * Agora ela e gravada como ENVIADA. NAO passa pelo motor de
 * classificacao — classificar a propria fala como se fosse do lead
 * encheria o funil de "positivos" que sao voce mesmo.
 *
 * ============================================================
 * E ELA PAUSA A AUTOMACAO DAQUELE LEAD
 * ============================================================
 * Se voce entrou na conversa, o robo sai. Continuar a sequencia por cima
 * seria mandar a mensagem 3 enquanto voce negocia preco — o jeito mais
 * rapido de parecer um robo e perder a venda.
 *
 * Nao e irreversivel: e a mesma pausa que o botao "retomar automacao"
 * desfaz.
 */
async function registrarMensagemManual(p: {
  entrada: MensagemEntrada;
  leadId: string;
  campaignId: string | null;
}): Promise<ResultadoInbound> {
  const { entrada, leadId, campaignId } = p;

  const conversa = await prisma.conversation.upsert({
    where: { id: `${leadId}-${campaignId ?? 'sem-campanha'}` },
    update: {
      ultimaMensagemEm: entrada.recebidaEm,
      ultimaMensagemTexto: entrada.texto.slice(0, 200),
      // `naoLidas` NAO sobe: a mensagem e sua, voce ja a leu.
    },
    create: {
      id: `${leadId}-${campaignId ?? 'sem-campanha'}`,
      leadId,
      campaignId,
      chatId: entrada.chatId,
      ultimaMensagemEm: entrada.recebidaEm,
      ultimaMensagemTexto: entrada.texto.slice(0, 200),
      naoLidas: 0,
    },
  });

  try {
    await prisma.message.create({
      data: {
        conversationId: conversa.id,
        leadId,
        campaignId,
        // Sem etapa: nao veio de uma sequencia, veio de voce.
        direcao: 'ENVIADA',
        status: 'ENVIADA',
        texto: entrada.texto,
        // A UNIQUE aqui faz DOIS trabalhos: barra o mesmo evento
        // entregue duas vezes, e descarta o eco dos envios do proprio
        // sistema — eles ja gravaram esta chave no worker de outbound.
        whatsappMessageId: entrada.providerMessageId,
        enviadaEm: entrada.recebidaEm,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return {
        processada: false,
        motivo: 'Mensagem já registrada (envio do próprio sistema, ou evento repetido)',
        leadId,
      };
    }
    throw err;
  }

  if (campaignId) {
    await prisma.leadCampaign.updateMany({
      where: {
        leadId,
        campaignId,
        // So pausa o que estava andando. Um lead ja concluido ou em
        // opt-out nao volta a "pausado" porque voce mandou um "obrigado".
        status: { notIn: ['CONCLUIDO', 'PARADO', 'OPT_OUT'] },
      },
      data: {
        status: 'PAUSADO',
        aguardandoLiberacao: true,
        motivoParada: 'Você assumiu a conversa pelo WhatsApp',
      },
    });
  }

  await prisma.leadEvent.create({
    data: {
      leadId,
      tipo: 'MENSAGEM_ENVIADA',
      descricao: 'Você respondeu manualmente pelo WhatsApp — automação pausada',
      origem: 'whatsapp-manual',
    },
  });

  void publicarEvento('mensagem.enviada', { leadId, campaignId });

  return { processada: true, leadId, motivo: 'Mensagem manual registrada' };
}

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

  // --- 4b. Foi VOCE quem mandou? ---
  //
  // Daqui para baixo tudo trata a mensagem como fala do LEAD: classifica,
  // aplica regras, dispara a IA. Nada disso vale para o que saiu do seu
  // proprio numero.
  if (entrada.deMim) {
    return registrarMensagemManual({ entrada, leadId, campaignId });
  }

  // A etapa em que o lead esta manda na cadencia?
  //
  // `aguardarResposta: false` significa "esta etapa anda pelo relogio".
  // A resposta que chegar aqui e registrada e classificada — ela entra
  // no historico, na conversa e no contexto da IA — mas nao avanca a
  // sequencia nem chama voce. Ver `peneirarEfeitosSemEspera`.
  const etapaAtual = campaignStepId
    ? await prisma.campaignStep.findUnique({
        where: { id: campaignStepId },
        select: { aguardarResposta: true, ordem: true },
      })
    : null;
  const etapaConduzidaPeloRelogio = etapaAtual?.aguardarResposta === false;

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
    // Já foi fixo em `false`, herdado das fases sem envio. O efeito
    // colateral não era "não envia": era o motor transformar TODO
    // avanço em fim de sequência. O lead respondia "quero" e a regra
    // AVANCAR o encerrava, porque `temProximaEtapa: false` faz
    // `decidirAcao` emitir PARAR_SEQUENCIA. O CRM registrava
    // "sequência chegou ao fim" na etapa 1.
    temProximaEtapa: await temProximaEtapa(campaignId, campaignStepId),
  }, {
    // A tradução importa: o banco fala `StepAction` e o motor fala
    // `AcaoMotor`. Ver `acaoDoMotor` para o porquê.
    regras: regras.map((r) => ({
      ...r,
      acao: acaoDoMotor(r.acao),
    })) as unknown as RegraCategoria[],
    templates: templates.map((t) => ({
      templateId: t.templateId,
      categoria: t.categoria,
      subtipo: t.subtipo,
      campaignStepId: t.campaignStepId,
      ativo: t.ativo,
    })) as TemplateDisponivel[],
    campaignStepId,
  });

  // ============================================================
  // 8. QUEM CONDUZ ESTE EVENTO?
  // ============================================================
  // A IA roda ANTES dos efeitos, e nao depois, porque o resultado dela
  // decide se o motor conduz a cadencia ou apenas registra.
  //
  // A ordem importa para uma coisa em especial: o opt-out. Se o motor
  // classificou OPT_OUT, os efeitos dele — registrar, cancelar jobs,
  // marcar o lead — acontecem de qualquer forma logo abaixo, qualquer
  // que seja a opiniao da IA. A IA pode DETECTAR um opt-out que o
  // dicionario nao pegou; ela nunca pode desfazer um que ele pegou.
  // Numa etapa que anda pelo relogio, a IA tambem so observa: deixa-la
  // conduzir seria trocar um condutor por outro, e o pedido e que a
  // resposta a esta etapa nao conduza nada.
  const conduzida = iaComanda() && campaignId !== null && !etapaConduzidaPeloRelogio;

  if (conduzida) {
    await dispararGatilho({
      leadId,
      campaignId,
      gatilho: 'MENSAGEM_RECEBIDA',
      // Executa de verdade: enfileira a etapa, cria a intervencao,
      // encerra por opt-out. Nao e mais observacao.
      observarApenas: false,
    });
  }

  // --- 9. Aplicar os efeitos do motor ---
  //
  // Sempre roda. Quando a IA conduz, os dois efeitos de cadencia
  // (AVANCAR_ETAPA e ENVIAR_TEMPLATE) sao pulados — ver `iaConduz`.
  const efeitos = etapaConduzidaPeloRelogio
    ? peneirarEfeitosSemEspera(decisao.efeitos)
    : decisao.efeitos;

  // Este arquivo nao tem logger — ele devolve o que aconteceu a quem
  // chamou. O registro fica no historico do lead, que e onde voce
  // procura depois: sem isto, uma resposta ignorada some sem deixar
  // rastro e vira "o sistema nao fez nada e nao disse por que".
  if (etapaConduzidaPeloRelogio && efeitos.length < decisao.efeitos.length) {
    const ignorados = decisao.efeitos
      .filter((e) => !efeitos.includes(e))
      .map((e) => e.tipo);

    await prisma.leadEvent.create({
      data: {
        leadId,
        tipo: 'RESPOSTA_CLASSIFICADA',
        descricao:
          `Etapa ${etapaAtual?.ordem ?? '?'} anda pelo relógio: resposta registrada ` +
          `como ${classificacao.categoria}, mas não conduz a cadência ` +
          `(ignorado: ${ignorados.join(', ')})`,
        origem: 'worker',
      },
    });
  }

  await aplicarEfeitos(leadId, efeitos, {
    campaignId,
    campaignStepId,
    mensagemRecebidaId: mensagem.id,
    iaConduz: conduzida,
  });

  // Com a IA desligada ou em modo sombra, ela entra aqui so para
  // observar e gravar a comparacao. `dispararGatilho` nao faz nada
  // quando nao ha analisador configurado.
  //
  // Numa etapa que anda pelo relogio ela nao entra nem para observar:
  // nao ha decisao de cadencia a tomar, e cada observacao e uma chamada
  // paga ao Gemini. Uma campanha grande gera uma saudacao automatica
  // por lead — seriam centenas de chamadas para gravar "nao ha o que
  // decidir".
  if (!conduzida && !etapaConduzidaPeloRelogio) {
    await dispararGatilho({
      leadId,
      campaignId,
      gatilho: 'MENSAGEM_RECEBIDA',
      observarApenas: true,
    });
  }

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
    select: { id: true, leadId: true, status: true, simulada: true, campaignId: true },
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

  // ============================================================
  // GATILHO DA IA — SO NO ACK TERMINAL
  // ============================================================
  // ENTREGUE e LIDA sao os dois estados que significam "chegou". Sao
  // eles que autorizam a cadencia a pensar na proxima etapa: antes
  // disso, o que existe e uma mensagem que saiu daqui, nao uma que
  // chegou la.
  //
  // ENVIADA fica DE FORA de proposito. Ela chega segundos depois do
  // envio, e a decisao de "o que vem agora" ja foi tomada no gatilho
  // ETAPA_CONCLUIDA. Disparar aqui tambem dobraria as chamadas ao
  // modelo para responder exatamente a mesma coisa.
  //
  // FALHOU tem gatilho proprio: la a pergunta e outra — reenviar,
  // pausar ou chamar voce.
  if (veredicto.novoEstado === 'ENTREGUE' || veredicto.novoEstado === 'LIDA') {
    await dispararGatilho({
      leadId: mensagem.leadId,
      campaignId: mensagem.campaignId,
      gatilho: 'ACK_FINAL',
    });
  } else if (veredicto.novoEstado === 'FALHOU') {
    await dispararGatilho({
      leadId: mensagem.leadId,
      campaignId: mensagem.campaignId,
      gatilho: 'ENVIO_FALHOU',
    });
  }

  return {
    aplicado: true,
    motivo: veredicto.motivo,
    ...(veredicto.novoEstado ? { estado: veredicto.novoEstado } : {}),
  };
}
