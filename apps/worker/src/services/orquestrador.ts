/**
 * O orquestrador da cadencia.
 *
 * ============================================================
 * A HIERARQUIA, QUE VALE PARA TUDO O QUE ACONTECE AQUI
 * ============================================================
 *   BANCO      = estado oficial
 *   BACKEND    = executor
 *   WHATSAPP   = transporte
 *   ACK        = confirmacao do transporte
 *   GEMINI     = cerebro de decisao
 *
 * O modelo nunca sobe nessa lista. Ele opina sobre um retrato que o
 * banco produziu, e a opiniao dele passa por uma guarda deterministica
 * antes de virar acao. Nenhuma mensagem e marcada como enviada porque a
 * IA decidiu envia-la.
 *
 * ============================================================
 * POR EVENTO, NAO POR TICK
 * ============================================================
 * O despachante roda a cada 15 segundos. Chamar a IA ali seria ~19.000
 * chamadas por hora com 80 leads, quase todas para responder "ainda nao
 * deu a hora" — uma pergunta de aritmetica.
 *
 * Entao a IA e consultada quando algo ACONTECE: o lead respondeu, uma
 * etapa saiu, um ACK terminal chegou, voce liberou uma intervencao, um
 * envio falhou. Entre eventos, quem conta o tempo e o `scheduledAt` no
 * banco e o poller — como sempre foi.
 *
 * ============================================================
 * TRES MODOS, E O DO MEIO E O PADRAO
 * ============================================================
 *   IA desligada  -> nada muda. O sistema e o de antes da Fase 9.
 *   SOMBRA        -> a IA opina, o motor manda. A divergencia e gravada.
 *   ATIVA         -> a decisao da IA e executada, se a guarda deixar.
 *
 * Sombra e o padrao porque ligar a IA no comando sem dados e um ato de
 * fe. Com a tabela `ai_decisions` cheia, vira uma decisao com numeros.
 */
import { prisma, Prisma } from '@prospector/database';
import {
  ACOES_QUE_ENVIAM,
  respostaPermiteAvancar,
  validarDecisao,
  proximaEtapaEsperada,
  etapaDaOrdem,
  type AcaoIA,
  type ContextoCadencia,
  type DecisaoIA,
  type GatilhoCadencia,
} from '@prospector/domain';
import type { AnalisadorDeCadencia } from '@prospector/integrations';
import type { Logger } from 'pino';
import { montarContexto } from './contexto-cadencia.js';
import {
  criarIntervencao,
  encerrarCadencia,
  pausarCadencia,
  registrarEspera,
  registrarProximaAcao,
  solicitarEnvioDeEtapa,
  avisarOperador,
  type ResultadoAcao,
} from './acoes-cadencia.js';

export type ModoIA = 'DESLIGADA' | 'SOMBRA' | 'ATIVA';

export interface OpcoesOrquestrador {
  /** null = IA desligada. */
  analisador: AnalisadorDeCadencia | null;
  /** true = a IA so observa; quem manda e o motor. */
  somenteAnalise: boolean;
  log: Logger;
  /**
   * NAO EXECUTAR NADA — so analisar, comparar e gravar.
   *
   * ============================================================
   * POR QUE ISTO PRECISA EXISTIR
   * ============================================================
   * No gatilho MENSAGEM_RECEBIDA, `processarMensagemRecebida` JA rodou o
   * motor de regras e JA aplicou os efeitos: avancou a etapa, criou a
   * intervencao, registrou o opt-out. Se o orquestrador executasse
   * tambem, o mesmo evento produziria a acao duas vezes — no melhor
   * caso um enfileiramento que colide na UNIQUE, no pior um segundo
   * efeito colateral.
   *
   * Entao naquele caminho ele entra so para observar: compara o que a IA
   * teria feito com o que o motor fez, grava a divergencia em
   * `ai_decisions` e escreve a proxima acao na tela. Nada mais.
   *
   * Dar o comando do caminho de resposta a IA e o passo seguinte, e ele
   * depende de olhar os dados do modo sombra primeiro — nao de uma flag.
   */
  observarApenas?: boolean;
}

export interface ResultadoOrquestracao {
  modo: ModoIA;
  /** O que a IA pediu, quando ela respondeu. */
  decisaoIa: DecisaoIA | null;
  /** O que o motor deterministico decidiu com o mesmo retrato. */
  acaoMotor: AcaoIA;
  /** O que o sistema fez de fato. */
  acaoExecutada: AcaoIA | null;
  divergiu: boolean;
  fallback: boolean;
  resultado: ResultadoAcao | null;
  detalhe: string;
}

