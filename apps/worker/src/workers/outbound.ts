/**
 * Worker de envio (Fase I).
 *
 * ============================================================
 * ESTE WORKER NAO ENVIA NADA DE VERDADE NESTA FASE
 * ============================================================
 * Ele processa a fila inteira — le a mensagem agendada, revalida os
 * bloqueios, chama o adapter e grava o historico — mas o adapter e o
 * `FakeWhatsAppAdapter`, que apenas registra o que TERIA sido enviado.
 *
 * Ha tres barreiras independentes contra envio real:
 *   1. `WHATSAPP_MODE` global precisa ser exatamente "live";
 *   2. `Campaign.dryRun` precisa ser false;
 *   3. o adapter real so existe a partir da fase de integracao.
 *
 * As tres precisam cair juntas. Uma sozinha nao libera nada.
 */
import { Worker, type Job } from 'bullmq';
import { prisma, Prisma } from '@prospector/database';
import type { WhatsAppAdapter } from '@prospector/integrations';
import type { Logger } from 'pino';
import { opcoesRedis } from '../redis.js';
import { publicarEvento } from '../events.js';

export const FILA_OUTBOUND = 'outbound_send';

export interface OutboundJobData {
  outboundMessageId: string;
}

/**
 * Decide se o envio e simulado.
 *
 * Funcao pura de proposito: esta e a regra mais critica do sistema
 * inteiro, e ela precisa poder ser testada sem banco, sem fila e sem
 * WhatsApp.
 *
 * A logica e "E" para enviar de verdade e "OU" para simular: basta UMA
 * barreira levantada para nada sair. Um typo no .env nao pode virar 76
 * mensagens disparadas.
 */
export function decidirDryRun(entrada: {
  campanhaDryRun: boolean;
  mensagemDryRun: boolean;
  modoGlobal: string | undefined;
}): boolean {
  const global = entrada.modoGlobal?.trim().toLowerCase();
  return entrada.campanhaDryRun || entrada.mensagemDryRun || global !== 'live';
}

export interface ResultadoProcessamento {
  ignorado?: boolean;
  motivo?: string;
  status?: string;
  simulado?: boolean;
}

/**
 * Revalida os bloqueios NO MOMENTO DO ENVIO.
 *
 * A mensagem pode ter sido enfileirada horas atras. Nesse intervalo o
 * lead pode ter pedido opt-out, a campanha pode ter sido pausada, a
 * etapa pode ter sido desativada. Confiar no que foi validado no
 * enfileiramento seria enviar com base em informacao velha.
 */
async function revalidar(outboundId: string): Promise<
  | { ok: true; dados: NonNullable<Awaited<ReturnType<typeof carregar>>> }
  | { ok: false; motivo: Prisma.OutboundMessageUpdateInput['motivoBloqueio']; detalhe: string }
> {
  const m = await carregar(outboundId);
  if (!m) return { ok: false, motivo: 'LEAD_BLOQUEADO', detalhe: 'Mensagem nao encontrada' };

  if (m.lead.optOut) {
    return { ok: false, motivo: 'LEAD_OPT_OUT', detalhe: 'Lead pediu opt-out apos o enfileiramento' };
  }
  if (m.lead.status === 'OPT_OUT') {
    return { ok: false, motivo: 'LEAD_OPT_OUT', detalhe: 'Lead esta em opt-out' };
  }
  if (m.lead.status === 'AGUARDANDO_INTERVENCAO') {
    return {
      ok: false,
      motivo: 'LEAD_AGUARDANDO_INTERVENCAO',
      detalhe: 'Lead aguarda intervencao humana',
    };
  }
  if (!m.telefoneDestino) {
    return { ok: false, motivo: 'LEAD_SEM_TELEFONE', detalhe: 'Sem telefone de destino' };
  }
  if (m.campaign.status !== 'ATIVA') {
    return {
      ok: false,
      motivo: 'CAMPANHA_PAUSADA',
      detalhe: `Campanha esta ${m.campaign.status}`,
    };
  }
  if (!m.campaignStep.ativo) {
    return { ok: false, motivo: 'ETAPA_DESATIVADA', detalhe: 'Etapa foi desativada' };
  }
  if (!m.textoRenderizado || m.textoRenderizado.trim() === '') {
    return { ok: false, motivo: 'MENSAGEM_VAZIA', detalhe: 'Mensagem sem texto' };
  }

  return { ok: true, dados: m };
}

function carregar(id: string) {
  return prisma.outboundMessage.findUnique({
    where: { id },
    include: {
      lead: {
        select: {
          id: true, nomeCompleto: true, empresa: true, optOut: true,
          status: true, telefoneNormalizado: true,
        },
      },
      campaign: { select: { id: true, nome: true, status: true, dryRun: true } },
      campaignStep: {
        select: {
          id: true, ordem: true, ativo: true, aguardarResposta: true,
          nome: true, notificarAoChegar: true, notificacaoTexto: true,
        },
      },
    },
  });
}

