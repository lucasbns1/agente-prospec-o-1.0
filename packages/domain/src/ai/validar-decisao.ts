/**
 * A GUARDA. Nenhuma decisao do modelo chega ao banco sem passar por
 * aqui.
 *
 * ============================================================
 * POR QUE UMA GUARDA, E NAO UM PROMPT MELHOR
 * ============================================================
 * Da para pedir no prompt: "nunca envie para um lead em opt-out". O
 * modelo vai obedecer quase sempre. "Quase sempre" e o problema — a
 * primeira vez que ele nao obedecer, uma pessoa que pediu para parar de
 * receber mensagem recebe outra, e isso nao volta atras.
 *
 * Entao a regra nao vive no prompt. Vive aqui, em codigo, testada, sem
 * modelo nenhum envolvido. O prompt continua pedindo — porque um modelo
 * bem instruido erra menos —, mas quem GARANTE e esta funcao.
 *
 * FUNCAO PURA. Entra contexto + decisao, sai veredito. Sem I/O, sem
 * data.now(), sem aleatoriedade: o mesmo par de entradas sempre produz o
 * mesmo veredito, e por isso da para testar cada invariante isolada.
 */
import type { AcaoIA, DecisaoIA } from './decisao-ia.js';
import {
  envioDaEtapa,
  etapaDaOrdem,
  proximaEtapaEsperada,
  type ContextoCadencia,
} from './contexto.js';

export type MotivoRejeicao =
  | 'LEAD_EM_OPT_OUT'
  | 'CAMPANHA_NAO_ATIVA'
  | 'AGUARDANDO_LIBERACAO'
  | 'ETAPA_NAO_INFORMADA'
  | 'ETAPA_INEXISTENTE'
  | 'ETAPA_JA_ENVIADA'
  | 'PULO_DE_ETAPA'
  | 'ETAPA_MANUAL'
  | 'SEQUENCIA_TERMINOU'
  | 'RETRY_SEM_FALHA'
  | 'PRECISA_HUMANO';

export interface ResultadoValidacao {
  /** true = executa a acao que o modelo pediu, como ele pediu. */
  permitida: boolean;
  /**
   * O que o sistema VAI fazer. Quando `permitida` e false, esta e a
   * acao segura que substitui a pedida — nunca um envio.
   */
  acaoFinal: AcaoIA;
  /** A etapa alvo ja conferida contra o banco. */
  etapaFinal: number | null;
  motivoRejeicao: MotivoRejeicao | null;
  /** Texto para o log e para a tela. O operador le isto. */
  explicacao: string;
}

/**
 * As acoes que resultam em mensagem saindo para o lead.
 *
 * Exportada porque o orquestrador precisa da MESMA lista para decidir se
 * o fallback pode agir. Duas listas separadas divergiriam, e a divergencia
 * apareceria como uma mensagem saindo quando nao devia.
 */
export const ACOES_QUE_ENVIAM: readonly AcaoIA[] = [
  'SEND_STEP',
  'ADVANCE_STEP',
  'RETRY_SEND',
  'RESUME',
];

/**
 * As acoes que JA sao um chamado para voce.
 *
 * `precisaHumano` nao precisa substituir nenhuma delas — trocar uma
 * intervencao por outra intervencao so apagaria o motivo original.
 * STOP_CAMPAIGN entra porque encerrar e mais decisivo do que avisar.
 */
const JA_CHAMAM_VOCE: readonly AcaoIA[] = [
  'CREATE_INTERVENTION',
  'NOTIFY_OPERATOR',
  'STOP_CAMPAIGN',
];

/** Status de envio que contam como "ja foi, nao mexa". */
const JA_SAIU = ['ENVIADA', 'SIMULADA', 'PROCESSANDO'];
/** Status de envio que contam como "ja esta na fila, nao duplique". */
const JA_NA_FILA = ['PENDENTE', 'AGENDADA'];

function negar(
  motivo: MotivoRejeicao,
  acaoFinal: AcaoIA,
  explicacao: string
): ResultadoValidacao {
  return {
    permitida: false,
    acaoFinal,
    etapaFinal: null,
    motivoRejeicao: motivo,
    explicacao,
  };
}

/**
 * Confere a decisao do modelo contra o estado real.
 *
 * A ordem das verificacoes importa: as barreiras absolutas vem primeiro,
 * para que nenhuma logica posterior possa contorna-las.
 */
