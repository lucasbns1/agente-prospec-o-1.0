/**
 * O RETRATO que o Gemini recebe.
 *
 * ============================================================
 * A REGRA QUE ESTE ARQUIVO EXISTE PARA SUSTENTAR
 * ============================================================
 * O modelo nao tem memoria entre chamadas, e nao PODE ter. Se ele
 * pudesse "lembrar" que mandou a mensagem 2, mais cedo ou mais tarde ele
 * lembraria errado — e o sistema mandaria de novo, ou nunca mandaria.
 *
 * Por isso todo campo aqui e um FATO LIDO DO BANCO no instante da
 * chamada. Nao ha nada nesta estrutura que o modelo tenha afirmado. Ele
 * recebe o retrato, opina, e no evento seguinte recebe um retrato novo,
 * montado do zero.
 *
 * Os tipos vivem no dominio (e nao no worker) porque o prompt e a
 * validacao dependem deles, e esses dois precisam ser testaveis sem
 * banco.
 */

/** Por que estamos chamando a IA agora. */
export type GatilhoCadencia =
  /** O lead respondeu alguma coisa. */
  | 'MENSAGEM_RECEBIDA'
  /** Uma etapa terminou de sair (transporte confirmado). */
  | 'ETAPA_CONCLUIDA'
  /** Chegou um ACK terminal (ENTREGUE ou LIDA). */
  | 'ACK_FINAL'
  /** Voce liberou uma etapa que estava parada esperando. */
  | 'OPERADOR_LIBEROU'
  /** Um envio real falhou e alguem precisa decidir o que fazer. */
  | 'ENVIO_FALHOU'
  /**
   * VOCE falou com o lead pelo seu WhatsApp.
   *
   * ============================================================
   * O QUE ELE PEDE, E O QUE ELE NAO PEDE
   * ============================================================
   * Ele pede uma RELEITURA do contexto: a conversa mudou, e a IA nao
   * sabia. Ate agora a sua mensagem entrava no retrato que ela le, mas
   * nao acordava ninguem — se voce respondia e o lead nunca mais
   * escrevia, nenhuma analise acontecia sobre aquela conversa.
   *
   * Ele NAO pede envio. A sequencia daquele lead acabou de ser pausada
   * com `aguardandoLiberacao`, e essa e uma barreira que a guarda nao
   * deixa atravessar — a propria BARREIRA 3 de `validarDecisao` recusa
   * qualquer acao de envio enquanto ela estiver levantada.
   *
   * Ou seja: a IA le, opina e registra. Quem destrava e voce.
   */
  | 'OPERADOR_FALOU';

/** Uma etapa da sequencia, como configurada na campanha. */
export interface EtapaContexto {
  /** 1-based. E por este numero que a IA se refere as etapas. */
  ordem: number;
  nome: string | null;
  /** Texto configurado, ainda com as variaveis. */
  texto: string;
  /** true = a sequencia congela ate o lead falar. */
  aguardarResposta: boolean;
  /** false = so sai com liberacao manual sua. */
  enviarAutomaticamente: boolean;
  /** Delay configurado ate esta etapa, em segundos. */
  delaySegundos: number;
}

/**
 * O estado REAL de um envio. Cada campo aqui saiu de uma coluna.
 *
 * `statusOutbound` e a ordem de envio; `statusMensagem` e o que existe
 * na conversa. Sao tabelas diferentes de proposito: uma ordem pode estar
 * ENVIADA enquanto a mensagem ainda esta ENVIADA (sem ACK), e o ACK
 * depois a leva para ENTREGUE e LIDA.
 */
export interface EnvioContexto {
  ordem: number;
  /** PENDENTE | AGENDADA | PROCESSANDO | SIMULADA | ENVIADA | BLOQUEADA | FALHOU | CANCELADA */
  statusOutbound: string;
  /** PENDENTE | ENVIADA | ENTREGUE | LIDA | FALHOU | SIMULADA | CANCELADA | null */
  statusMensagem: string | null;
  enviadaEm: string | null;
  /** Preenchido quando algo deu errado. Pode existir COM status ENVIADA:
   *  significa que o transporte deu certo e o pos-processamento nao. */
  erro: string | null;
  dryRun: boolean;
}

/** Uma resposta do lead, ja classificada pelo motor deterministico. */
export interface RespostaContexto {
  texto: string;
  recebidaEm: string;
  /** O que o dicionario achou. A IA ve isso e pode discordar. */
  categoriaDoMotor: string;
  confiancaDoMotor: number;
}

/**
 * Uma linha da conversa, nos dois sentidos.
 *
 * ============================================================
 * POR QUE O QUE NOS ENVIAMOS TAMBEM PRECISA IR
 * ============================================================
 * So com as respostas do lead, "pode mandar" fica sem referente: mandar
 * o que? O modelo teria que adivinhar a que pergunta aquilo responde, e
 * adivinhar e exatamente o que nao queremos.
 *
 * Com os dois lados, a conversa se le como conversa — e a decisao passa
 * a considerar o que ja foi dito, nao so a ultima frase.
 */
