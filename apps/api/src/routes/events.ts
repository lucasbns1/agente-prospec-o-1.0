/**
 * GET /api/events — canal SSE unico do sistema.
 *
 * O frontend abre UMA conexao e recebe todos os tipos de evento. Cada
 * evento carrega um `tipo`, e o cliente decide o que invalidar no
 * TanStack Query. Um canal so evita multiplicar conexoes por tela.
 *
 * Detalhes de implementacao que importam:
 *  - heartbeat a cada 25s: proxies e o proprio navegador derrubam
 *    conexoes ociosas; o ping mantem o canal vivo.
 *  - `retry: 5000` instrui o EventSource a reconectar em 5s se cair.
 *  - o listener e removido no `close` — sem isso cada refresh da pagina
 *    deixaria um listener orfao acumulando no processo.
 */
import type { FastifyInstance } from 'fastify';
import { CANAL_EVENTOS, eventsBus, formatarSSE } from '../lib/events-bus.js';
import { getRedisSubscriber } from '../lib/redis.js';
import { exigirAutenticacao } from '../plugins/auth.js';
import type { AppEvent } from '@prospector/shared';

const HEARTBEAT_MS = 25_000;

export async function rotasEvents(app: FastifyInstance): Promise<void> {
  // Ponte worker -> API. O worker publica no canal Redis; a API repassa
  // para os clientes SSE conectados.
  const assinante = getRedisSubscriber();
  await assinante.subscribe(CANAL_EVENTOS).catch((err) => {
    app.log.error({ err }, 'Falha ao assinar o canal de eventos do Redis');
  });

  assinante.on('message', (canal, payload) => {
    if (canal !== CANAL_EVENTOS) return;
    try {
      const evento = JSON.parse(payload) as AppEvent;
      eventsBus.emit('evento', evento);
    } catch (err) {
      app.log.warn({ err, payload }, 'Evento invalido recebido do worker');
    }
  });

  app.get('/api/events', { preHandler: exigirAutenticacao }, (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Desativa buffering em proxies que possam existir no caminho.
      'X-Accel-Buffering': 'no',
    });

    reply.raw.write('retry: 5000\n\n');
    reply.raw.write(
      formatarSSE({
        tipo: 'heartbeat',
        em: new Date().toISOString(),
        dados: { conectado: true },
      })
    );

    const desinscrever = eventsBus.inscrever((evento) => {
      try {
        reply.raw.write(formatarSSE(evento));
      } catch (err) {
        request.log.warn({ err }, 'Falha ao escrever evento SSE');
      }
    });

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: ping\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, HEARTBEAT_MS);

    const encerrar = (): void => {
      clearInterval(heartbeat);
      desinscrever();
    };

    request.raw.on('close', encerrar);
    request.raw.on('error', encerrar);
  });
}
