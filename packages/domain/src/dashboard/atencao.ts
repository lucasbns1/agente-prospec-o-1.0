/**
 * "Precisa da sua atencao" — o que o sistema NAO resolve sozinho.
 *
 * ============================================================
 * POR QUE ESTA SECAO VEM ANTES DOS NUMEROS
 * ============================================================
 * Um dashboard cheio de metricas e bonito e inutil se o lead quente que
 * respondeu ontem continua esperando. Esta lista e a unica parte da tela
 * que exige acao — por isso ela aparece primeiro e por isso a ordem dela
 * e uma decisao de produto, nao de layout.
 *
 * Funcao pura: entra a lista de candidatos, sai a lista priorizada. Quem
 * busca no banco e o servico; quem decide a ordem e este arquivo, que da
 * para testar sem banco.
 */

// O contrato (`MotivoAtencao`, `PRIORIDADE_ATENCAO`, `ItemAtencao`) mora
// em @prospector/shared porque o frontend tambem precisa dele e nao
// depende de @prospector/domain. Aqui fica so a LOGICA — importar os
// tipos em vez de redeclarar evita as duas definicoes divergirem.
import {
  PRIORIDADE_ATENCAO,
  type MotivoAtencao,
  type ItemAtencao,
} from '@prospector/shared';

export { PRIORIDADE_ATENCAO };
export type { MotivoAtencao, ItemAtencao };

/** O que fazer, em uma frase, no imperativo. */
export const ACAO_ATENCAO: Record<MotivoAtencao, string> = {
  INTERVENCAO_NECESSARIA: 'Responder manualmente',
  LEAD_QUENTE: 'Entrar em contato agora',
  PEDIDO_PREVIEW: 'Criar o preview',
  PEDIDO_PRECO: 'Enviar o orçamento',
  TAREFA_ATRASADA: 'Concluir a tarefa atrasada',
  ERRO_ENVIO: 'Verificar o erro de envio',
};

export interface CandidatoAtencao {
  leadId: string;
  nome: string | null;
  categoria: string | null;
  bairro: string | null;
  cidade: string | null;
  temperatura: string;
  status: string;
  motivo: MotivoAtencao;
  ultimaMensagem: string | null;
  etapaAtual: string | null;
  /** Quando o motivo passou a valer. Desempata dentro da mesma prioridade. */
  em: Date;
}

export interface OpcoesAtencao {
  /** Teto da lista. A tela nao comporta cem itens acionaveis. */
  limite?: number;
}

/**
 * Ordena, remove repetidos e devolve a lista pronta para a tela.
 *
 * ============================================================
 * UM LEAD APARECE UMA VEZ SO
 * ============================================================
 * O mesmo lead pode ser candidato por varios motivos ao mesmo tempo —
 * quente E com intervencao pendente E com tarefa atrasada. Listar tres
 * vezes transformaria a secao em ruido e faria parecer que ha tres
 * problemas quando ha um lead.
 *
 * Ele entra uma vez, com o motivo MAIS URGENTE, e `totalMotivos` conta
 * os demais — assim a informacao nao se perde.
 */
export function priorizarAtencao(
  candidatos: CandidatoAtencao[],
  opcoes: OpcoesAtencao = {}
): ItemAtencao[] {
  const limite = opcoes.limite ?? 20;

  const porLead = new Map<string, { melhor: CandidatoAtencao; total: number }>();

  for (const c of candidatos) {
    const atual = porLead.get(c.leadId);
    if (!atual) {
      porLead.set(c.leadId, { melhor: c, total: 1 });
      continue;
    }
    atual.total += 1;
    if (PRIORIDADE_ATENCAO[c.motivo] < PRIORIDADE_ATENCAO[atual.melhor.motivo]) {
      atual.melhor = c;
    }
  }

  return [...porLead.values()]
    .sort((a, b) => {
      const pa = PRIORIDADE_ATENCAO[a.melhor.motivo];
      const pb = PRIORIDADE_ATENCAO[b.melhor.motivo];
      if (pa !== pb) return pa - pb;
      // Mesma urgencia: quem espera ha mais tempo vem primeiro. Deixar o
      // mais antigo para o fim e como nunca atender quem chegou cedo.
      return a.melhor.em.getTime() - b.melhor.em.getTime();
    })
    .slice(0, limite)
    .map(({ melhor, total }) => ({
      leadId: melhor.leadId,
      nome: melhor.nome,
      categoria: melhor.categoria,
      bairro: melhor.bairro,
      cidade: melhor.cidade,
      temperatura: melhor.temperatura,
      status: melhor.status,
      motivo: melhor.motivo,
      acaoNecessaria: ACAO_ATENCAO[melhor.motivo],
      ultimaMensagem: melhor.ultimaMensagem,
      etapaAtual: melhor.etapaAtual,
      em: melhor.em.toISOString(),
      totalMotivos: total,
    }));
}
