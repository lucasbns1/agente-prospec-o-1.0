/**
 * Qualificacao de leads (Fase Q).
 *
 * Responde: este lead pode entrar em uma campanha, e por que?
 *
 * Funcao pura. Recebe os dados do lead + os criterios, devolve o
 * veredito e o MOTIVO — o motivo nao e opcional. "NAO_QUALIFICADO" sem
 * explicacao e inutil para quem esta olhando a tela.
 *
 * A distincao que importa:
 *
 *   BLOQUEADO       nunca pode ser contatado. Opt-out, sem telefone.
 *                   Nenhuma configuracao de campanha reverte isso.
 *
 *   NAO_QUALIFICADO nao atende aos criterios DESTA campanha. Pode ser
 *                   perfeito para outra.
 *
 *   REVISAR         algo parece errado e um humano precisa olhar antes.
 */

export type Qualificacao =
  | 'NAO_AVALIADO'
  | 'QUALIFICADO'
  | 'NAO_QUALIFICADO'
  | 'BLOQUEADO'
  | 'REVISAR';

/** Dados do lead necessarios para qualificar. */
export interface LeadParaQualificar {
  id: string;
  nomeCompleto: string | null;
  primeiroNome: string | null;
  empresa: string | null;
  telefoneNormalizado: string | null;
  websiteStatus: string;
  instagramUrl: string | null;
  cidade: string | null;
  estado: string | null;
  categoria: string | null;
  avaliacao: number | null;
  totalAvaliacoes: number | null;
  status: string;
  optOut: boolean;
  tags: string[];
  /** Ja recebeu alguma mensagem em alguma campanha? */
  jaContatado: boolean;
}

/**
 * Criterios de qualificacao.
 *
 * Todos opcionais: um criterio ausente simplesmente nao filtra nada.
 * Isso e diferente de um criterio `false` — `exigirTelefone: false`
 * significa "nao me importo", nao "quero leads sem telefone".
 */
export interface CriteriosQualificacao {
  exigirTelefone?: boolean;
  /** true = so leads SEM site proprio (o caso de uso principal). */
  exigirSemSite?: boolean;
  /** true = so leads COM site proprio. */
  exigirComSite?: boolean;
  exigirSemInstagram?: boolean;
  exigirComInstagram?: boolean;
  avaliacaoMinima?: number;
  totalAvaliacoesMinimo?: number;
  cidades?: string[];
  estados?: string[];
  categorias?: string[];
  tags?: string[];
  /** true = so leads que nunca receberam mensagem. */
  apenasNuncaContatados?: boolean;
}

export interface ResultadoQualificacao {
  qualificacao: Qualificacao;
  motivo: string;
  /** Todos os criterios que falharam, nao so o primeiro. */
  falhas: string[];
  /** Criterios atendidos — usado no texto do motivo. */
  atendidos: string[];
}

/**
 * Status de lead que impedem envio automatico.
 * AGUARDANDO_INTERVENCAO esta aqui porque o sistema ja decidiu que
 * aquela conversa precisa de um humano; enfileirar mais uma mensagem
 * automatica atropelaria essa decisao.
 */
const STATUS_BLOQUEANTES = new Set([
  'OPT_OUT',
  'AGUARDANDO_INTERVENCAO',
  'PAUSADO',
]);

/** Status de website que significam "nao tem site proprio". */
const SEM_SITE = new Set(['NAO_INFORMADO', 'REDE_SOCIAL', 'INVALIDO']);