export function validarDecisao(
  ctx: ContextoCadencia,
  decisao: DecisaoIA
): ResultadoValidacao {
  // ============================================================
  // BARREIRA 1 — OPT-OUT
  // ============================================================
  // Vem antes de tudo, e vale nos dois sentidos:
  //
  //   - lead JA em opt-out: nenhuma acao de envio passa, qualquer que
  //     seja o que o modelo tenha decidido. Nem RESUME, nem RETRY.
  //   - modelo DETECTOU opt-out agora: vira STOP_CAMPAIGN na hora, sem
  //     depender de a acao pedida estar coerente.
  //
  // O caminho inverso nao existe: nao ha combinacao de intent, confianca
  // ou acao que reative um lead em opt-out. Isso e feito por voce, na
  // mao, e de proposito.
  if (ctx.lead.optOut) {
    if (ACOES_QUE_ENVIAM.includes(decisao.acao)) {
      return negar(
        'LEAD_EM_OPT_OUT',
        'STOP_CAMPAIGN',
        'O lead esta em opt-out. Nenhuma mensagem sai, independente da decisao da IA.'
      );
    }
    return {
      permitida: true,
      acaoFinal: decisao.acao,
      etapaFinal: null,
      motivoRejeicao: null,
      explicacao: 'Lead em opt-out; acao nao envolve envio.',
    };
  }

  if (decisao.optOut || decisao.intent === 'OPT_OUT') {
    return {
      permitida: true,
      acaoFinal: 'STOP_CAMPAIGN',
      etapaFinal: null,
      motivoRejeicao: null,
      explicacao: `Opt-out detectado: ${decisao.motivo}`,
    };
  }

  // ============================================================
  // BARREIRA 1B — "ISTO E COM VOCE" TEM QUE CHEGAR ATE VOCE
  // ============================================================
  // `precisaHumano` (o `needs_human` do modelo) era lido, validado pelo
  // Zod, gravado na trilha... e nunca consultado por ninguem. O modelo
  // dizia "nao sei resolver isto, chama a pessoa", devolvia WAIT junto,
  // e o sistema esperava. Em silencio.
  //
  // Relato de uso, exatamente este: "quando a ferramenta nao ta mandando
  // ... nao esta me avisando que precisa de mim".
  //
  // Agora `precisaHumano` VIRA a acao. Ele nao aconselha: ele manda.
  //
  // POR QUE ISTO BLOQUEIA ATE UM ENVIO
  // O modelo pedindo SEND_STEP com `needs_human` ligado esta se
  // contradizendo. Entre mandar a proxima mensagem da sequencia e
  // chamar voce, chamar voce e o unico dos dois que da para desfazer.
  //
  // O QUE PASSA POR CIMA DISTO
  // Opt-out, ja tratado acima, e as duas acoes que JA sao um chamado
  // (CREATE_INTERVENTION, NOTIFY_OPERATOR). STOP_CAMPAIGN tambem passa:
  // encerrar e mais decisivo do que avisar, e o lead para de qualquer
  // forma.
  if (
    decisao.precisaHumano &&
    !JA_CHAMAM_VOCE.includes(decisao.acao)
  ) {
    return {
      permitida: false,
      acaoFinal: 'CREATE_INTERVENTION',
      etapaFinal: null,
      motivoRejeicao: 'PRECISA_HUMANO',
      explicacao: `A IA pediu voce nesta conversa: ${decisao.motivo}`,
    };
  }

  // ============================================================
  // Acoes que nao enviam nada passam direto.
  // ============================================================
  // WAIT, PAUSE, CREATE_INTERVENTION, NOTIFY_OPERATOR e STOP_CAMPAIGN so
  // deixam o sistema mais silencioso. Nao ha o que proteger.
  if (!ACOES_QUE_ENVIAM.includes(decisao.acao)) {
    return {
      permitida: true,
      acaoFinal: decisao.acao,
      etapaFinal: null,
      motivoRejeicao: null,
      explicacao: decisao.motivo,
    };
  }

  // ============================================================
  // BARREIRA 2 — a campanha precisa estar ATIVA
  // ============================================================
  if (ctx.campanha.status !== 'ATIVA') {
    return negar(
      'CAMPANHA_NAO_ATIVA',
      'WAIT',
      `A campanha esta ${ctx.campanha.status}. Nada e enfileirado enquanto ela nao estiver ATIVA.`
    );
  }

  // ============================================================
  // BARREIRA 3 — liberacao manual pendente
  // ============================================================
  // O lead parou numa etapa que espera voce. Se a IA pudesse retomar
  // sozinha, a etapa manual deixaria de ser manual.
  if (ctx.posicao.aguardandoLiberacao) {
    return negar(
      'AGUARDANDO_LIBERACAO',
      'WAIT',
      'A sequencia esta esperando liberacao manual. So voce destrava.'
    );
  }

  // ============================================================
  // BARREIRA 4 — a etapa precisa existir e ser a proxima
  // ============================================================
  if (decisao.etapaOrdem === null) {
    return negar(
      'ETAPA_NAO_INFORMADA',
      'WAIT',
      `A IA pediu ${decisao.acao} sem dizer qual etapa.`
    );
  }

  const etapa = etapaDaOrdem(ctx, decisao.etapaOrdem);
  if (!etapa) {
    return negar(
      'ETAPA_INEXISTENTE',
      'WAIT',
      `A IA pediu a etapa ${decisao.etapaOrdem}, que nao existe nesta campanha ` +
        `(a sequencia tem ${ctx.sequencia.length}).`
    );
  }

  const envio = envioDaEtapa(ctx, decisao.etapaOrdem);

  // Ja saiu ou ja esta na fila: nao duplica. A UNIQUE do banco tambem
  // barraria, mas barrar aqui evita a decisao errada se repetir a cada
  // evento pelo resto da campanha.
  if (envio && JA_SAIU.includes(envio.statusOutbound)) {
    return negar(
      'ETAPA_JA_ENVIADA',
      'WAIT',
      `A etapa ${decisao.etapaOrdem} ja esta ${envio.statusOutbound}. Nao sera enviada de novo.`
    );
  }
  if (envio && JA_NA_FILA.includes(envio.statusOutbound)) {
    return negar(
      'ETAPA_JA_ENVIADA',
      'WAIT',
      `A etapa ${decisao.etapaOrdem} ja esta ${envio.statusOutbound} — vai sair sozinha.`
    );
  }

  // RETRY_SEND so faz sentido sobre uma falha real.
  if (decisao.acao === 'RETRY_SEND' && (!envio || envio.statusOutbound !== 'FALHOU')) {
    return negar(
      'RETRY_SEM_FALHA',
      'WAIT',
      `A IA pediu reenvio da etapa ${decisao.etapaOrdem}, que nao esta FALHOU.`
    );
  }

  // ============================================================
  // BARREIRA 5 — nao pular etapa
  // ============================================================
  // O modelo pode achar que "esse lead ja entendeu, manda direto a 3".
  // Nao pode: a sequencia foi voce que escreveu, e a etapa 3 pressupoe
  // a 2 ter saido.
  const esperada = proximaEtapaEsperada(ctx);
  if (esperada === null) {
    return negar(
      'SEQUENCIA_TERMINOU',
      'WAIT',
      'Todas as etapas ja tem envio. Nao ha proxima.'
    );
  }
  if (decisao.acao !== 'RETRY_SEND' && decisao.etapaOrdem !== esperada) {
    return negar(
      'PULO_DE_ETAPA',
      'WAIT',
      `A IA pediu a etapa ${decisao.etapaOrdem}, mas a proxima da sequencia e a ${esperada}.`
    );
  }

  // ============================================================
  // BARREIRA 6 — etapa marcada para envio manual
  // ============================================================
  // `enviarAutomaticamente: false` e a MSG 3 do fluxo real: alguem
  // precisa montar a previa antes. Aqui a acao nao e negada — ela e
  // TRANSFORMADA no que voce configurou que deveria acontecer.
  if (!etapa.enviarAutomaticamente) {
    return {
      permitida: false,
      acaoFinal: 'CREATE_INTERVENTION',
      etapaFinal: decisao.etapaOrdem,
      motivoRejeicao: 'ETAPA_MANUAL',
      explicacao:
        `A etapa ${decisao.etapaOrdem} esta configurada para envio manual. ` +
        `A cadencia pausa e voce e avisado.`,
    };
  }

  return {
    permitida: true,
    acaoFinal: decisao.acao,
    etapaFinal: decisao.etapaOrdem,
    motivoRejeicao: null,
    explicacao: decisao.motivo,
  };
}