export function criarWorkerOutbound(
  log: Logger,
  adapter: WhatsAppAdapter
): Worker<OutboundJobData> {
  return new Worker<OutboundJobData>(
    FILA_OUTBOUND,
    async (job: Job<OutboundJobData>): Promise<ResultadoProcessamento> => {
      const { outboundMessageId } = job.data;

      // --- Idempotencia na execucao ---
      //
      // A reserva e um UPDATE CONDICIONAL: so pega a mensagem se ela
      // ainda estiver AGENDADA/PENDENTE. Dois workers competindo pelo
      // mesmo job: um consegue `count: 1`, o outro `count: 0` e desiste.
      // O banco decide, nao a aplicacao.
      const reserva = await prisma.outboundMessage.updateMany({
        where: {
          id: outboundMessageId,
          status: { in: ['PENDENTE', 'AGENDADA'] },
        },
        data: { status: 'PROCESSANDO', tentativas: { increment: 1 } },
      });

      if (reserva.count === 0) {
        log.warn(
          { outboundMessageId, jobId: job.id },
          'Mensagem ja processada ou cancelada — nada a fazer'
        );
        return { ignorado: true, motivo: 'ja_processada' };
      }

      // --- Revalidacao ---
      const check = await revalidar(outboundMessageId);

      if (!check.ok) {
        await prisma.outboundMessage.update({
          where: { id: outboundMessageId },
          data: {
            status: 'BLOQUEADA',
            motivoBloqueio: check.motivo,
            detalheBloqueio: check.detalhe,
            processedAt: new Date(),
          },
        });
        log.warn(
          { outboundMessageId, motivo: check.motivo },
          `Envio bloqueado na revalidacao: ${check.detalhe}`
        );
        return { ignorado: true, motivo: check.detalhe, status: 'BLOQUEADA' };
      }

      const m = check.dados;

      // --- Decide dry-run ---
      //
      // Basta UMA das barreiras estar levantada para nada sair.
      const dryRun = decidirDryRun({
        campanhaDryRun: m.campaign.dryRun,
        mensagemDryRun: m.dryRun,
        modoGlobal: process.env.WHATSAPP_MODE,
      });

      // --- Cria a conversa e a mensagem no historico ---
      const conversa = await prisma.conversation.upsert({
        where: { id: `${m.lead.id}-${m.campaign.id}` },
        update: {},
        create: {
          id: `${m.lead.id}-${m.campaign.id}`,
          leadId: m.lead.id,
          campaignId: m.campaign.id,
          chatId: `${m.telefoneDestino}@c.us`,
        },
      });

      let resultadoEnvio: { sucesso: boolean; whatsappMessageId: string | null; simulado: boolean; erro?: string };

      if (dryRun) {
        // O adapter fake registra e loga. Nada sai.
        resultadoEnvio = await adapter.sendMessage(
          m.telefoneDestino!,
          m.textoRenderizado!
        );
        log.info(
          {
            outboundMessageId,
            lead: m.lead.nomeCompleto,
            telefone: m.telefoneDestino,
            campanha: m.campaign.nome,
            etapa: m.campaignStep.ordem,
          },
          'SIMULACAO — mensagem seria enviada'
        );
      } else {
        // --- Caminho de envio real ---
        //
        // A MESMA chamada do dry-run. Quem decide se sai de verdade e o
        // adapter, que consulta `FASE_PERMITE_ENVIO_REAL` e o modo global
        // por conta propria.
        //
        // Isso e de proposito: se o worker decidisse sozinho, existiriam
        // dois lugares dizendo "pode enviar" — e bastaria um deles estar
        // errado. Aqui a decisao final e sempre do mesmo codigo.
        resultadoEnvio = await adapter.sendMessage(
          m.telefoneDestino!,
          m.textoRenderizado!
        );

        if (resultadoEnvio.simulado) {
          // O worker achou que era envio real, o adapter simulou. Uma
          // barreira que o worker nao enxerga esta levantada — a trava de
          // fase, tipicamente. Registrar como SIMULADA e a verdade.
          log.warn(
            { outboundMessageId, campanha: m.campaign.nome },
            'Envio real pedido, mas a guarda simulou — trava de fase ainda fechada'
          );
        } else {
          log.info(
            {
              outboundMessageId,
              lead: m.lead.nomeCompleto,
              campanha: m.campaign.nome,
              etapa: m.campaignStep.ordem,
              whatsappMessageId: resultadoEnvio.whatsappMessageId,
            },
            'MENSAGEM REAL ENVIADA'
          );
        }
      }

      const mensagem = await prisma.message.create({
        data: {
          conversationId: conversa.id,
          leadId: m.lead.id,
          campaignId: m.campaign.id,
          campaignStepId: m.campaignStep.id,
          direcao: 'ENVIADA',
          // SIMULADA e um estado terminal proprio: NAO conta no limite
          // diario nem nas metricas de "mensagens enviadas".
          status: resultadoEnvio.simulado ? 'SIMULADA' : 'ENVIADA',
          texto: m.textoRenderizado!,
          textoOriginal: m.textoTemplate,
          variaveisUsadas: m.variaveisUsadas as Prisma.InputJsonValue,
          idempotencyKey: m.idempotencyKey,
          whatsappMessageId: resultadoEnvio.whatsappMessageId,
          simulada: resultadoEnvio.simulado,
          enviadaEm: resultadoEnvio.simulado ? null : new Date(),
        },
      });

      await prisma.outboundMessage.update({
        where: { id: outboundMessageId },
        data: {
          status: resultadoEnvio.simulado ? 'SIMULADA' : 'ENVIADA',
          processedAt: new Date(),
          messageId: mensagem.id,
          bullJobId: job.id ?? null,
          dryRun: resultadoEnvio.simulado,
        },
      });

      // --- Move o lead para a coluna desta etapa, no quadro ---
      //
      // Acontece TAMBEM em simulacao, de proposito: o dry-run existe para
      // ensaiar o fluxo inteiro. Se o quadro so andasse com envio real,
      // ele ficaria parado justamente na fase em que voce confere se a
      // sequencia faz sentido.
      //
      // `updateMany` e nao `update`: o vinculo pode nao existir (mensagem
      // enfileirada por uma versao anterior), e falhar aqui perderia o
      // registro de um envio que ja aconteceu.
      await prisma.leadCampaign.updateMany({
        where: { leadId: m.lead.id, campaignId: m.campaign.id },
        data: {
          etapaAtualId: m.campaignStep.id,
          etapaAtualOrdem: m.campaignStep.ordem,
          // Quem decide o proximo estado e a ETAPA, nao o worker: se ela
          // espera resposta, o lead fica aguardando; senao a sequencia
          // segue sozinha.
          status: m.campaignStep.aguardarResposta
            ? 'AGUARDANDO_RESPOSTA'
            : 'EM_ANDAMENTO',
          totalEnviadas: { increment: 1 },
        },
      });

      // --- "Me avise quando alguem chegar nesta etapa" ---
      //
      // Configurado por etapa. E o que transforma um trabalho manual no
      // meio da sequencia ("montar a previa do site deste") em algo que
      // te procura, em vez de depender de voce olhar o quadro.
      //
      // Dispara TAMBEM em simulacao: se so avisasse no envio real, voce
      // descobriria que o aviso nao funciona justamente no dia em que
      // passou a depender dele.
      if (m.campaignStep.notificarAoChegar) {
        const rotuloEtapa =
          m.campaignStep.nome?.trim() || `Mensagem ${m.campaignStep.ordem}`;
        const quem = m.lead.empresa ?? m.lead.nomeCompleto ?? 'Lead sem nome';

        await prisma.notification.create({
          data: {
            leadId: m.lead.id,
            tipo: 'PEDIDO_PREVIEW',
            nivel: 'ALERTA',
            titulo: m.campaignStep.notificacaoTexto?.trim()
              ? m.campaignStep.notificacaoTexto.trim()
              : `Lead chegou em "${rotuloEtapa}"`,
            mensagem: `${quem} chegou na etapa "${rotuloEtapa}" da campanha ${m.campaign.nome}.`,
            // Leva direto para a conversa: um aviso sem caminho de volta
            // faz voce procurar o lead na mao.
            link: `/conversas/${m.lead.id}`,
            prioridade: 80,
          },
        });

        await publicarEvento('notificacao.criada', { leadId: m.lead.id });
      }

      await prisma.leadEvent.create({
        data: {
          leadId: m.lead.id,
          tipo: resultadoEnvio.simulado ? 'MENSAGEM_SIMULADA' : 'MENSAGEM_ENVIADA',
          descricao: resultadoEnvio.simulado
            ? `SIMULACAO: mensagem da etapa ${m.campaignStep.ordem} seria enviada`
            : `Mensagem da etapa ${m.campaignStep.ordem} enviada`,
          origem: 'worker',
          dados: {
            campanha: m.campaign.nome,
            etapa: m.campaignStep.ordem,
            dryRun: resultadoEnvio.simulado,
          } as Prisma.InputJsonValue,
        },
      });

      await publicarEvento(
        resultadoEnvio.simulado ? 'mensagem.simulada' : 'mensagem.enviada',
        { leadId: m.lead.id, campaignId: m.campaign.id }
      );

      return { status: resultadoEnvio.simulado ? 'SIMULADA' : 'ENVIADA', simulado: resultadoEnvio.simulado };
    },
    {
      connection: opcoesRedis(),
      // Concorrencia 1 de proposito: o espacamento entre mensagens e
      // uma protecao contra banimento. Processar em paralelo anularia
      // os delays calculados no agendamento.
      concurrency: 1,
    }
  );
}
