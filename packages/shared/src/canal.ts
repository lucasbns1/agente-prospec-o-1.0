/**
 * Estado do canal compartilhado entre worker e API.
 *
 * ============================================================
 * POR QUE ISSO PRECISA DE UMA PONTE
 * ============================================================
 * Quem segura a conexao com o WhatsApp e o WORKER — e nele que o
 * Chromium vive. Quem responde ao navegador e a API, noutro processo.
 * Sem uma ponte, a tela de configuracao nao teria como saber se o canal
 * esta conectado, e o jeito facil (a API abrir a propria conexao) daria
 * duas sessoes disputando o mesmo numero.
 *
 * A ponte e o Redis, que ja existe por causa do BullMQ.
 *
 * ============================================================
 * O QR TEM TTL CURTO DE PROPOSITO
 * ============================================================
 * Um QR do WhatsApp Web vale poucos segundos e da acesso a conta. Se
 * ficasse guardado sem expirar, uma leitura tardia entregaria um codigo
 * morto — ou, pior, um codigo vivo para quem nao deveria. Guardamos com
 * expiracao curta e nunca em banco.
 */
import type { WhatsAppStatus } from './enums.js';

export const CHAVE_ESTADO_CANAL = 'prospector:canal:estado';
export const CHAVE_QR_CANAL = 'prospector:canal:qr';

/** Segundos que o QR sobrevive no Redis. */
export const TTL_QR_SEGUNDOS = 60;

export interface EstadoCanal {
  provider: string;
  status: WhatsAppStatus;
  autenticado: boolean;
  conectado: boolean;
  /** Telefone da conta conectada. */
  telefone: string | null;
  detalhe: string | null;
  /** true quando ha um QR disponivel para leitura na rota propria. */
  temQr: boolean;
  ultimoEventoEm: string | null;
  sessaoDesde: string | null;
  /** A trava de fase. false = nenhum envio real e possivel. */
  envioRealPermitidoNaFase: boolean;
  tentativasReconexao: number;
  /** Quando este retrato foi escrito. Detecta worker parado. */
  atualizadoEm: string;
}

/**
 * Estado quando o worker nao esta publicando nada.
 *
 * Nunca dizer "conectado" na duvida: um dashboard que mostra conectado
 * enquanto o processo esta morto e pior do que um que mostra
 * desconectado — porque voce so descobre quando a mensagem nao chega.
 */
export const ESTADO_CANAL_DESCONHECIDO: EstadoCanal = {
  provider: 'nenhum',
  status: 'DESCONECTADO',
  autenticado: false,
  conectado: false,
  telefone: null,
  detalhe: 'O worker não está publicando estado. Ele está rodando?',
  temQr: false,
  ultimoEventoEm: null,
  sessaoDesde: null,
  envioRealPermitidoNaFase: false,
  tentativasReconexao: 0,
  atualizadoEm: new Date(0).toISOString(),
};

/**
 * Depois de quantos segundos sem atualizacao o estado e considerado
 * velho. O worker republica a cada mudanca e num heartbeat proprio.
 */
export const SEGUNDOS_ESTADO_VELHO = 90;

export function estadoEstaVelho(
  estado: EstadoCanal,
  agora: Date = new Date()
): boolean {
  const t = new Date(estado.atualizadoEm).getTime();
  if (Number.isNaN(t)) return true;
  return agora.getTime() - t > SEGUNDOS_ESTADO_VELHO * 1000;
}
