/**
 * Reconciliacao: onde o banco discorda de si mesmo.
 *
 * ============================================================
 * A PERGUNTA QUE ESTE ARQUIVO RESPONDE
 * ============================================================
 * "O que o sistema acha que aconteceu bate com o que realmente
 * aconteceu?"
 *
 * Ela existe porque envio nao e atomico. Entre o WhatsApp aceitar a
 * mensagem e o banco registrar isso ha uma janela — pequena, mas real —
 * e todo defeito serio desta cadencia ate hoje nasceu dentro dela:
 *
 *   - a mensagem saiu e o banco ficou em PROCESSANDO (worker morreu);
 *   - o job rodou e a mensagem nunca foi criada (pos-processamento);
 *   - o ACK chegou para uma mensagem que o banco nao conhece;
 *   - a mesma etapa ganhou duas linhas.
 *
 * ============================================================
 * FUNCAO PURA, DE PROPOSITO
 * ============================================================
 * Ela recebe um retrato ja lido e devolve a lista de problemas. Sem I/O,
 * sem relogio proprio, sem Prisma. Assim da para testar cada tipo de
 * inconsistencia montando o retrato a mao — que e a unica forma sensata
 * de testar isto, porque produzir de verdade um "job concluido sem
 * mensagem" exigiria matar um worker no instante certo.
 *
 * ============================================================
 * DETECTA, NAO CONSERTA
 * ============================================================
 * Nenhuma funcao daqui corrige nada, e isso e deliberado. Quando ha
 * duvida sobre se o WhatsApp recebeu, reenviar automaticamente pode
 * mandar a MESMA mensagem duas vezes para um cliente. Um incomodo seu
 * custa menos que isso.
 */

export type TipoInconsistencia =
  /** PROCESSANDO ha tempo demais: o worker provavelmente morreu. */
  | 'ORFA_EM_PROCESSAMENTO'
  /** A ordem diz ENVIADA, mas nao ha mensagem na conversa. */
  | 'ENVIO_SEM_MENSAGEM'
  /** Ha mensagem na conversa sem ordem de envio correspondente. */
  | 'MENSAGEM_SEM_ENVIO'
  /** Duas ou mais ordens de envio para a mesma etapa. */
  | 'ETAPA_DUPLICADA'
  /** Duas mensagens com o mesmo id do WhatsApp. */
  | 'MENSAGEM_DUPLICADA'
  /** A etapa atual do lead nao corresponde ao que foi enviado. */
  | 'ETAPA_ATUAL_INCORRETA'
  /** Transporte deu certo, pos-processamento nao. */
  | 'POS_PROCESSAMENTO_FALHOU'
  /** Lead em opt-out com mensagem ainda esperando para sair. */
  | 'ENVIO_PENDENTE_APOS_OPT_OUT'
  /** Sequencia parada esperando voce, sem tarefa nem aviso. */
  | 'INTERVENCAO_SEM_AVISO';

export type Gravidade =
  /** Precisa de decisao humana. Nao ha conserto seguro automatico. */
  | 'CRITICA'
  /** Merece olhar, mas o sistema segue funcionando. */
  | 'ATENCAO'
  /** Registro para historico. */
  | 'INFO';

export interface Inconsistencia {
  tipo: TipoInconsistencia;
  gravidade: Gravidade;
  leadId: string;
  campaignId: string | null;
  /** Ordem da etapa, quando aplicavel. */
  etapaOrdem: number | null;
  /** Em portugues: e isto que aparece na auditoria. */
  descricao: string;
  /** O que fazer. Nunca "reenviar" quando ha duvida sobre o transporte. */
  sugestao: string;
  /** ids envolvidos, para investigar. */
  ids: string[];
}