// -----------------------------------------------------------------------------
// O MOTOR DETERMINISTICO DA CADENCIA
// -----------------------------------------------------------------------------

/**
 * O que o sistema faria sem IA nenhuma.
 *
 * ============================================================
 * ESTA FUNCAO E O CHAO DO SISTEMA
 * ============================================================
 * Ela e o fallback quando o Gemini falha, e e o comando em modo sombra.
 * Se ela estiver errada, ligar ou desligar a IA nao salva nada.
 *
 * Por isso e pura e sem I/O: recebe o retrato, devolve a acao. Da para
 * testar cada ramo sem banco e sem rede.
 *
 * A ordem dos ramos e a ordem das prioridades — o que protege vem antes
 * do que avanca.
 */
export function decidirSemIA(ctx: ContextoCadencia): { acao: AcaoIA; motivo: string } {
  if (ctx.lead.optOut) {
    return { acao: 'STOP_CAMPAIGN', motivo: 'Lead em opt-out.' };
  }
  if (ctx.campanha.status !== 'ATIVA') {
    return { acao: 'WAIT', motivo: `Campanha esta ${ctx.campanha.status}.` };
  }
  if (ctx.posicao.aguardandoLiberacao) {
    return { acao: 'WAIT', motivo: 'Esperando liberacao manual.' };
  }

  const proxima = proximaEtapaEsperada(ctx);
  if (proxima === null) {
    return { acao: 'WAIT', motivo: 'Todas as etapas ja tem envio.' };
  }

  const etapa = etapaDaOrdem(ctx, proxima);
  if (etapa && !etapa.enviarAutomaticamente) {
    return {
      acao: 'CREATE_INTERVENTION',
      motivo: `A etapa ${proxima} exige liberacao manual.`,
    };
  }

  // A etapa ANTERIOR e quem manda esperar: se ela congela ate o lead
  // falar e ele nao falou, a sequencia nao anda. Isto e o
  // `aguardarResposta` da configuracao, e nao uma escolha do modelo.
  const anterior = etapaDaOrdem(ctx, proxima - 1);
  if (anterior?.aguardarResposta && ctx.respostas.length === 0) {
    return {
      acao: 'WAIT',
      motivo: `A etapa ${anterior.ordem} espera resposta e o lead ainda nao respondeu.`,
    };
  }

  // O delay configurado. Aritmetica, feita aqui e nao pelo modelo.
  const espera = etapa?.delaySegundos ?? 0;
  const passou = ctx.relogio.segundosDesdeUltimoEnvio;
  if (passou !== null && espera > 0 && passou < espera) {
    return {
      acao: 'WAIT',
      motivo: `Faltam ${espera - passou}s para a etapa ${proxima}.`,
    };
  }

  return { acao: 'SEND_STEP', motivo: `A etapa ${proxima} ainda nao foi enviada.` };
}

// -----------------------------------------------------------------------------
// EXECUCAO
// -----------------------------------------------------------------------------

