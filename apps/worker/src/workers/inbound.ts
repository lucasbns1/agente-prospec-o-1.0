/**
 * Recebimento — liga o canal ao pipeline.
 *
 * ============================================================
 * POR QUE PASSAR PELA FILA E NAO PROCESSAR DIRETO
 * ============================================================
 * O adapter entrega a mensagem dentro do callback de evento do
 * `whatsapp-web.js`. Processar ali significaria segurar o event loop do
 * cliente do WhatsApp durante consultas ao banco, classificacao e
 * escritas. Uma consulta lenta viraria atraso na conexao; um erro nao
 * tratado derrubaria a sessao.
 *
 * Enfileirar desacopla: o canal so precisa colocar o envelope na fila e
 * voltar a escutar. Se o processamento falhar, o BullMQ tenta de novo —
 * e a idempotencia por `provider_message_id` garante que retentar nao
 * duplica nada.
 */
import { Worker, type Job } from 'bullmq';
import { QUEUES } from '@prospector/shared';
import type { MensagemEntrada } from '@prospector/integrations';
import type { Logger } from 'pino';
import { opcoesRedis } from '../redis.js';
import { getFila, OPCOES_JOB_PADRAO } from '../queues.js';
import { processarMensagemRecebida } from '../services/inbound.js';

export interface InboundJobData {
  mensagem: {
    providerMessageId: string;
    chatId: string;
    telefone: string;
    texto: string;
    nomeContato: string | null;
    recebidaEmISO: string;
    tipo: string;
    temMidia: boolean;
  };
}

/** Coloca a mensagem na fila. Chamado pelo ouvinte do canal. */
export async function enfileirarRecebida(m: MensagemEntrada): Promise<void> {
  await getFila(QUEUES.PROCESS_INCOMING_MESSAGE).add(
    'processar',
    {
      mensagem: {
        providerMessageId: m.providerMessageId,
        chatId: m.chatId,
        telefone: m.telefone,
        texto: m.texto,
        nomeContato: m.nomeContato,
        recebidaEmISO: m.recebidaEm.toISOString(),
        tipo: m.tipo,
        temMidia: m.temMidia,
      },
    } satisfies InboundJobData,
    {
      ...OPCOES_JOB_PADRAO,
      // jobId no id do provedor: se o evento chegar duas vezes do
      // WhatsApp, o BullMQ descarta o segundo antes de qualquer trabalho.
      // Nao substitui a constraint UNIQUE do banco — soma com ela.
      jobId: `inbound-${m.providerMessageId}`,
    }
  );
}

export function criarWorkerInbound(log: Logger): Worker<InboundJobData> {
  return new Worker<InboundJobData>(
    QUEUES.PROCESS_INCOMING_MESSAGE,
    async (job: Job<InboundJobData>) => {
      const { mensagem } = job.data;

      const r = await processarMensagemRecebida({
        providerMessageId: mensagem.providerMessageId,
        chatId: mensagem.chatId,
        telefone: mensagem.telefone,
        texto: mensagem.texto,
        nomeContato: mensagem.nomeContato,
        recebidaEm: new Date(mensagem.recebidaEmISO),
        deMim: false,
        tipo: mensagem.tipo,
        temMidia: mensagem.temMidia,
      });

      // O telefone NAO entra no log: e dado pessoal, e o log e lido em
      // tela compartilhada e colado em issue.
      log.info(
        {
          providerMessageId: mensagem.providerMessageId,
          processada: r.processada,
          leadId: r.leadId ?? null,
          categoria: r.categoria ?? null,
          confianca: r.confianca ?? null,
          acao: r.acao ?? null,
        },
        r.processada ? 'Mensagem recebida processada' : 'Mensagem já processada'
      );

      return r;
    },
    {
      connection: opcoesRedis(),
      // Concorrencia 1: duas mensagens do MESMO lead processadas em
      // paralelo poderiam aplicar efeitos conflitantes (uma marca
      // opt-out, a outra avanca a etapa). O volume aqui e baixo — uma
      // pessoa digitando —, entao serializar nao custa nada.
      concurrency: 1,
    }
  );
}