/** Uma ordem de envio, como a reconciliacao precisa ver. */
export interface OrdemParaConferir {
  id: string;
  leadId: string;
  campaignId: string;
  etapaOrdem: number | null;
  status: string;
  erro: string | null;
  dryRun: boolean;
  /** Quando o registro foi mexido pela ultima vez. */
  atualizadoEm: Date;
  /** Preenchido quando o envio gerou linha na conversa. */
  messageId: string | null;
}

/** Uma mensagem da conversa, como a reconciliacao precisa ver. */
export interface MensagemParaConferir {
  id: string;
  leadId: string;
  campaignId: string | null;
  etapaOrdem: number | null;
  direcao: 'ENVIADA' | 'RECEBIDA';
  status: string;
  whatsappMessageId: string | null;
}

/** A posicao do lead na campanha. */
export interface PosicaoParaConferir {
  leadId: string;
  campaignId: string;
  etapaAtualOrdem: number | null;
  status: string;
  aguardandoLiberacao: boolean;
  /** O lead esta em opt-out? */
  leadEmOptOut: boolean;
  /** Ha tarefa aberta para este lead? */
  temTarefaAberta: boolean;
  /** Ha notificacao nao lida para este lead? */
  temAvisoPendente: boolean;
}

export interface RetratoParaConferir {
  agora: Date;
  ordens: OrdemParaConferir[];
  mensagens: MensagemParaConferir[];
  posicoes: PosicaoParaConferir[];
}

/**
 * Quanto tempo em PROCESSANDO antes de virar suspeita.
 *
 * O mesmo numero do despachante, e nao por acaso: la ele decide QUANDO
 * agir; aqui ele decide quando RELATAR. Se os dois divergissem, a
 * auditoria mostraria problemas que o sistema ja resolveu sozinho, ou
 * calaria sobre os que ele deixou passar.
 */
export const MINUTOS_ATE_SUSPEITA = 10;

/** Status que significam "a ordem cumpriu seu papel". */
const CONCLUIDOS = ['ENVIADA', 'SIMULADA'];

/**
 * Confere o retrato e lista o que nao bate.
 *
 * A ordem dos blocos e a ordem da gravidade: o que pode ter causado
 * mensagem duplicada vem primeiro.
 */