function normalizar(s: string | null): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function qualificarLead(
  lead: LeadParaQualificar,
  criterios: CriteriosQualificacao = {}
): ResultadoQualificacao {
  // -------------------------------------------------------------
  // 1. BLOQUEIOS — vem primeiro e nao sao negociaveis
  // -------------------------------------------------------------
  if (lead.optOut) {
    return {
      qualificacao: 'BLOQUEADO',
      motivo: 'Lead em opt-out',
      falhas: ['opt-out'],
      atendidos: [],
    };
  }

  if (STATUS_BLOQUEANTES.has(lead.status)) {
    const legivel = lead.status.toLowerCase().replace(/_/g, ' ');
    return {
      qualificacao: 'BLOQUEADO',
      motivo: `Lead com status ${legivel}`,
      falhas: [`status ${legivel}`],
      atendidos: [],
    };
  }

  if (!lead.telefoneNormalizado) {
    return {
      qualificacao: 'BLOQUEADO',
      motivo: 'Sem telefone utilizavel — nao ha como enviar',
      falhas: ['sem telefone'],
      atendidos: [],
    };
  }

  // -------------------------------------------------------------
  // 2. REVISAR — dados incompletos que atrapalham a personalizacao
  // -------------------------------------------------------------
  if (!lead.nomeCompleto && !lead.empresa) {
    return {
      qualificacao: 'REVISAR',
      motivo: 'Sem nome nem empresa — a mensagem ficaria impessoal demais',
      falhas: ['sem identificacao'],
      atendidos: ['telefone valido'],
    };
  }

  // -------------------------------------------------------------
  // 3. CRITERIOS DA CAMPANHA
  // -------------------------------------------------------------
  const falhas: string[] = [];
  const atendidos: string[] = ['telefone valido'];

  const temSite = !SEM_SITE.has(lead.websiteStatus);

  if (criterios.exigirSemSite) {
    if (temSite) falhas.push('ja possui site proprio');
    else atendidos.push('sem site');
  }
  if (criterios.exigirComSite) {
    if (!temSite) falhas.push('nao possui site proprio');
    else atendidos.push('com site');
  }

  if (criterios.exigirSemInstagram) {
    if (lead.instagramUrl) falhas.push('ja possui Instagram');
    else atendidos.push('sem Instagram');
  }
  if (criterios.exigirComInstagram) {
    if (!lead.instagramUrl) falhas.push('nao possui Instagram');
    else atendidos.push('com Instagram');
  }

  if (criterios.avaliacaoMinima !== undefined) {
    if (lead.avaliacao === null) {
      falhas.push('sem avaliacao registrada');
    } else if (lead.avaliacao < criterios.avaliacaoMinima) {
      falhas.push(`avaliacao ${lead.avaliacao} abaixo de ${criterios.avaliacaoMinima}`);
    } else {
      atendidos.push(`avaliacao ${lead.avaliacao}`);
    }
  }

  if (criterios.totalAvaliacoesMinimo !== undefined) {
    if (lead.totalAvaliacoes === null) {
      falhas.push('sem contagem de avaliacoes');
    } else if (lead.totalAvaliacoes < criterios.totalAvaliacoesMinimo) {
      falhas.push(
        `${lead.totalAvaliacoes} avaliacoes, minimo ${criterios.totalAvaliacoesMinimo}`
      );
    } else {
      atendidos.push(`${lead.totalAvaliacoes} avaliacoes`);
    }
  }

  if (criterios.cidades?.length) {
    const alvo = criterios.cidades.map(normalizar);
    if (!alvo.includes(normalizar(lead.cidade))) {
      falhas.push(`cidade ${lead.cidade ?? 'nao informada'} fora do filtro`);
    } else {
      atendidos.push(`cidade ${lead.cidade}`);
    }
  }

  if (criterios.estados?.length) {
    const alvo = criterios.estados.map((e) => e.toUpperCase());
    if (!lead.estado || !alvo.includes(lead.estado.toUpperCase())) {
      falhas.push(`estado ${lead.estado ?? 'nao informado'} fora do filtro`);
    } else {
      atendidos.push(`estado ${lead.estado}`);
    }
  }

  if (criterios.categorias?.length) {
    const alvo = criterios.categorias.map(normalizar);
    const cat = normalizar(lead.categoria);
    if (!alvo.some((a) => cat.includes(a))) {
      falhas.push(`categoria ${lead.categoria ?? 'nao informada'} fora do filtro`);
    } else {
      atendidos.push(`categoria ${lead.categoria}`);
    }
  }

  if (criterios.tags?.length) {
    const doLead = lead.tags.map(normalizar);
    const pedidas = criterios.tags.map(normalizar);
    if (!pedidas.some((t) => doLead.includes(t))) {
      falhas.push('sem as tags exigidas');
    } else {
      atendidos.push('tags conferem');
    }
  }

  if (criterios.apenasNuncaContatados && lead.jaContatado) {
    falhas.push('ja foi contatado antes');
  }

  if (criterios.exigirTelefone === false) {
    // Nada a fazer: telefone ja foi exigido como bloqueio acima.
    // O criterio existe apenas para tornar a intencao explicita.
  }

  if (falhas.length > 0) {
    return {
      qualificacao: 'NAO_QUALIFICADO',
      motivo: falhas.join('; '),
      falhas,
      atendidos,
    };
  }

  return {
    qualificacao: 'QUALIFICADO',
    motivo: atendidos.join(' + '),
    falhas: [],
    atendidos,
  };
}

/** true quando o lead pode entrar numa fila de envio. */
export function podeEntrarEmCampanha(q: Qualificacao): boolean {
  return q === 'QUALIFICADO';
}
