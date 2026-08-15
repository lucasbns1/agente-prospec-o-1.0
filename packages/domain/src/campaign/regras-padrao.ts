/**
 * O que uma etapa faz com cada tipo de resposta, quando ninguem disse.
 *
 * ============================================================
 * O BURACO QUE ISTO FECHA
 * ============================================================
 * `decidirAcao` procura uma regra para a categoria detectada. Sem
 * regra, ele nao improvisa: devolve INTERVENCAO com o motivo
 * `SEM_REGRA_CONFIGURADA`. Isso e correto — o sistema nao deve inventar
 * o que fazer com "quanto custa?".
 *
 * So que `campaign_step_rules` nao tinha NENHUM caminho para ser
 * preenchida: nao ha tela, nao ha rota, e o seed nao cria nenhuma. Toda
 * etapa nascia sem regra alguma. Na pratica, TODA resposta de TODO lead
 * caia em intervencao manual, inclusive um "sim, quero" perfeito.
 *
 * O motor estava certo e o sistema, inutil: a automacao nunca podia
 * automatizar nada.
 *
 * ============================================================
 * POR QUE PADROES, E NAO UMA TELA
 * ============================================================
 * Uma tela ainda seria melhor, e continua na lista. Mas "nao ha regra"
 * nao pode ser o estado inicial: ele transforma a ferramenta em uma
 * caixa de entrada manual. Estes padroes sao linhas normais no banco —
 * editaveis, visiveis, sem nada de magico. A tela, quando existir,
 * edita exatamente estas linhas.
 *
 * ============================================================
 * A ESCOLHA DOS PADROES
 * ============================================================
 * Conservadores de proposito. Duas acoes so:
 *
 *   - AVANCAR    — apenas para POSITIVO. E o unico sinal em que
 *                  continuar a sequencia e o que a pessoa pediu.
 *   - PARAR      — para NEGATIVO e OPT_OUT. Insistir depois de um
 *                  "nao" e o comportamento que faz alguem bloquear o
 *                  numero.
 *
 * Todo o resto — PRECO, DUVIDA, FALAR_DEPOIS, INTERESSE — chama VOCE.
 * Sao justamente as conversas que valem dinheiro, e sao as que uma
 * resposta automatica estraga. INTERESSE fica de fora do AVANCAR de
 * proposito: e um sinal fraco, e o motor ja exige confianca 50 para
 * qualquer acao que envie.
 *
 * DESCONHECIDO nao esta na lista porque `decidirAcao` o trata antes de
 * consultar regra nenhuma: ele nunca avanca e nunca responde.
 *
 * Nada aqui toca o banco: entra nada, sai uma lista de configuracoes.
 */

/**
 * Traduz a acao gravada na etapa para a acao que o motor entende.
 *
 * ============================================================
 * SAO DOIS VOCABULARIOS DIFERENTES
 * ============================================================
 * O banco guarda `StepAction` (AVANCAR, IR_PARA_ETAPA, PARAR, SNOOZE,
 * AGUARDAR_INTERVENCAO, NENHUMA). O motor decide em `AcaoMotor`
 * (RESPONDER, AVANCAR, AGUARDAR, SNOOZE, PARAR, OPT_OUT, INTERVENCAO).
 * Eles coincidem em tres nomes e divergem no resto.
 *
 * O codigo antes fazia `regras as unknown as RegraCategoria[]` e
 * entregava a string do banco direto ao `switch`. Funcionava por
 * acidente: `AGUARDAR_INTERVENCAO` nao casa com nenhum `case` e cai no
 * `default`, que por sorte e INTERVENCAO. Ou seja, o comportamento
 * certo saia de um caminho que ninguem escolheu — e o dia em que o
 * `default` mudasse, mudaria junto sem nenhum teste reclamar.
 *
 * Traduzir aqui torna a intencao explicita: cada acao do banco tem um
 * destino escrito, e o que nao tem destino claro vira INTERVENCAO de
 * propriedade, nao de sobra.
 */
