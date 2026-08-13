/**
 * Publica o estado do canal para a API ler.
 *
 * O worker segura a conexao; a API responde ao navegador. Esta e a
 * ponte entre os dois — ver `packages/shared/src/canal.ts` para o
 * porque.
 */
import {
  CHAVE_ESTADO_CANAL,
  CHAVE_QR_CANAL,
  TTL_QR_SEGUNDOS,
  type EstadoCanal,
} from '@prospector/shared';
import { getPublicador } from './redis.js';

export async function publicarEstadoCanal(estado: EstadoCanal): Promise<void> {
  await getPublicador().set(CHAVE_ESTADO_CANAL, JSON.stringify(estado));
}

/**
 * Guarda o QR com expiracao curta.
 *
 * Um QR do WhatsApp Web da acesso a conta e vale poucos segundos.
 * Guardar sem TTL entregaria, numa leitura tardia, um codigo morto — ou
 * um codigo vivo para quem nao deveria ter.
 */
export async function publicarQr(qr: string): Promise<void> {
  await getPublicador().set(CHAVE_QR_CANAL, qr, 'EX', TTL_QR_SEGUNDOS);
}

export async function limparQr(): Promise<void> {
  await getPublicador().del(CHAVE_QR_CANAL);
}
