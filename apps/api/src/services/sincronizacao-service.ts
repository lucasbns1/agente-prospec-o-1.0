/**
 * O estado de sincronizacao entre o banco e o WhatsApp.
 *
 * ============================================================
 * A PERGUNTA QUE ISTO RESPONDE
 * ============================================================
 * "Os numeros que estou vendo sao de quando?"
 *
 * Ate agora nao havia como saber. Uma varredura que parou de rodar era
 * indistinguivel de uma que roda e nao acha nada — as duas produzem a
 * mesma tela: zero mensagens novas. E foi assim que duas respostas de um
 * lead ficaram invisiveis por dias, com a cadencia congelada esperando
 * algo que o sistema nunca soube que existia.
 *
 * ============================================================
 * O DASHBOARD NAO CONSULTA O WHATSAPP
 * ============================================================
 * Isto le uma marca no banco, e nada mais. A cadeia e:
 *
 *   WhatsApp -> varredura -> banco -> dashboard
 *
 * Uma tela que fosse ao WhatsApp desenhar um numero ficaria lenta e
 * ainda assim erraria, porque o que ela mostraria nao seria o que o
 * resto do sistema conhece. A varredura e quem mantem o banco honesto;
 * a tela so relata quando isso aconteceu pela ultima vez.
 */
import { prisma } from '@prospector/database';

/** A mesma chave que a varredura grava, do outro lado. */
export const CHAVE_ULTIMA_VARREDURA = 'canal.ultima_varredura';

/** Quantas mensagens novas a ultima varredura trouxe. */
export const CHAVE_RECUPERADAS_NA_ULTIMA = 'canal.ultima_varredura_novas';

/**
 * A partir de quantos minutos sem varredura a tela deve reclamar.
 *
 * O intervalo padrao e 5 minutos. Vinte da folga para uma varredura
 * lenta, um reinicio, ou uma reconexao demorada do Chromium sem gritar a
 * toa — e um alarme que dispara a toa e um alarme que se aprende a
 * ignorar.
 */
export const MINUTOS_ATE_RECLAMAR = 20;

export interface EstadoSincronizacao {
  /** ISO da ultima varredura bem-sucedida. `null` = nunca rodou. */
  ultimaEm: string | null;
  /** Minutos desde entao. `null` quando nunca rodou. */
  minutosAtras: number | null;
  /**
   * true quando faz tempo demais — ou nunca aconteceu.
   *
   * E o sinal de "estes numeros podem estar velhos", e nao um erro: a
   * varredura pode nao ter rodado porque o worker acabou de subir.
   */
  desatualizado: boolean;
  /** Mensagens novas que a ultima varredura trouxe. */
  recuperadasNaUltima: number | null;
}

// O ESTADO DO CANAL NAO ENTRA AQUI, de proposito.
//
// Ele ja e servido por `/api/canal/status`, que le o retrato do Redis e
// ja trata o caso "retrato velho = worker parado". Repetir a leitura
// daria duas fontes para a mesma pergunta, e a hora em que elas
// divergissem seria justamente a hora em que voce precisa confiar nelas.

export async function estadoDaSincronizacao(): Promise<EstadoSincronizacao> {
  const [marca, recuperadas] = await Promise.all([
    prisma.setting.findUnique({
      where: { chave: CHAVE_ULTIMA_VARREDURA },
      select: { valor: true },
    }),
    prisma.setting.findUnique({
      where: { chave: CHAVE_RECUPERADAS_NA_ULTIMA },
      select: { valor: true },
    }),
  ]);

  const recuperadasNaUltima =
    typeof recuperadas?.valor === 'number' ? recuperadas.valor : null;

  const bruto = typeof marca?.valor === 'string' ? marca.valor : null;
  const quando = bruto ? new Date(bruto) : null;

  // Valor corrompido nao pode virar `Invalid Date` e envenenar a conta:
  // toda comparacao com NaN da false, e a tela diria "sincronizado" para
  // sempre.
  if (!quando || Number.isNaN(quando.getTime())) {
    return {
      ultimaEm: null,
      minutosAtras: null,
      desatualizado: true,
      recuperadasNaUltima,
    };
  }

  const minutosAtras = Math.max(
    0,
    Math.floor((Date.now() - quando.getTime()) / 60_000)
  );

  return {
    ultimaEm: quando.toISOString(),
    minutosAtras,
    desatualizado: minutosAtras > MINUTOS_ATE_RECLAMAR,
    recuperadasNaUltima,
  };
}