export function detectarInconsistencias(r: RetratoParaConferir): Inconsistencia[] {
  const achados: Inconsistencia[] = [];
  const limite = new Date(r.agora.getTime() - MINUTOS_ATE_SUSPEITA * 60_000);

  // -------------------------------------------------------------------------
  // 1. Presas em PROCESSANDO
  // -------------------------------------------------------------------------
  for (const o of r.ordens) {
    if (o.status !== 'PROCESSANDO' || o.atualizadoEm >= limite) continue;

    // Simulada nunca tocou o WhatsApp: devolver para a fila e seguro, e o
    // despachante ja faz isso. Real e outra coisa.
    achados.push({
      tipo: 'ORFA_EM_PROCESSAMENTO',
      gravidade: o.dryRun ? 'INFO' : 'CRITICA',
      leadId: o.leadId,
      campaignId: o.campaignId,
      etapaOrdem: o.etapaOrdem,
      descricao: o.dryRun
        ? `Simulacao da etapa ${o.etapaOrdem} presa em PROCESSANDO.`
        : `Envio REAL da etapa ${o.etapaOrdem} preso em PROCESSANDO ha mais de ${MINUTOS_ATE_SUSPEITA} minutos.`,
      sugestao: o.dryRun
        ? 'O despachante devolve para a fila sozinho.'
        : 'CONFIRA A CONVERSA NO WHATSAPP antes de qualquer coisa. A mensagem pode ter saido.',
      ids: [o.id],
    });
  }

  // -------------------------------------------------------------------------
  // 2. Transporte OK, pos-processamento nao
  // -------------------------------------------------------------------------
  // Nao e falha de envio: a mensagem saiu. E o registro que ficou
  // incompleto — e foi exatamente esse caso que fazia o lead parar na
  // etapa 1 com a mensagem 2 ja entregue.
  for (const o of r.ordens) {
    if (!CONCLUIDOS.includes(o.status) || !o.erro) continue;
    achados.push({
      tipo: 'POS_PROCESSAMENTO_FALHOU',
      gravidade: 'ATENCAO',
      leadId: o.leadId,
      campaignId: o.campaignId,
      etapaOrdem: o.etapaOrdem,
      descricao: `A etapa ${o.etapaOrdem} saiu, mas o pos-processamento falhou: ${o.erro}`,
      sugestao: 'A mensagem foi entregue. Confira se o lead avancou de etapa no quadro.',
      ids: [o.id],
    });
  }

  // -------------------------------------------------------------------------
  // 3. Ordem concluida sem mensagem na conversa
  // -------------------------------------------------------------------------
  for (const o of r.ordens) {
    if (!CONCLUIDOS.includes(o.status) || o.messageId) continue;
    achados.push({
      tipo: 'ENVIO_SEM_MENSAGEM',
      gravidade: 'ATENCAO',
      leadId: o.leadId,
      campaignId: o.campaignId,
      etapaOrdem: o.etapaOrdem,
      descricao: `A etapa ${o.etapaOrdem} esta ${o.status}, mas nao ha mensagem na conversa.`,
      sugestao: 'A conversa nao mostra o que foi enviado. NAO reenvie — confira no WhatsApp.',
      ids: [o.id],
    });
  }

  // -------------------------------------------------------------------------
  // 4. Duas ordens para a mesma etapa
  // -------------------------------------------------------------------------
  // A UNIQUE de `idempotencyKey` deveria tornar isto impossivel. Se
  // aparecer, ou a chave mudou de formula entre versoes, ou alguem mexeu
  // no banco na mao. Vale relatar justamente por ser "impossivel".
  const porEtapa = new Map<string, OrdemParaConferir[]>();
  for (const o of r.ordens) {
    if (o.etapaOrdem === null) continue;
    const chave = `${o.leadId}|${o.campaignId}|${o.etapaOrdem}`;
    porEtapa.set(chave, [...(porEtapa.get(chave) ?? []), o]);
  }
  for (const [, lista] of porEtapa) {
    const ativas = lista.filter((o) => o.status !== 'CANCELADA');
    if (ativas.length < 2) continue;
    const primeira = ativas[0]!;
    achados.push({
      tipo: 'ETAPA_DUPLICADA',
      gravidade: 'CRITICA',
      leadId: primeira.leadId,
      campaignId: primeira.campaignId,
      etapaOrdem: primeira.etapaOrdem,
      descricao: `${ativas.length} ordens de envio para a mesma etapa ${primeira.etapaOrdem}.`,
      sugestao: 'A chave de idempotencia deveria impedir isto. Investigue antes de cancelar.',
      ids: ativas.map((o) => o.id),
    });
  }

  // -------------------------------------------------------------------------
  // 5. Duas mensagens com o mesmo id do WhatsApp
  // -------------------------------------------------------------------------
  const porWhatsApp = new Map<string, MensagemParaConferir[]>();
  for (const m of r.mensagens) {
    if (!m.whatsappMessageId) continue;
    porWhatsApp.set(m.whatsappMessageId, [
      ...(porWhatsApp.get(m.whatsappMessageId) ?? []),
      m,
    ]);
  }
  for (const [id, lista] of porWhatsApp) {
    if (lista.length < 2) continue;
    achados.push({
      tipo: 'MENSAGEM_DUPLICADA',
      gravidade: 'CRITICA',
      leadId: lista[0]!.leadId,
      campaignId: lista[0]!.campaignId,
      etapaOrdem: lista[0]!.etapaOrdem,
      descricao: `${lista.length} mensagens com o mesmo id do WhatsApp (${id}).`,
      sugestao: 'A UNIQUE deveria impedir. Investigue antes de apagar qualquer linha.',
      ids: lista.map((m) => m.id),
    });
  }

  // -------------------------------------------------------------------------
  // 6. A etapa atual do lead nao corresponde ao que saiu
  // -------------------------------------------------------------------------
  for (const p of r.posicoes) {
    const enviadas = r.ordens
      .filter(
        (o) =>
          o.leadId === p.leadId &&
          o.campaignId === p.campaignId &&
          CONCLUIDOS.includes(o.status) &&
          o.etapaOrdem !== null
      )
      .map((o) => o.etapaOrdem!);

    if (enviadas.length === 0) continue;
    const maior = Math.max(...enviadas);

    // Atras da ultima enviada e sintoma do bug que ja aconteceu: o
    // pos-processamento falhou e `leadCampaign` nao foi atualizado.
    if (p.etapaAtualOrdem !== null && p.etapaAtualOrdem < maior) {
      achados.push({
        tipo: 'ETAPA_ATUAL_INCORRETA',
        gravidade: 'ATENCAO',
        leadId: p.leadId,
        campaignId: p.campaignId,
        etapaOrdem: maior,
        descricao: `O lead esta marcado na etapa ${p.etapaAtualOrdem}, mas a etapa ${maior} ja foi enviada.`,
        sugestao: 'O quadro mostra o lead atrasado. Corrigir e seguro: nao reenvia nada.',
        ids: [],
      });
    }
  }

  // -------------------------------------------------------------------------
  // 7. Opt-out com mensagem ainda na fila
  // -------------------------------------------------------------------------
  // O pior caso possivel deste sistema: alguem pediu para parar e uma
  // mensagem sai depois. Sempre CRITICA.
  for (const p of r.posicoes) {
    if (!p.leadEmOptOut) continue;
    const pendentes = r.ordens.filter(
      (o) =>
        o.leadId === p.leadId &&
        ['PENDENTE', 'AGENDADA', 'PROCESSANDO'].includes(o.status)
    );
    if (pendentes.length === 0) continue;

    achados.push({
      tipo: 'ENVIO_PENDENTE_APOS_OPT_OUT',
      gravidade: 'CRITICA',
      leadId: p.leadId,
      campaignId: p.campaignId,
      etapaOrdem: null,
      descricao: `Lead em OPT-OUT com ${pendentes.length} mensagem(ns) ainda esperando para sair.`,
      sugestao: 'Cancele agora. Nenhuma mensagem pode sair para quem pediu para parar.',
      ids: pendentes.map((o) => o.id),
    });
  }

  // -------------------------------------------------------------------------
  // 8. Parada esperando voce, sem ninguem ter avisado
  // -------------------------------------------------------------------------
  // Um lead congelado sem tarefa e sem aviso e um lead esquecido: ele
  // nao aparece em lugar nenhum que voce olhe no dia a dia.
  for (const p of r.posicoes) {
    if (!p.aguardandoLiberacao) continue;
    if (p.temTarefaAberta || p.temAvisoPendente) continue;

    achados.push({
      tipo: 'INTERVENCAO_SEM_AVISO',
      gravidade: 'ATENCAO',
      leadId: p.leadId,
      campaignId: p.campaignId,
      etapaOrdem: p.etapaAtualOrdem,
      descricao: 'A sequencia esta parada esperando liberacao, mas nao ha tarefa nem aviso.',
      sugestao: 'O lead esta invisivel para voce. Criar a tarefa e seguro.',
      ids: [],
    });
  }

  return achados;
}

/** Conta por gravidade, para o resumo da auditoria. */
export function resumirInconsistencias(
  lista: Inconsistencia[]
): Record<Gravidade, number> {
  return {
    CRITICA: lista.filter((i) => i.gravidade === 'CRITICA').length,
    ATENCAO: lista.filter((i) => i.gravidade === 'ATENCAO').length,
    INFO: lista.filter((i) => i.gravidade === 'INFO').length,
  };
}
