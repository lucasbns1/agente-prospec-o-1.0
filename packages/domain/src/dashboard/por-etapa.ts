/**
 * Quantos leads estao em cada etapa da cadencia.
 *
 * ============================================================
 * O PEDIDO
 * ============================================================
 * "Coloque também: clientes etapa tal / clientes etapa tal."
 *
 * O dashboard sabia dizer quantos leads existem, quantos estao quentes e
 * quantos fecharam. Nao sabia dizer a coisa mais simples de todas: onde a
 * sua prospeccao ESTA. Vinte pessoas paradas na mensagem 1 e vinte
 * espalhadas ate a 4 sao duas semanas completamente diferentes, e os dois
 * numeros que o painel mostrava eram identicos nos dois casos.
 *
 * ============================================================
 * "ESTA NA ETAPA N" E A MAIOR QUE SAIU
 * ============================================================
 * Nao e a etapa atual do vinculo — o vinculo pode estar PAUSADO,
 * AGUARDANDO_INTERVENCAO ou qualquer outra coisa por motivos que nao
 * dizem ate onde a conversa foi.
 *
 * E nao e "toda etapa que recebeu": contar assim colocaria todo mundo na
 * etapa 1, que e a unica por onde todos passaram, e a lista deixaria de
 * mostrar movimento.
 *
 * A mesma regra ja vale em "nao responderam" e no relatorio semanal. Tres
 * telas contando "onde o lead esta" de tres jeitos diferentes seria pior
 * do que nao ter as tres.
 *
 * FUNCAO PURA. Recebe as linhas ja lidas, devolve os numeros.
 */

import type { EtapaComLeads } from '@prospector/shared';

// O contrato mora em `shared` porque o frontend precisa dele:
// `apps/web` depende de `shared` e nao de `domain`. Mesmo arranjo do
// `GrupoSemResposta`.
export type { EtapaComLeads };

/** Um envio que ja saiu, reduzido ao que a contagem precisa. */
export interface EnvioPorEtapa {
  leadId: string;
  ordem: number;
  etapaNome: string | null;
}

/**
 * Conta, em ordem crescente de etapa.
 *
 * Crescente e nao decrescente: aqui a leitura e "como a fila anda", e ela
 * anda da 1 para a frente. (Em "nao responderam" a ordem e a inversa de
 * proposito — la a pergunta e onde vale gastar seu tempo primeiro.)
 *
 * Etapas por onde ninguem passou nao aparecem: uma linha "Mensagem 5: 0"
 * numa campanha que nunca chegou la e ruido, e nao informacao.
 */
export function contarLeadsPorEtapa(envios: EnvioPorEtapa[]): EtapaComLeads[] {
  const maior = new Map<string, EnvioPorEtapa>();

  for (const e of envios) {
    const atual = maior.get(e.leadId);
    if (!atual || e.ordem > atual.ordem) maior.set(e.leadId, e);
  }

  const etapas = new Map<number, EtapaComLeads>();

  for (const e of maior.values()) {
    const atual = etapas.get(e.ordem) ?? {
      ordem: e.ordem,
      rotulo: e.etapaNome?.trim() || `Mensagem ${e.ordem}`,
      leads: 0,
    };
    atual.leads += 1;
    etapas.set(e.ordem, atual);
  }

  return [...etapas.values()].sort((a, b) => a.ordem - b.ordem);
}
