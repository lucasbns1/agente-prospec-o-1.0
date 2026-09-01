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
import { criarWhatsAppAdapter, FASE_PERMITE_ENVIO_REAL } from '@prospector/integrations';
import { disconnectPrisma, checkDatabaseConnection } from '@prospector/database';
import pino from 'pino';
import { inicializarFilas, fecharFilas, TODAS_AS_FILAS } from './queues.js';
import { criarWorkerHealth } from './workers/health.js';
import { criarWorkerOutbound } from './workers/outbound.js';
import { iniciarDespachante } from './workers/despachante.js';
import { criarWorkerInbound, enfileirarRecebida } from './workers/inbound.js';
import { criarWorkerOrquestracao } from './workers/orquestracao.js';
import { criarAnalisador } from '@prospector/integrations';
import { configurarIA } from './services/gatilhos-ia.js';
import { iniciarReconciliacao } from './services/reconciliacao.js';
import { processarConfirmacaoEntrega } from './services/inbound.js';
import {
  iniciarVarreduraPeriodica,
  varrerAgora,
} from './services/varredura-periodica.js';
import { criarWorkerReconciliacaoWhatsApp } from './workers/reconciliacao-whatsapp.js';
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
            options: {
              colorize: true,
              // O prefixo `SYS:` e o que faz o pino-pretty usar o fuso da
              // maquina. Sem ele o horario sai em UTC — e um log tres horas
              // adiantado em relacao a tela faz voce procurar o evento errado
              // quando estiver comparando os dois.
              translateTime: 'SYS:HH:MM:ss',
              ignore: 'pid,hostname',
            },
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

  // ============================================================
  // ORQUESTRACAO POR IA (Fase 9)
  // ============================================================
  // Opcional e desligada por padrao. Sem chave ou com GEMINI_ENABLED
  // ausente, `criarAnalisadorGemini` devolve null e o sistema inteiro se
  // comporta como antes desta fase — sem chamada de rede, sem custo.
  //
  // A chave e lida SO AQUI, no processo do worker. Ela nao e passada
  // adiante, nao vai para o log e nao entra no banco.
  const analisadorIa = await criarAnalisador({
    GEMINI_ENABLED: env.GEMINI_ENABLED,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GEMINI_MODEL: env.GEMINI_MODEL,
    GEMINI_TIMEOUT_MS: env.GEMINI_TIMEOUT_MS,
  });

  configurarIA({
    analisador: analisadorIa,
    somenteAnalise: env.AI_ANALYSIS_ONLY,
    log,
  });

  if (!analisadorIa) {
    log.info(
      { motivo: env.GEMINI_ENABLED ? 'GEMINI_API_KEY vazia' : 'GEMINI_ENABLED=false' },
      'IA desligada — a cadencia e comandada pelo motor deterministico'
    );
  } else if (env.AI_ANALYSIS_ONLY) {
    log.warn(
      { modelo: env.GEMINI_MODEL },
      'IA em MODO SOMBRA — ela analisa e recomenda, mas quem comanda a cadencia ' +
        'e o motor deterministico. As divergencias vao para a tabela ai_decisions.'
    );
  } else {
    log.warn(
      { modelo: env.GEMINI_MODEL },
      'IA ATIVA — as decisoes dela comandam a cadencia (sempre filtradas pela guarda ' +
        'e pelas barreiras de envio).'
    );
  }

  // --- WhatsApp ---
  const adapter = await criarWhatsAppAdapter({
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

  // Confirmacoes de entrega. So o WhatsAppWebAdapter emite este evento;
  // o adapter simulado nao tem o barramento interno.
  if (adapter instanceof WhatsAppWebAdapter) {
    adapter.ouvirCanal(async (evento) => {
      if (evento.tipo !== 'canal.confirmacao_entrega') return;
      if (!evento.providerMessageId || evento.ack === undefined) return;

      try {
        const r = await processarConfirmacaoEntrega({
          providerMessageId: evento.providerMessageId,
          ack: evento.ack,
        });
        if (r.aplicado) {
          log.info(
            { providerMessageId: evento.providerMessageId, estado: r.estado },
            'Confirmacao de entrega aplicada'
          );
        }
      } catch (err) {
        // Uma confirmacao perdida nao pode derrubar a conexao.
        log.error({ err }, 'Falha ao processar confirmacao de entrega');
      }
    });
  }

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
            // A trava de FASE e a mesma constante para os dois adapters —
            // ela fala do codigo, nao de quem esta conectado.
            //
            // Aqui ficava `false` fixo, e o efeito era uma mentira na
            // tela: com o canal simulado, a faixa acusava "envio travado
            // no codigo" enquanto a trava estava aberta. O motivo real e
            // outro — o canal e falso — e e `provider` quem diz isso.
            envioRealPermitidoNaFase: FASE_PERMITE_ENVIO_REAL,
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

  // ============================================================
  // VARREDURA NA CONEXAO — respostas que chegaram sem ninguem ouvindo
  // ============================================================
  // O evento `message` so existe ao vivo. Toda vez que o worker esteve
  // fora do ar — reinicio, `git pull`, queda do Chromium, computador
  // dormindo — as respostas daquele intervalo nunca foram entregues, e
  // nada as buscava depois.
  //
  // Aconteceu na validacao real: envio 01:18:48, resposta do lead 01:18,
  // worker reiniciando naquele instante. A resposta ficou visivel no
  // WhatsApp e o diagnostico mostrou `RESPOSTAS DELE (0)`. A sequencia
  // morreu sem erro em lugar nenhum.
  //
  // Roda em segundo plano de proposito: ler as conversas leva alguns
  // segundos, e segurar a inicializacao atrasaria as filas e o
  // despachante por causa de um trabalho de recuperacao.
  let jaVarreu = false;
  /** Desliga o timer da varredura. Chamado no encerramento. */
  let pararVarredura: (() => void) | null = null;
  adapter.onStatusChange((s) => {
    if (s.status !== 'CONECTADO' || jaVarreu) return;
    // Uma vez por processo: o status oscila em reconexoes curtas, e
    // varrer a cada oscilacao releria as mesmas conversas.
    jaVarreu = true;

    void (async () => {
      try {
        // `CONECTADO` significa "a sessao autenticou", nao "a pagina
        // terminou de carregar". Varrer no mesmo segundo derrubava a
        // recuperacao com um erro opaco vindo de dentro do Chromium —
        // literalmente `message: "r"`, porque o codigo da pagina esta
        // minificado.
        //
        // O provedor ja tenta de novo por conta propria; esta espera
        // evita gastar as tentativas com uma pagina que ainda esta
        // subindo. Nada depende de a varredura ser imediata: ela busca
        // o que ficou para tras, nao o que esta chegando agora.
        //
        // Eram 10s. Numa maquina real, com uma conta cheia de conversas,
        // a varredura da conexao falhou DUAS vezes seguidas mesmo com as
        // tentativas do provedor — a pagina simplesmente demora mais do
        // que isso para ficar utilizavel. Vinte segundos nao custam nada
        // aqui (ninguem espera por esta linha) e poupam metade das
        // tentativas, que so produziriam log de erro.
        await new Promise((r) => setTimeout(r, 20_000));

        await varrerAgora({
          adapter,
          log,
          janelaHoras: env.WHATSAPP_RECONCILIATION_WINDOW_HOURS,
          origem: 'conexao',
        });

        // ============================================================
        // E A PARTIR DAQUI ELA SE REPETE
        // ============================================================
        // Rodar uma vez so era o buraco: worker que cai na sexta e volta
        // na segunda perdia o fim de semana inteiro. O timer sobe depois
        // da primeira varredura, e nao antes, para as duas nao
        // disputarem a mesma pagina do Chromium que acabou de carregar.
        pararVarredura = iniciarVarreduraPeriodica({
          adapter,
          log,
          intervaloMinutos: env.WHATSAPP_RECONCILIATION_INTERVAL_MINUTES,
          janelaHoras: env.WHATSAPP_RECONCILIATION_WINDOW_HOURS,
        });
      } catch (err) {
        // Recuperacao nao e caminho critico: falhar aqui nao pode
        // impedir o worker de atender o que vier ao vivo.
        log.error({ err }, 'Falha na varredura de mensagens perdidas');
      }
    })();
  });

  await adapter.connect();

  if (!FASE_PERMITE_ENVIO_REAL) {
    log.warn(
      '=========================================================\n' +
        '  GUARDA DE FASE LEVANTADA\n' +
        '  Nenhuma mensagem real sera enviada por caminho nenhum.\n' +
        '  Destravar exige editar FASE_PERMITE_ENVIO_REAL em\n' +
        '  packages/integrations/src/whatsapp/guarda-envio.ts.\n' +
        '========================================================='
    );
  } else {
    log.info(
      'Envio real LIBERADO no codigo. Quem simula agora e a campanha ' +
        '(caixa "simulacao" nas configuracoes).'
    );
  }

  // --- Workers ---
  const workers = [
    criarWorkerHealth(log),
    criarWorkerOutbound(log, adapter),
    criarWorkerInbound(log),
    // Consome os pedidos que a API enfileira quando voce libera uma
    // intervencao. Sem ele, o gatilho OPERADOR_LIBEROU existia so no tipo.
    criarWorkerOrquestracao(log),
    // Consome os pedidos de "buscar o que faltou" que a API enfileira.
    // A sessao do WhatsApp mora aqui, entao a varredura tem que rodar
    // aqui — a API so pede.
    criarWorkerReconciliacaoWhatsApp(adapter, log),
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

  // A rede de seguranca: uma vez por hora ela confere se o que o banco
  // acha que aconteceu bate com o que aconteceu. Nao conserta nada
  // sozinha — a unica excecao e cancelar mensagem pendente de lead em
  // opt-out, que nao tem cenario em que deixar la seja certo.
  const pararReconciliacao = iniciarReconciliacao(log);

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
      pararReconciliacao();
      pararVarredura?.();
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
