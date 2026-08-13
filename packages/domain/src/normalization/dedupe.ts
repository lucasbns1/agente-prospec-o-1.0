/**
 * Calculo da chave de deduplicacao.
 *
 * A chave e gravada em `Lead.chaveDedupe`, que tem constraint UNIQUE.
 * Isso faz o BANCO garantir a unicidade — nao a aplicacao. Uma checagem
 * "existe?" seguida de "cria" nao e atomica e falharia sob concorrencia
 * (foi exatamente esse o bug encontrado na auditoria da Fase 1).
 *
 * PRIORIDADES (a primeira que puder ser calculada vence):
 *   1. telefone normalizado
 *   2. nome + endereco
 *   3. nome + cidade
 *
 * Se nenhuma puder ser calculada, a chave e `null` e o lead entra sem
 * protecao de duplicidade — melhor do que agrupar registros diferentes
 * sob uma chave fraca.
 */
import { createHash } from 'node:crypto';
import { normalizarParaComparacao } from './texto.js';

export type CriterioDedupe = 'TELEFONE' | 'NOME_ENDERECO' | 'NOME_CIDADE';

export interface ChaveDedupe {
  chave: string | null;
  criterio: CriterioDedupe | null;
  /** Texto legivel do que gerou a chave — vai para o relatorio. */
  base: string | null;
}

export interface DadosDedupe {
  telefoneNormalizado: string | null;
  nomeCompleto: string | null;
  enderecoOriginal: string | null;
  logradouro: string | null;
  numero: string | null;
  cidade: string | null;
}

function hash(prefixo: CriterioDedupe, base: string): string {
  const digest = createHash('sha256').update(base).digest('hex').slice(0, 32);
  return `${prefixo.toLowerCase()}:${digest}`;
}

/**
 * Calcula a chave de deduplicacao de um lead.
 *
 * O nome sozinho NUNCA e suficiente: "Clinica Sorriso" existe em toda
 * cidade do Brasil. Por isso a prioridade 3 exige nome E cidade.
 */
export function calcularChaveDedupe(dados: DadosDedupe): ChaveDedupe {
  // --- Prioridade 1: telefone ---
  if (dados.telefoneNormalizado) {
    return {
      chave: hash('TELEFONE', dados.telefoneNormalizado),
      criterio: 'TELEFONE',
      base: dados.telefoneNormalizado,
    };
  }

  const nome = normalizarParaComparacao(dados.nomeCompleto);
  if (nome === '') {
    return { chave: null, criterio: null, base: null };
  }

  // --- Prioridade 2: nome + endereco ---
  // Preferimos logradouro+numero (ja normalizados) ao endereco cru, que
  // varia em pontuacao entre exportacoes da mesma ficha.
  const enderecoEstruturado =
    dados.logradouro && dados.numero
      ? `${dados.logradouro} ${dados.numero}`
      : null;
  const endereco = normalizarParaComparacao(
    enderecoEstruturado ?? dados.enderecoOriginal
  );

  if (endereco !== '') {
    const base = `${nome}|${endereco}`;
    return { chave: hash('NOME_ENDERECO', base), criterio: 'NOME_ENDERECO', base };
  }

  // --- Prioridade 3: nome + cidade ---
  const cidade = normalizarParaComparacao(dados.cidade);
  if (cidade !== '') {
    const base = `${nome}|${cidade}`;
    return { chave: hash('NOME_CIDADE', base), criterio: 'NOME_CIDADE', base };
  }

  // Sem telefone, sem endereco e sem cidade: nao ha base confiavel.
  return { chave: null, criterio: null, base: null };
}
