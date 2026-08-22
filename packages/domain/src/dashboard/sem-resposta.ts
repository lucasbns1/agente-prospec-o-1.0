/**
 * Quem recebeu e nao respondeu.
 *
 * ============================================================
 * A PERGUNTA QUE ISTO RESPONDE
 * ============================================================
 * "Quem nao respondeu a mensagem 1 ou a 2?"
 *
 * Ela e diferente de tudo que o dashboard ja mostrava. As outras secoes
 * falam de leads que fizeram alguma coisa — responderam, esquentaram,
 * perguntaram preco, travaram. Esta fala do silencio, que e a maioria
 * absoluta de qualquer prospeccao e o unico grupo que nenhuma tela
 * mostrava.
 *
 * ============================================================
 * POR QUE AGRUPAR PELA ULTIMA ETAPA QUE SAIU
 * ============================================================
 * "Nao respondeu a 1" e "nao respondeu a 2" sao situacoes diferentes.
 * Quem ignorou so a abordagem pode nem ter visto; quem recebeu a
 * proposta inteira e ficou calado ja e outra conversa. Juntar os dois
 * num numero so apagaria a distincao que faz voce decidir o que fazer.
 *
 * A etapa do grupo e a MAIOR que saiu para aquele lead — nao a menor,
 * nem a "atual" do vinculo. O vinculo pode estar em qualquer estado por
 * outros motivos; o que importa aqui e ate onde a conversa chegou.
 *
 * ============================================================
 * FUNCAO PURA
 * ============================================================
 * Recebe as linhas ja lidas do banco e devolve os grupos. Sem I/O: a
 * regra de agrupamento da para testar com dados escritos a mao, que e
 * como se confere que "maior etapa" e mesmo maior.
 */

import type { GrupoSemResposta, LeadSemResposta } from '@prospector/shared';

// O contrato (`LeadSemResposta`, `GrupoSemResposta`) mora em `shared`
// porque o frontend precisa dele. Aqui fica so a regra de agrupamento.
export type { GrupoSemResposta, LeadSemResposta };

/** Uma mensagem que saiu para um lead — a entrada do agrupamento. */
export interface EnvioSemResposta {
  leadId: string;
  nome: string | null;
  categoria: string | null;
  bairro: string | null;
  cidade: string | null;
  temperatura: string;
  status: string;
  /** Ordem da etapa que saiu. */
  ordem: number;
  /** Nome da etapa, quando ela tem um. */
  etapaNome: string | null;
  /** Quando saiu. */
  enviadaEm: Date;
}

/**
 * Agrupa por etapa, do mais avancado para o menos.
 *
 * A ordem decrescente e deliberada: quem recebeu a mensagem 2 inteira e
 * ficou calado esta mais perto de uma decisao do que quem ignorou a
 * abordagem. O topo da lista deve ser onde vale gastar seu tempo.
 *
 * Dentro de cada grupo, o mais antigo primeiro — quem espera ha mais
 * tempo aparece antes.
 */
export function agruparSemResposta(envios: EnvioSemResposta[]): GrupoSemResposta[] {
  // Por lead, o envio de maior ordem. Empate na ordem: o mais recente,
  // porque um reenvio da mesma etapa nao muda o grupo e sim quando o
  // silencio comecou.
  const porLead = new Map<string, EnvioSemResposta>();

  for (const e of envios) {
    const atual = porLead.get(e.leadId);
    if (
      !atual ||
      e.ordem > atual.ordem ||
      (e.ordem === atual.ordem && e.enviadaEm > atual.enviadaEm)
    ) {
      porLead.set(e.leadId, e);
    }
  }

  const grupos = new Map<number, GrupoSemResposta>();

  for (const e of porLead.values()) {
    let grupo = grupos.get(e.ordem);
    if (!grupo) {
      grupo = {
        ordem: e.ordem,
        rotulo: e.etapaNome?.trim() || `Mensagem ${e.ordem}`,
        total: 0,
        leads: [],
      };
      grupos.set(e.ordem, grupo);
    }

    grupo.leads.push({
      leadId: e.leadId,
      nome: e.nome,
      categoria: e.categoria,
      bairro: e.bairro,
      cidade: e.cidade,
      temperatura: e.temperatura,
      status: e.status,
      ordem: e.ordem,
      etapaNome: e.etapaNome,
      desde: e.enviadaEm,
    });
    grupo.total += 1;
  }

  for (const g of grupos.values()) {
    g.leads.sort((a, b) => a.desde.getTime() - b.desde.getTime());
  }

  return [...grupos.values()].sort((a, b) => b.ordem - a.ordem);
}