export function acaoDoMotor(acaoDaEtapa: string): string {
  switch (acaoDaEtapa) {
    case 'AVANCAR':
      return 'AVANCAR';
    case 'PARAR':
      return 'PARAR';
    case 'SNOOZE':
      return 'SNOOZE';
    // IR_PARA_ETAPA seria um salto para uma etapa especifica. O avanco
    // hoje so sabe ir para a PROXIMA — mandar para a proxima quando a
    // configuracao pede a etapa 5 enviaria a mensagem errada. Ate
    // existir o salto, isto chama voce.
    case 'IR_PARA_ETAPA':
    case 'AGUARDAR_INTERVENCAO':
    case 'NENHUMA':
    default:
      return 'INTERVENCAO';
  }
}

/** Uma acao de etapa, como o enum `StepAction` do banco. */
export type AcaoPadrao =
  | 'AVANCAR'
  | 'PARAR'
  | 'SNOOZE'
  | 'AGUARDAR_INTERVENCAO'
  | 'NENHUMA';

export interface RegraPadraoDaEtapa {
  categoria: string;
  acao: AcaoPadrao;
  novaTemperatura: string | null;
  novoStatus: string | null;
  criarTarefa: boolean;
  tarefaTitulo: string | null;
  notificar: boolean;
  /** Explica a escolha na tela, quando a tela existir. */
  porque: string;
}

/**
 * O conjunto padrao, aplicado a toda etapa nova.
 *
 * `snoozeHoras` nao aparece aqui: FALAR_DEPOIS vai para intervencao, e
 * nao para snooze automatico. Adiar sozinho parece inofensivo, mas
 * decide por voce que a conversa continua depois — e o lead que disse
 * "me chama semana que vem" muitas vezes esta dizendo "nao" de forma
 * educada.
 */
export function regrasPadraoDaEtapa(): RegraPadraoDaEtapa[] {
  return [
    {
      categoria: 'POSITIVO',
      acao: 'AVANCAR',
      novaTemperatura: 'QUENTE',
      novoStatus: null,
      criarTarefa: false,
      tarefaTitulo: null,
      notificar: false,
      porque: 'A pessoa disse que quer. Continuar a sequência é o que ela pediu.',
    },
    {
      categoria: 'NEGATIVO',
      acao: 'PARAR',
      novaTemperatura: 'FRIO',
      novoStatus: 'ENCERRADO',
      criarTarefa: false,
      tarefaTitulo: null,
      notificar: false,
      porque: 'Insistir depois de um "não" é o que faz bloquearem o número.',
    },
    {
      categoria: 'OPT_OUT',
      acao: 'PARAR',
      novaTemperatura: 'FRIO',
      novoStatus: 'OPT_OUT',
      criarTarefa: false,
      tarefaTitulo: null,
      notificar: false,
      porque:
        'Redundante de propósito: o motor já trata opt-out antes de olhar ' +
        'qualquer regra. Está aqui para que apagar esta linha por engano ' +
        'não pareça liberar alguma coisa.',
    },
    {
      categoria: 'PRECO',
      acao: 'AGUARDAR_INTERVENCAO',
      novaTemperatura: 'QUENTE',
      novoStatus: null,
      criarTarefa: true,
      tarefaTitulo: 'Responder sobre preço',
      notificar: true,
      porque: 'Quem pergunta preço está comprando. Vale a sua resposta, não uma pronta.',
    },
    {
      categoria: 'DUVIDA',
      acao: 'AGUARDAR_INTERVENCAO',
      novaTemperatura: 'MORNO',
      novoStatus: null,
      criarTarefa: true,
      tarefaTitulo: 'Responder dúvida',
      notificar: true,
      porque: 'Uma dúvida respondida errado por robô custa mais que o silêncio.',
    },
    {
      categoria: 'FALAR_DEPOIS',
      acao: 'AGUARDAR_INTERVENCAO',
      novaTemperatura: 'MORNO',
      novoStatus: null,
      criarTarefa: true,
      tarefaTitulo: 'Retomar contato',
      notificar: false,
      porque:
        '"Me chama depois" às vezes é um não educado. Quem decide se ' +
        'insiste é você, não um agendamento automático.',
    },
    {
      categoria: 'INTERESSE',
      acao: 'AGUARDAR_INTERVENCAO',
      novaTemperatura: 'MORNO',
      novoStatus: null,
      criarTarefa: false,
      tarefaTitulo: null,
      notificar: true,
      porque: 'Sinal fraco demais para disparar a próxima mensagem sozinho.',
    },
  ];
}
