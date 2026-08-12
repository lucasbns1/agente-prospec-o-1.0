/**
 * Status do WhatsApp.
 *
 * FASE 1: a conexao real nao existe ainda (Fase 8). Estas rotas devolvem
 * o estado do adapter fake, o que ja permite ao Dashboard renderizar o
 * indicador colorido e a faixa de dry-run com dados de verdade — e nao
 * com um valor chumbado no frontend.
 */
import type { FastifyInstance } from 'fastify';
import { criarWhatsAppAdapter, resolverModo } from '@prospector/integrations';
import { exigirAutenticacao } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';

export async function rotasWhatsApp(app: FastifyInstance): Promise<void> {
  const modo = resolverModo(process.env.WHATSAPP_MODE);

  app.get(
    '/api/whatsapp/status',
    { preHandler: exigirAutenticacao },
    async () => ({
      status: 'DESCONECTADO',
      modo,
      dryRun: modo === 'dry-run',
      detalhe:
        modo === 'dry-run'
          ? 'Modo simulacao ativo. Nenhuma mensagem real sera enviada.'
          : 'Modo real. A integracao com whatsapp-web.js entra na Fase 8.',
    })
  );

  app.post(
    '/api/whatsapp/connect',
    { preHandler: exigirAutenticacao },
    async (request) => {
      if (modo === 'live') {
        throw new AppError(
          'A conexao real com o WhatsApp entra na Fase 8. Use WHATSAPP_MODE=dry-run.',
          501,
          'NAO_IMPLEMENTADO'
        );
      }

      const adapter = await criarWhatsAppAdapter({
        modo,
        logger: (m, d) => request.log.info(d ?? {}, m),
      });
      await adapter.connect();

      return { ...adapter.getStatus(), dryRun: true };
    }
  );
}