export interface LinhaConversa {
  direcao: 'ENVIADA' | 'RECEBIDA';
  texto: string;
  quando: string;
  /** ENVIADA | ENTREGUE | LIDA | FALHOU | SIMULADA... */
  status: string;
  /** So nas recebidas: o que o dicionario achou. */
  categoriaDoMotor?: string;
}

export interface ContextoCadencia {
  gatilho: GatilhoCadencia;

  campanha: {
    id: string;
    nome: string;
    /** RASCUNHO | ATIVA | PAUSADA | CONCLUIDA | ARQUIVADA */
    status: string;
    /** Calculado pelo backend, nao pelo modelo. */
    dentroDaJanela: boolean;
  };

  /** A sequencia configurada, em ordem. */
  sequencia: EtapaContexto[];

  lead: {
    id: string;
    nome: string | null;
    empresa: string | null;
    bairro: string | null;
    cidade: string | null;
    /** Barreira determinista. Se true, nada sai. */
    optOut: boolean;
    status: string;
    temperatura: string;
  };

  posicao: {
    /** Onde o lead esta HOJE. Nao significa que a etapa foi enviada. */
    etapaAtualOrdem: number | null;
    /** PENDENTE | EM_ANDAMENTO | AGUARDANDO_RESPOSTA | ... */
    statusNaCampanha: string;
    /** true = so anda com liberacao manual sua. */
    aguardandoLiberacao: boolean;
    proximoEnvioEm: string | null;
  };

  /** Uma linha por etapa que ja tem ordem de envio. */
  envios: EnvioContexto[];

  /** As respostas do lead, mais recentes por ultimo. */
  respostas: RespostaContexto[];

  /**
   * A conversa inteira, nos dois sentidos, mais recente por ultimo.
   *
   * Redundante com `respostas` de proposito: aquele campo alimenta as
   * regras (categoria e confianca do motor), este alimenta a leitura da
   * IA. Juntar os dois num so obrigaria um deles a carregar campos que
   * nao usa.
   */
  conversa: LinhaConversa[];

  /**
   * O que ainda esta na sua mao.
   *
   * ============================================================
   * POR QUE A IA PRECISA SABER DISSO
   * ============================================================
   * Sem esta lista, o modelo pode pedir intervencao para um lead que ja
   * tem uma tarefa aberta esperando exatamente por isso — e voce recebe
   * o mesmo pedido duas vezes com palavras diferentes.
   *
   * `aguardandoLiberacao` diz que a cadencia esta congelada;
   * `tarefasPendentes` diz POR QUE, e o que voce ja foi convidado a
   * fazer a respeito.
   */
  tarefasPendentes: { tipo: string; titulo: string; criadaEm: string }[];

  /** As regras configuradas para a etapa atual. */
  regras: { categoria: string; acao: string }[];

  relogio: {
    agora: string;
    /** null quando nada saiu ainda. */
    segundosDesdeUltimoEnvio: number | null;
  };
}

/**
 * Os status que significam "esta etapa ja tem envio em curso ou
 * concluido — nao crie outra ordem".
 *
 * PENDENTE e AGENDADA entram na lista: a ordem existe e vai sair. Criar
 * outra nao produziria dois envios (a UNIQUE barra), mas produziria uma
 * decisao errada a cada evento, para sempre.
 *
 * FALHOU, BLOQUEADA e CANCELADA ficam de fora: essas podem ser
 * retentadas conforme a politica.
 */
export const STATUS_OCUPA_ETAPA = [
  'PENDENTE',
  'AGENDADA',
  'PROCESSANDO',
  'SIMULADA',
  'ENVIADA',
] as const;

/**
 * A proxima etapa que faz sentido enviar, calculada por ARITMETICA
 * sobre o banco — nunca perguntada ao modelo.
 *
 * E a menor ordem da sequencia que ainda nao tem envio ocupando. Se
 * todas tem, devolve null (a sequencia acabou).
 */
export function proximaEtapaEsperada(ctx: ContextoCadencia): number | null {
  const ocupadas = new Set(
    ctx.envios
      .filter((e) =>
        (STATUS_OCUPA_ETAPA as readonly string[]).includes(e.statusOutbound)
      )
      .map((e) => e.ordem)
  );

  const candidata = ctx.sequencia
    .map((e) => e.ordem)
    .sort((a, b) => a - b)
    .find((o) => !ocupadas.has(o));

  return candidata ?? null;
}

/** O envio registrado para uma etapa, se houver. */
export function envioDaEtapa(
  ctx: ContextoCadencia,
  ordem: number
): EnvioContexto | null {
  return ctx.envios.find((e) => e.ordem === ordem) ?? null;
}

/** A etapa configurada com aquela ordem, se existir. */
export function etapaDaOrdem(
  ctx: ContextoCadencia,
  ordem: number
): EtapaContexto | null {
  return ctx.sequencia.find((e) => e.ordem === ordem) ?? null;
}
