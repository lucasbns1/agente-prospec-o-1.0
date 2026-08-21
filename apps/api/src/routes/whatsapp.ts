/**
 * Status do WhatsApp — rota antiga, da Fase 1.
 *
 * ============================================================
 * SUPERSEDIDA POR `/api/canal/*`
 * ============================================================
 * Nasceu quando a conexao real nao existia e o Dashboard precisava de um
 * status vindo do servidor em vez de um valor chumbado no frontend. Hoje
 * quem responde por conexao, QR e saude do canal e `routes/canal.ts`; o
 * frontend nao chama mais nada daqui.
 *
 * Continua montada porque e barata e porque pode haver script apontando
 * para ela. O que ela NAO faz mais e falar em "modo": o modo global de
 * envio foi removido do sistema, e o que sobrou de trava global e a
 * guarda de fase, no codigo.
 */
import type { FastifyInstance } from 'fastify';
import { criarWhatsAppAdapter, FASE_PERMITE_ENVIO_REAL } from '@prospector/integrations';
import { exigirAutenticacao } from '../plugins/auth.js';

export async function rotasWhatsApp(app: FastifyInstance): Promise<void> {
  app.get('/api/whatsapp/status', { preHandler: exigirAutenticacao }, async () => ({
    status: 'DESCONECTADO',
    envioRealPermitido: FASE_PERMITE_ENVIO_REAL,
    detalhe: FASE_PERMITE_ENVIO_REAL
      ? 'Envio real liberado no codigo. Quem simula agora e a campanha.'
      : 'Guarda de fase levantada: nenhum caminho do codigo envia de verdade.',
    substituidaPor: '/api/canal/status',
  }));

  app.post('/api/whatsapp/connect', { preHandler: exigirAutenticacao }, async (request) => {
    const adapter = await criarWhatsAppAdapter({
      logger: (m, d) => request.log.info(d ?? {}, m),
    });
    await adapter.connect();

    return adapter.getStatus();
  });
}