async function executar(
  ctx: ContextoCadencia,
  acao: AcaoIA,
  etapaAlvo: number | null,
  motivo: string,
  esperarSegundos: number | null,
  observarApenas = false
): Promise<ResultadoAcao> {
  // A porta unica. Toda execucao passa por aqui, entao basta esta
  // verificacao para garantir que o modo observador nao toque em nada.
  if (observarApenas) {
    return {
      acao,
      efetivada: false,
      detalhe: `Observando: teria feito ${acao} — ${motivo}`,
    };
  }

  const base = { leadId: ctx.lead.id, campaignId: ctx.campanha.id };

  switch (acao) {
    case 'SEND_STEP':
    case 'ADVANCE_STEP':
    case 'RETRY_SEND':
    case 'RESUME': {
      const ordem = etapaAlvo ?? proximaEtapaEsperada(ctx);
      if (ordem === null) {
        return { acao, efetivada: false, detalhe: 'Nao ha etapa para enviar.' };
      }
      return solicitarEnvioDeEtapa({ ...base, ordem });
    }

    case 'PAUSE':
      return pausarCadencia({ ...base, motivo });

    case 'CREATE_INTERVENTION': {
      const ordem = etapaAlvo ?? ctx.posicao.etapaAtualOrdem ?? 0;
      return criarIntervencao({
        ...base,
        titulo: `${ctx.lead.empresa ?? ctx.lead.nome ?? 'Lead'} precisa de voce`,
        motivo,
        // A etapa identifica o acontecimento. Sem isso, cada evento
        // repetiria o mesmo aviso no sino.
        referencia: `intervencao-cadencia:${ctx.campanha.id}:${ordem}`,
      });
    }

    case 'NOTIFY_OPERATOR':
      return avisarOperador({
        leadId: ctx.lead.id,
        titulo: `${ctx.lead.empresa ?? ctx.lead.nome ?? 'Lead'}: ${motivo}`,
        mensagem: motivo,
        referencia: `aviso-cadencia:${ctx.campanha.id}:${ctx.posicao.etapaAtualOrdem ?? 0}`,
      });

    case 'STOP_CAMPAIGN':
      return encerrarCadencia({
        ...base,
        motivo,
        // Opt-out e o unico encerramento irreversivel. Os outros so
        // param a sequencia; este fecha a porta.
        optOut: ctx.lead.optOut || motivo.toLowerCase().includes('opt-out'),
      });

    case 'WAIT':
    default:
      return registrarEspera({ ...base, motivo, esperarSegundos });
  }
}

// -----------------------------------------------------------------------------
// A TRILHA
// -----------------------------------------------------------------------------

/**
 * O que a IA estava vendo, em forma compacta.
 *
 * ============================================================
 * RESUMO, E NAO O PROMPT INTEIRO
 * ============================================================
 * O texto da conversa ja vive em `messages`. Copia-lo para
 * `ai_decisions` encheria o banco com o mesmo conteudo e espalharia
 * dados do lead por mais uma tabela — e a pergunta que a trilha precisa
 * responder nao e "o que o lead escreveu", e sim "qual era o ESTADO
 * quando ela decidiu".
 *
 * Estes campos sao os que mudam a decisao. Se algum parecer errado
 * depois, o problema esta no contexto, nao no modelo.
 */
function resumirContexto(ctx: ContextoCadencia): Record<string, unknown> {
  return {
    campanhaStatus: ctx.campanha.status,
    dentroDaJanela: ctx.campanha.dentroDaJanela,
    etapaAtual: ctx.posicao.etapaAtualOrdem,
    statusNaCampanha: ctx.posicao.statusNaCampanha,
    aguardandoLiberacao: ctx.posicao.aguardandoLiberacao,
    proximaEsperada: proximaEtapaEsperada(ctx),
    leadOptOut: ctx.lead.optOut,
    // Por etapa: o que o banco dizia. E daqui que sai a resposta para
    // "por que ela achou que a etapa 2 podia sair?".
    envios: ctx.envios.map((e) => ({
      ordem: e.ordem,
      outbound: e.statusOutbound,
      mensagem: e.statusMensagem,
    })),
    totalRespostas: ctx.respostas.length,
    // A ultima resposta e a que mais pesa na decisao. As anteriores estao
    // em `messages`, com carimbo de tempo.
    ultimaResposta: ctx.respostas.at(-1)?.texto?.slice(0, 200) ?? null,
    categoriaDoMotor: ctx.respostas.at(-1)?.categoriaDoMotor ?? null,
    tarefasAbertas: ctx.tarefasPendentes.length,
    segundosDesdeUltimoEnvio: ctx.relogio.segundosDesdeUltimoEnvio,
  };
}

