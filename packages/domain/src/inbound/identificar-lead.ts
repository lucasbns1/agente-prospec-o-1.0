/**
 * De quem e esta mensagem?
 *
 * ============================================================
 * A REGRA CENTRAL: NAO ADIVINHAR
 * ============================================================
 * Se o telefone casa com exatamente um lead, e dele. Se casa com
 * nenhum, e um desconhecido. Se casa com VARIOS, o sistema para e
 * pergunta — porque escolher errado significa gravar a resposta de uma
 * pessoa no historico de outra, e a partir dai toda decisao seguinte
 * (classificacao, etapa, temperatura) sai errada para as duas.
 *
 * Um "chute com 80% de acerto" aqui produz 20% de conversas cruzadas que
 * ninguem percebe ate ser tarde.
 *
 * Funcao pura: recebe os candidatos que o servico buscou, devolve o
 * veredito. Nao consulta banco.
 */

export type ResultadoIdentificacao =
  | { tipo: 'ENCONTRADO'; leadId: string }
  | { tipo: 'AMBIGUO'; candidatos: string[]; motivo: string }
  | { tipo: 'DESCONHECIDO'; motivo: string };

export interface LeadCandidato {
  id: string;
  telefoneNormalizado: string | null;
  optOut: boolean;
  status: string;
  /** Quando houve a ultima troca. Desempata candidatos igualmente validos. */
  ultimaInteracaoEm: Date | null;
  createdAt: Date;
}

/**
 * Status que indicam que o lead saiu do jogo.
 *
 * Um lead ENCERRADO nao deveria receber resposta nova — mas se receber,
 * ele ainda e o dono da conversa. Estes status NAO eliminam candidatos;
 * so servem para desempatar quando ha mais de um.
 */
const STATUS_INATIVO = new Set(['ENCERRADO', 'OPT_OUT', 'CLIENTE']);

export interface OpcoesIdentificacao {
  /**
   * Quando dois leads tem o mesmo telefone mas so um esta ativo, usar o
   * ativo em vez de pedir revisao.
   *
   * Ligado por padrao: e o caso comum de duplicata antiga que ja foi
   * encerrada, e pedir revisao humana para isso seria ruido. Quando ha
   * DOIS ativos, nem esta opcao resolve — ai o sistema para mesmo.
   */
  desempatarPorAtividade?: boolean;
}

export function identificarLead(
  telefoneE164: string | null,
  candidatos: LeadCandidato[],
  opcoes: OpcoesIdentificacao = {}
): ResultadoIdentificacao {
  const desempatar = opcoes.desempatarPorAtividade ?? true;

  if (!telefoneE164) {
    return {
      tipo: 'DESCONHECIDO',
      motivo: 'Telefone da mensagem não pôde ser normalizado para E.164',
    };
  }

  if (candidatos.length === 0) {
    return {
      tipo: 'DESCONHECIDO',
      motivo: `Nenhum lead com o telefone ${telefoneE164}`,
    };
  }

  if (candidatos.length === 1) {
    return { tipo: 'ENCONTRADO', leadId: candidatos[0]!.id };
  }

  // --- Mais de um candidato ---
  if (desempatar) {
    const ativos = candidatos.filter((c) => !STATUS_INATIVO.has(c.status));

    if (ativos.length === 1) {
      return { tipo: 'ENCONTRADO', leadId: ativos[0]!.id };
    }

    // Nenhum ativo: todos encerrados. O mais recente é o dono da última
    // conversa, e é para ele que a pessoa está respondendo.
    if (ativos.length === 0) {
      const maisRecente = [...candidatos].sort(
        (a, b) => tempo(b) - tempo(a)
      )[0]!;
      return { tipo: 'ENCONTRADO', leadId: maisRecente.id };
    }
  }

  // Dois ou mais ativos com o mesmo telefone: o sistema não tem como
  // saber, e chutar cruzaria duas conversas.
  return {
    tipo: 'AMBIGUO',
    candidatos: candidatos.map((c) => c.id),
    motivo: `${candidatos.length} leads ativos com o telefone ${telefoneE164}`,
  };
}

function tempo(c: LeadCandidato): number {
  return (c.ultimaInteracaoEm ?? c.createdAt).getTime();
}
