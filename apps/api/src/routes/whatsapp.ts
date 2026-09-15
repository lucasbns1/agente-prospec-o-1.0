/**
 * Status do WhatsApp e troca de numero.
 *
 * A conexao real chega na Fase 8. O que ja e real aqui e a CAMADA DE SLOTS:
 * qual numero esta selecionado, onde ficam as credenciais de cada um e se
 * cada slot ja foi autenticado. Isso vive no disco, nao em memoria, entao
 * sobrevive a restart do processo — e e exatamente o que o adapter da Fase 8
 * precisa receber (`sessionPath`) para subir no numero certo.
 */
import type { FastifyInstance } from 'fastify';
import {
  apagarSessaoDoSlot,
  caminhoDoSlot,
  criarWhatsAppAdapter,
  ehSlotValido,
  gravarSlotAtivo,
  lerSlotAtivo,
  listarSlots,
  resolverModo,
  type SlotId,
} from '@prospector/integrations';
import { exigirAutenticacao } from '../plugins/auth.js';
import { AppError, ValidacaoError } from '../lib/errors.js';

export async function rotasWhatsApp(app: FastifyInstance): Promise<void> {
  const modo = resolverModo(process.env.WHATSAPP_MODE);
  const baseSessao = process.env.WHATSAPP_SESSION_PATH ?? './data/whatsapp';

  /** Extrai e valida o :id da rota. */
  function slotDaRota(params: unknown): SlotId {
    const id = (params as { id?: string }).id;
    if (!ehSlotValido(id)) {
      throw new ValidacaoError(
        `Slot invalido: "${String(id)}". Os slots disponiveis sao 1 e 2.`
      );
    }
    return Number(id) as SlotId;
  }

  app.get(
    '/api/whatsapp/status',
    { preHandler: exigirAutenticacao },
    async () => {
      const slotAtivo = await lerSlotAtivo(baseSessao);
      return {
        status: 'DESCONECTADO',
        modo,
        dryRun: modo === 'dry-run',
        slotAtivo,
        detalhe:
          modo === 'dry-run'
            ? 'Modo simulacao ativo. Nenhuma mensagem real sera enviada.'
            : 'Modo real. A integracao com whatsapp-web.js entra na Fase 8.',
      };
    }
  );

  /** Os dois numeros, com qual esta ativo e qual ja dispensa QR Code. */
  app.get(
    '/api/whatsapp/slots',
    { preHandler: exigirAutenticacao },
    async () => ({ slots: await listarSlots(baseSessao) })
  );

  /**
   * Troca o numero em uso.
   *
   * Grava o slot ANTES de conectar: se a conexao falhar no meio, o sistema
   * tem que voltar tentando o numero que o usuario escolheu, e nao o
   * anterior — senao a tela diz um numero e o worker usa outro.
   */
  app.post(
    '/api/whatsapp/slots/:id/connect',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const id = slotDaRota(request.params);
      await gravarSlotAtivo(baseSessao, id);

      if (modo === 'live') {
        throw new AppError(
          'A conexao real com o WhatsApp entra na Fase 8. ' +
            `O numero ${id} ja fica selecionado para quando ela existir.`,
          501,
          'NAO_IMPLEMENTADO'
        );
      }

      const adapter = await criarWhatsAppAdapter({
        modo,
        sessionPath: caminhoDoSlot(baseSessao, id),
        logger: (m, d) => request.log.info(d ?? {}, m),
      });
      await adapter.connect();

      return { ...adapter.getStatus(), slotAtivo: id, dryRun: true };
    }
  );

  /**
   * Esquece as credenciais de um slot — o proximo connect dele pede QR.
   *
   * E o botao de saida quando a sessao corrompe (o "Connection Failure" que
   * nao para de se repetir). Nao mexe no outro slot.
   */
  app.post(
    '/api/whatsapp/slots/:id/logout',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const id = slotDaRota(request.params);
      await apagarSessaoDoSlot(baseSessao, id);
      request.log.warn({ slot: id }, 'sessao do slot apagada a pedido do usuario');
      return { slots: await listarSlots(baseSessao) };
    }
  );

  app.post(
    '/api/whatsapp/connect',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const id = await lerSlotAtivo(baseSessao);

      if (modo === 'live') {
        throw new AppError(
          'A conexao real com o WhatsApp entra na Fase 8. Use WHATSAPP_MODE=dry-run.',
          501,
          'NAO_IMPLEMENTADO'
        );
      }

      const adapter = await criarWhatsAppAdapter({
        modo,
        sessionPath: caminhoDoSlot(baseSessao, id),
        logger: (m, d) => request.log.info(d ?? {}, m),
      });
      await adapter.connect();

      return { ...adapter.getStatus(), slotAtivo: id, dryRun: true };
    }
  );
}
