/**
 * Calculo dos delays.
 *
 * Esta e a unica logica de negocio realmente implementada na Fase 1,
 * porque e pequena, pura e serve de prova de que a esteira de testes
 * funciona ponta a ponta.
 *
 * REGRA: o delay NUNCA e fixo. Um intervalo de 3 a 4 minutos significa um
 * valor sorteado a cada transicao, nao 3 minutos cravados toda vez — um
 * intervalo constante entre mensagens e um padrao obvio de automacao.
 */

export interface IntervaloDelay {
  minSegundos: number;
  maxSegundos: number;
}

/**
 * Sorteia um valor em segundos dentro do intervalo, inclusive nas pontas.
 *
 * @param rng funcao de aleatoriedade, injetavel para os testes serem
 *            deterministicos. Por padrao usa Math.random.
 * @throws se o intervalo for invalido — falhar alto e melhor do que
 *         silenciosamente enviar tudo sem espacamento.
 */
export function sortearDelaySegundos(
  intervalo: IntervaloDelay,
  rng: () => number = Math.random
): number {
  const { minSegundos, maxSegundos } = intervalo;

  if (!Number.isFinite(minSegundos) || !Number.isFinite(maxSegundos)) {
    throw new Error('Intervalo de delay invalido: valores precisam ser numeros finitos');
  }
  if (minSegundos < 0 || maxSegundos < 0) {
    throw new Error('Intervalo de delay invalido: valores nao podem ser negativos');
  }
  if (maxSegundos < minSegundos) {
    throw new Error(
      `Intervalo de delay invalido: max (${maxSegundos}s) menor que min (${minSegundos}s)`
    );
  }

  if (minSegundos === maxSegundos) return minSegundos;

  const amplitude = maxSegundos - minSegundos;
  return minSegundos + Math.floor(rng() * (amplitude + 1));
}

/** Mesmo calculo, em milissegundos — formato que o BullMQ espera em `delay`. */
export function sortearDelayMs(
  intervalo: IntervaloDelay,
  rng: () => number = Math.random
): number {
  return sortearDelaySegundos(intervalo, rng) * 1000;
}

/**
 * Converte um delay em um instante futuro.
 * E este valor que vai para `LeadCampaign.proximoEnvioEm`.
 */
export function calcularProximoEnvio(
  intervalo: IntervaloDelay,
  agora: Date = new Date(),
  rng: () => number = Math.random
): Date {
  return new Date(agora.getTime() + sortearDelayMs(intervalo, rng));
}

/**
 * Resolve o intervalo efetivo de uma etapa.
 * A etapa pode sobrescrever o padrao da campanha; se nao sobrescrever
 * (valores nulos), vale o da campanha.
 */
export function resolverIntervalo(
  campanha: IntervaloDelay,
  etapa?: { minSegundos?: number | null; maxSegundos?: number | null } | null
): IntervaloDelay {
  return {
    minSegundos: etapa?.minSegundos ?? campanha.minSegundos,
    maxSegundos: etapa?.maxSegundos ?? campanha.maxSegundos,
  };
}

/** Padroes usados quando nao ha configuracao no banco: 3 a 4 minutos. */
export const DELAY_PADRAO_MENSAGENS: IntervaloDelay = {
  minSegundos: 180,
  maxSegundos: 240,
};

/** Padrao para espacar o primeiro disparo entre leads diferentes. */
export const DELAY_PADRAO_ENTRE_LEADS: IntervaloDelay = {
  minSegundos: 60,
  maxSegundos: 180,
};