async function gravarDecisao(dados: {
  ctx: ContextoCadencia;
  decisaoIa: DecisaoIA | null;
  acaoMotor: AcaoIA;
  acaoExecutada: AcaoIA | null;
  motivoRejeicao: string | null;
  divergiu: boolean;
  fallback: boolean;
  erro: string | null;
  modelo: string | null;
  latenciaMs: number | null;
}): Promise<void> {
  try {
    await prisma.aiDecision.create({
      data: {
        leadId: dados.ctx.lead.id,
        campaignId: dados.ctx.campanha.id,
        etapaOrdem: dados.decisaoIa?.etapaOrdem ?? null,
        gatilho: dados.ctx.gatilho,
        acaoIa: dados.decisaoIa?.acao ?? null,
        intentIa: dados.decisaoIa?.intent ?? null,
        confianca: dados.decisaoIa?.confianca ?? null,
        motivo: dados.decisaoIa?.motivo ?? null,
        acaoMotor: dados.acaoMotor,
        divergiu: dados.divergiu,
        acaoExecutada: dados.acaoExecutada,
        motivoRejeicao: dados.motivoRejeicao,
        fallback: dados.fallback,
        erro: dados.erro,
        modelo: dados.modelo,
        latenciaMs: dados.latenciaMs,
        contextoResumo: resumirContexto(dados.ctx) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // A trilha e observabilidade, nao caminho critico. Falhar ao gravar
    // o registro nao pode derrubar a cadencia que ele descreve.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError)) throw err;
  }
}

/**
 * A leitura da IA, gravada NA PROPRIA MENSAGEM.
 *
 * ============================================================
 * POR QUE `ai_decisions` NAO BASTAVA
 * ============================================================
 * As colunas `messages.ai_intent`, `ai_confidence`, `ai_motivo` e
 * `ai_divergiu` existiam no schema desde a Fase 9, com comentarios
 * explicando que serviam para comparar modelo e dicionario — e nada
 * escrevia nelas.
 *
 * O efeito era invisivel e caro: a IA podia entender "boa noite sim"
 * como aceite e avancar a etapa, e toda tela continuava mostrando aquele
 * lead pela leitura de quem nao entendeu. A opiniao do modelo existia
 * so em `ai_decisions`, que nenhuma tela consulta.
 *
 * `ai_decisions` continua igual: ela e a trilha de DECISAO ("o que o
 * sistema fez, e por que"). Isto aqui e a LEITURA ("o que esta mensagem
 * queria dizer"), e ela pertence a mensagem.
 *
 * ============================================================
 * SO NO GATILHO EM QUE ISSO SIGNIFICA ALGUMA COISA
 * ============================================================
 * `MENSAGEM_RECEBIDA` e o unico gatilho em que a analise e SOBRE uma
 * resposta. Num ACK ou numa falha de envio, a IA opina sobre o estado da
 * cadencia — e carimbar essa opiniao na ultima resposta do lead diria
 * que ele falou algo que ele nao falou.
 *
 * ============================================================
 * ELA NAO DECIDE NADA
 * ============================================================
 * Quatro campos de leitura, ao lado da mensagem. Nao toca em
 * `categoria` (que e do dicionario e continua sendo a palavra final do
 * motor), nem em status, nem em etapa, nem em fila.
 */
async function gravarLeituraNaMensagem(dados: {
  ctx: ContextoCadencia;
  decisaoIa: DecisaoIA | null;
  divergiu: boolean;
  modelo: string | null;
  latenciaMs: number | null;
  status: 'OK' | 'FALHOU';
}): Promise<void> {
  if (dados.ctx.gatilho !== 'MENSAGEM_RECEBIDA') return;
  if (!dados.decisaoIa) return;

  try {
    // A ultima resposta do lead e a que provocou esta analise. O
    // contexto nao carrega ids de mensagem de proposito — o prompt nao
    // precisa deles — entao a busca acontece aqui.
    const alvo = await prisma.message.findFirst({
      where: { leadId: dados.ctx.lead.id, direcao: 'RECEBIDA' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!alvo) return;

    await prisma.message.update({
      where: { id: alvo.id },
      data: {
        aiIntent: dados.decisaoIa.intent,
        aiConfidence: dados.decisaoIa.confianca,
        aiMotivo: dados.decisaoIa.motivo,
        aiDivergiu: dados.divergiu,
        aiModelo: dados.modelo,
        aiLatenciaMs: dados.latenciaMs,
        aiStatus: dados.status,
      },
    });
  } catch (err) {
    // Mesma regra da trilha: observabilidade nao derruba cadencia.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError)) throw err;
  }
}

// -----------------------------------------------------------------------------
// O CICLO
// -----------------------------------------------------------------------------

/**
 * Um evento entra, uma acao sai.
 *
 * NUNCA lanca por causa da IA. Se o Gemini falhar de qualquer maneira —
 * timeout, JSON invalido, chave errada, API fora do ar — o motor
 * deterministico assume e a cadencia continua. Uma campanha nao pode
 * parar porque um modelo remoto ficou indisponivel.
 */
export async function orquestrarCadencia(
  params: {
    leadId: string;
    campaignId: string;
    gatilho: GatilhoCadencia;
    agora?: Date;
  },
  opcoes: OpcoesOrquestrador
): Promise<ResultadoOrquestracao | null> {
  const observarApenas = opcoes.observarApenas ?? false;
  const { contexto: ctx, motivo } = await montarContexto(params);

  if (!ctx) {
    opcoes.log.debug({ ...params, motivo }, 'Sem contexto para orquestrar');
    return null;
  }

  // O chao: o que aconteceria sem IA nenhuma.
  const motor = decidirSemIA(ctx);

  const modo: ModoIA = !opcoes.analisador
    ? 'DESLIGADA'
    : opcoes.somenteAnalise
      ? 'SOMBRA'
      : 'ATIVA';

  // --- IA desligada: o caminho de antes da Fase 9, intacto ---
  if (modo === 'DESLIGADA') {
    const resultado = await executar(ctx, motor.acao, null, motor.motivo, null, observarApenas);
    await registrarProximaAcao({
      leadId: ctx.lead.id,
      campaignId: ctx.campanha.id,
      acao: motor.acao,
      motivo: motor.motivo,
      estadoIa: 'DESLIGADA',
    });
    return {
      modo,
      decisaoIa: null,
      acaoMotor: motor.acao,
      acaoExecutada: motor.acao,
      divergiu: false,
      fallback: false,
      resultado,
      detalhe: resultado.detalhe,
    };
  }

  const analise = await opcoes.analisador!.analisar(ctx);

  // --- A IA falhou: fallback deterministico ---
  if (!analise.ok) {
    // ============================================================
    // O FALLBACK CONSULTA AS SUAS REGRAS
    // ============================================================
    // Antes, qualquer acao que ENVIASSE virava intervencao quando a IA
    // falhava. Era seguro e caro: cada timeout do Gemini congelava um
    // lead que o motor deterministico saberia conduzir sozinho — e um
    // timeout de 30s virou rotina.
    //
    // O motor nao e chute. Ele classifica contra um dicionario de
    // centenas de termos, com confianca, e as regras de cada etapa
    // (POSITIVO -> AVANCAR, PRECO -> AGUARDAR_INTERVENCAO) sao as que
    // VOCE configurou na tela. Ignorar tudo isso e jogar fora a resposta
    // que o sistema tem para dar.
    //
    // Agora ele pergunta o que a sua regra manda fazer. Ver
    // `respostaPermiteAvancar`, que carrega os tres casos em que a
    // resposta NAO libera a proxima mensagem: opt-out e negativo, baixa
    // confianca, e categoria sem regra configurada.
    const ultimaResposta = ctx.respostas[ctx.respostas.length - 1];
    const veredicto = respostaPermiteAvancar(ultimaResposta, ctx.regras);

    const arriscada = ACOES_QUE_ENVIAM.includes(motor.acao) && !veredicto.permite;
    const acaoSegura: AcaoIA = arriscada ? veredicto.acao : motor.acao;
    const motivoSeguro = arriscada
      ? `A IA nao respondeu (${analise.erro}). ${veredicto.motivo}`
      : motor.motivo;

    opcoes.log.warn(
      {
        evento: 'AI_ANALYSIS_FAILED',
        leadId: ctx.lead.id,
        campaignId: ctx.campanha.id,
        gatilho: ctx.gatilho,
        modelo: analise.modelo,
        latenciaMs: analise.latenciaMs,
        erro: analise.erro,
      },
      'A IA nao respondeu; seguindo com o motor deterministico'
    );

    const resultado = await executar(ctx, acaoSegura, null, motivoSeguro, null, observarApenas);
    await registrarProximaAcao({
      leadId: ctx.lead.id,
      campaignId: ctx.campanha.id,
      acao: acaoSegura,
      motivo: motivoSeguro,
      estadoIa: 'FALHOU',
    });
    await gravarDecisao({
      ctx,
      decisaoIa: null,
      acaoMotor: motor.acao,
      acaoExecutada: acaoSegura,
      // Nao e a guarda recusando uma decisao da IA — e o sistema
      // escolhendo nao arriscar sem ela. Fica registrado para a auditoria
      // conseguir separar as duas coisas.
      motivoRejeicao: arriscada ? 'FALLBACK_NAO_ENVIA' : null,
      divergiu: arriscada,
      fallback: true,
      erro: analise.erro,
      modelo: analise.modelo,
      latenciaMs: analise.latenciaMs,
    });

    return {
      modo,
      decisaoIa: null,
      acaoMotor: motor.acao,
      acaoExecutada: acaoSegura,
      divergiu: arriscada,
      fallback: true,
      resultado,
      detalhe: motivoSeguro,
    };
  }

  // --- A guarda ---
  const veredito = validarDecisao(ctx, analise.decisao);
  const divergiu = veredito.acaoFinal !== motor.acao;

  opcoes.log.info(
    {
      evento: 'AI_DECISION',
      leadId: ctx.lead.id,
      campaignId: ctx.campanha.id,
      gatilho: ctx.gatilho,
      acaoIa: analise.decisao.acao,
      acaoFinal: veredito.acaoFinal,
      acaoMotor: motor.acao,
      etapa: veredito.etapaFinal,
      confianca: analise.decisao.confianca,
      permitida: veredito.permitida,
      motivoRejeicao: veredito.motivoRejeicao,
      divergiu,
      modelo: analise.modelo,
      latenciaMs: analise.latenciaMs,
      // A justificativa entra; o texto da conversa nao. O log nao e
      // lugar de guardar o que o cliente escreveu.
      motivo: analise.decisao.motivo,
    },
    'Decisao da IA'
  );

  // ============================================================
  // MODO SOMBRA: A IA OPINA, O MOTOR MANDA
  // ============================================================
  // Note que a acao executada aqui e a do MOTOR, sempre — inclusive
  // quando a guarda aprovou a da IA. E isso que faz "sombra" significar
  // sombra: nada do que o modelo decide chega ao lead.
  if (modo === 'SOMBRA') {
    const resultado = await executar(ctx, motor.acao, null, motor.motivo, null, observarApenas);

    await registrarProximaAcao({
      leadId: ctx.lead.id,
      campaignId: ctx.campanha.id,
      acao: motor.acao,
      motivo: motor.motivo,
      estadoIa: 'SOMBRA',
    });
    await gravarDecisao({
      ctx,
      decisaoIa: analise.decisao,
      acaoMotor: motor.acao,
      acaoExecutada: motor.acao,
      motivoRejeicao: veredito.motivoRejeicao,
      divergiu,
      fallback: false,
      erro: null,
      modelo: analise.modelo,
      latenciaMs: analise.latenciaMs,
    });
    // Em sombra a IA nao manda, mas a LEITURA dela vale igual — e e
    // exatamente aqui que ela mais serve: `ai_divergiu` responde se
    // ligar a IA de verdade valeria a pena.
    await gravarLeituraNaMensagem({
      ctx,
      decisaoIa: analise.decisao,
      divergiu,
      modelo: analise.modelo,
      latenciaMs: analise.latenciaMs,
      status: 'OK',
    });

    return {
      modo,
      decisaoIa: analise.decisao,
      acaoMotor: motor.acao,
      acaoExecutada: motor.acao,
      divergiu,
      fallback: false,
      resultado,
      detalhe: divergiu
        ? `Sombra: a IA teria feito ${veredito.acaoFinal}, o motor fez ${motor.acao}.`
        : `Sombra: IA e motor concordaram em ${motor.acao}.`,
    };
  }

  // --- ATIVA: a decisao da IA vale, filtrada pela guarda ---
  const resultado = await executar(
    ctx,
    veredito.acaoFinal,
    veredito.etapaFinal,
    veredito.explicacao,
    analise.decisao.esperarSegundos,
    observarApenas
  );

  await registrarProximaAcao({
    leadId: ctx.lead.id,
    campaignId: ctx.campanha.id,
    acao: veredito.acaoFinal,
    motivo: veredito.explicacao,
    estadoIa: 'ATIVA',
  });
  await gravarDecisao({
    ctx,
    decisaoIa: analise.decisao,
    acaoMotor: motor.acao,
    acaoExecutada: veredito.acaoFinal,
    motivoRejeicao: veredito.motivoRejeicao,
    divergiu,
    fallback: false,
    erro: null,
    modelo: analise.modelo,
    latenciaMs: analise.latenciaMs,
  });
  await gravarLeituraNaMensagem({
    ctx,
    decisaoIa: analise.decisao,
    divergiu,
    modelo: analise.modelo,
    latenciaMs: analise.latenciaMs,
    status: 'OK',
  });

  return {
    modo,
    decisaoIa: analise.decisao,
    acaoMotor: motor.acao,
    acaoExecutada: veredito.acaoFinal,
    divergiu,
    fallback: false,
    resultado,
    detalhe: resultado.detalhe,
  };
}
