/**
 * Ponto de entrada do worker.
 *
 * POR QUE UM PROCESSO SEPARADO DA API:
 * A partir da Fase 8 este processo carrega um Chromium inteiro (o
 * whatsapp-web.js roda sobre o WhatsApp Web). Se ele travar ou vazar
 * memoria, nao pode levar junto a API e o Dashboard. Separando, o CRM
 * continua utilizavel mesmo com o WhatsApp fora do ar.
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarEnv } from '@prospector/config';
import { criarWhatsAppAdapter, resolverModo } from '@prospector/integrations';
import { disconnectPrisma, checkDatabaseConnection } from '@prospector/database';
import pino from 'pino';
import { inicializarFilas, fecharFilas, TODAS_AS_FILAS } from './queues.js';
import { criarWorkerHealth } from './workers/health.js';
import { criarWorkerOutbound } from './workers/outbound.js';
import { iniciarDespachante } from './workers/despachante.js';
import { criarWorkerInbound, enfileirarRecebida } from './workers/inbound.js';
import { fecharPublicador } from './redis.js';
import { publicarEvento } from './events.js';
import { publicarEstadoCanal, publicarQr, limparQr } from './estado-canal.js';
import { WhatsAppWebAdapter } from '@prospector/integrations';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../../.env') });

async function main(): Promise<void> {
  const env = carregarEnv();
  const desenvolvimento = env.NODE_ENV === 'development';

  const log = pino({
    level: env.LOG_LEVEL,
    name: 'worker',
    ...(desenvolvimento
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });

  log.info('Iniciando worker...');

  const bancoOk = await checkDatabaseConnection();
  if (!bancoOk) {
    log.error(
      'Nao foi possivel conectar ao banco. O Docker esta rodando? Tente: docker compose up -d'
    );
    process.exit(1);
  }

  inicializarFilas();
  log.info({ filas: TODAS_AS_FILAS }, `${TODAS_AS_FILAS.length} filas registradas`);

  // --- WhatsApp ---
  const modo = resolverModo(env.WHATSAPP_MODE);
  const adapter = await criarWhatsAppAdapter({
    modo,
    canal: env.WHATSAPP_CANAL,
    sessionPath: env.WHATSAPP_SESSION_PATH,
    chromePath: env.CHROME_PATH,
    logger: (m, d) => log.info(d ?? {}, m),
  });

  // Toda mensagem recebida vai para a fila. O canal so enfileira e volta
  // a escutar — processar aqui seguraria o event loop do cliente do
  // WhatsApp durante consultas ao banco.
  adapter.onMessage(async (m) => {
    try {
      await enfileirarRecebida({
        providerMessageId: m.id,
        chatId: m.chatId,
        telefone: m.telefone,
        texto: m.texto,
        nomeContato: m.nomeContato,
        recebidaEm: m.timestamp,
        deMim: m.deMim,
        tipo: 'chat',
        temMidia: false,
      });
    } catch (err) {
      log.error({ err, providerMessageId: m.id }, 'Falha ao enfileirar mensagem recebida');
    }
  });

  // O estado da conexao vai para a tela por duas vias: o Redis (retrato
  // atual, que a tela consulta) e o SSE (aviso de que mudou). Sem isso o
  // dashboard diria "conectado" enquanto o processo esta caido —
  // exatamente o que nao pode acontecer.
  const publicarEstado = async (): Promise<void> => {
    const s = adapter.getStatus();
    const saude =
      adapter instanceof WhatsAppWebAdapter
        ? adapter.saude()
        : {
            provider: 'simulado',
            autenticado: s.status === 'CONECTADO',
            conectado: s.status === 'CONECTADO',
            ultimoEventoEm: new Date().toISOString(),
            sessaoDesde: null,
            envioRealPermitidoNaFase: false,
            tentativasReconexao: 0,
          };

    await publicarEstadoCanal({
      provider: saude.provider,
      status: s.status,
      autenticado: saude.autenticado,
      conectado: saude.conectado,
      telefone: s.telefone ?? null,
      detalhe: s.detalhe ?? null,
      temQr: Boolean(s.qr),
      ultimoEventoEm: saude.ultimoEventoEm,
      sessaoDesde: saude.sessaoDesde,
      envioRealPermitidoNaFase: saude.envioRealPermitidoNaFase,
      tentativasReconexao: saude.tentativasReconexao,
      atualizadoEm: new Date().toISOString(),
    });

    // O QR NAO viaja por SSE: um evento SSE chega a todas as abas
    // abertas. Ele fica numa chave com TTL curto, lida por uma rota
    // autenticada.
    if (s.qr) await publicarQr(s.qr);
    else await limparQr();

    await publicarEvento('whatsapp.status', {
      status: s.status,
      modo: s.modo,
      temQr: Boolean(s.qr),
      telefone: s.telefone ?? null,
      detalhe: s.detalhe ?? null,
    });
  };

  adapter.onStatusChange(() => void publicarEstado());

  // Heartbeat: republica mesmo sem mudanca, para a API conseguir
  // distinguir "conectado" de "worker morto ha 10 minutos".
  const batimento = setInterval(() => void publicarEstado(), 30_000);

  adapter.onStatusChange((s) => log.info({ status: s.status }, 'Status do WhatsApp mudou'));
  await adapter.connect();

  if (modo === 'dry-run') {
    log.warn(
      '=========================================================\n' +
        '  MODO DRY-RUN ATIVO\n' +
        '  Nenhuma mensagem real sera enviada.\n' +
        '  Para enviar de verdade: WHATSAPP_MODE=live no .env (Fase 8).\n' +
        '========================================================='
    );
  }

  // --- Workers ---
  const workers = [
    criarWorkerHealth(log),
    criarWorkerOutbound(log, adapter),
    criarWorkerInbound(log),
  ];

  for (const w of workers) {
    w.on('failed', (job, err) => {
      log.error({ jobId: job?.id, fila: w.name, err }, 'Job falhou');
    });
    w.on('completed', (job) => {
      log.debug({ jobId: job.id, fila: w.name }, 'Job concluido');
    });
  }

  // O despachante e quem transforma "esta na hora" em job. Sem ele as
  // mensagens agendadas ficariam paradas no banco para sempre.
  const pararDespachante = iniciarDespachante(log);

  await publicarEstado();
  log.info('Worker pronto. Aguardando jobs.');

  // --- Shutdown ---
  let encerrando = false;
  const encerrar = async (sinal: string): Promise<void> => {
    if (encerrando) return;
    encerrando = true;
    log.info({ sinal }, 'Encerrando worker...');
    try {
      // Para de despachar antes de fechar os workers, senao a ultima
      // varredura criaria jobs que ninguem vai consumir.
      pararDespachante();
      clearInterval(batimento);
      // Fecha os workers primeiro: eles terminam o job em andamento antes
      // de parar, para nao deixar trabalho pela metade.
      await Promise.allSettled(workers.map((w) => w.close()));
      await fecharFilas();
      await adapter.disconnect();
      await fecharPublicador();
      await disconnectPrisma();
      log.info('Worker encerrado com sucesso.');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'Erro ao encerrar o worker');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void encerrar('SIGINT'));
  process.on('SIGTERM', () => void encerrar('SIGTERM'));
  process.on('unhandledRejection', (err) => {
    log.error({ err }, 'Promise rejeitada sem tratamento');
  });
}

main().catch((err) => {
  console.error('[FALHA FATAL NO WORKER]', err);
  process.exit(1);
});
