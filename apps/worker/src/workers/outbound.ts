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

/**
 * Quanto esperar o adapter responder antes de desistir.
 *
 * ============================================================
 * O BURACO QUE ISTO FECHA
 * ============================================================
 * `sendMessage` nao tinha tempo limite. O `whatsapp-web.js` roda sobre
 * um Chromium controlado remotamente e, em algumas conversas — LID
 * principalmente —, a promessa simplesmente nunca resolve. A mensagem
 * CHEGA no celular do lead e o worker fica pendurado esperando uma
 * resposta que nao vem.
 *
 * Visto em uso real: mensagem 2 entregue as 12:19 no WhatsApp, e a fila
 * mostrando "Processando" indefinidamente. A sequencia parava ali: sem
 * o envio concluir, a etapa nao avanca e a 3 nunca nasce.
 *
 * A recuperacao de orfas so age depois de 10 minutos — e ela existe
 * para worker MORTO, nao para worker vivo travado num await. Sem este
 * limite, o unico jeito de destravar era reiniciar na mao.
 *
 * 90 segundos: generoso para um envio lento em maquina carregada, curto
 * o bastante para nao parecer travado.
 *
 * Lido do ambiente porque o teste precisa esperar 1 segundo, nao 90 —
 * tres casos de travamento com o valor real seriam quatro minutos e
 * meio de suite parada. Valor invalido cai no padrao em vez de virar
 * `NaN`, que desativaria o limite sem avisar.
 */
function segundosDoAmbiente(): number {
  const bruto = Number(process.env.ENVIO_TIMEOUT_SEGUNDOS);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : 90;
}

export const SEGUNDOS_ATE_DESISTIR_DO_ENVIO = segundosDoAmbiente();

/** Marca um envio que estourou o tempo limite. */
export class EnvioSemResposta extends Error {
  constructor(segundos: number) {
    super(
      `O WhatsApp não respondeu em ${segundos}s. A mensagem PODE ter saído — ` +
        `confira a conversa antes de reenviar.`
    );
    this.name = 'EnvioSemResposta';
  }
}

/**
 * Corre a promessa contra um relogio.
 *
 * O timer e limpo nos dois desfechos: sem isso, um processo que enviou
 * mil mensagens carregaria mil timers vivos ate o ultimo expirar.
 */
export async function comTempoLimite<T>(
  promessa: Promise<T>,
  segundos: number
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_, rejeitar) => {
        timer = setTimeout(() => rejeitar(new EnvioSemResposta(segundos)), segundos * 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
        // ============================================================
        // "NAO CONSEGUI RESERVAR" TEM DOIS SIGNIFICADOS MUITO
        // DIFERENTES, E TRATA-LOS IGUAL PERDIA A MENSAGEM
        // ============================================================
        // Se a mensagem ja foi ENVIADA/SIMULADA/CANCELADA, desistir e
        // certo: outra execucao terminou o trabalho.
        //
        // Mas se ela esta em PROCESSANDO, isto NAO e duplicata — e a
        // propria mensagem, largada. O BullMQ considera "travado" um job
        // cujo worker sumiu (reinicio, Ctrl+C, queda do Chromium) e o
        // reexecuta. A reserva entao encontra o PROCESSANDO que ela
        // mesma deixou, devolve `count: 0`, e o handler ia embora
        // dizendo "ja processada" — com o job marcado CONCLUIDO no
        // Redis e a linha presa em PROCESSANDO no banco, para sempre.
        //
        // Visto em uso real, e do jeito mais confuso possivel: a
        // mensagem 2 CHEGOU no celular do lead, a fila mostrava
        // "Processando", e o diagnostico mostrava
        // `outbound_send: concluido 2 | FALHOU 0`. Nada acusava erro em
        // lugar nenhum. Como a etapa nunca concluia, o lead ficava
        // parado na etapa 1 e a mensagem 3 nunca nascia.
        //
        // A varredura de orfas resolveria — mas so depois de 10
        // minutos, e ela existe para worker morto. Aqui da para saber
        // agora.
        const atual = await prisma.outboundMessage.findUnique({
          where: { id: outboundMessageId },
          select: { status: true, dryRun: true },
        });

        if (atual?.status === 'PROCESSANDO') {
          // Simulada volta para a fila: nao tocou o WhatsApp, reenviar e
          // seguro. Real vira FALHOU: pode ter saido — e saiu, no caso
          // real que originou este codigo. Mandar a mesma frase duas
          // vezes na conversa de um cliente custa mais que voce ter de
          // olhar.
          await prisma.outboundMessage.update({
            where: { id: outboundMessageId },
            data: atual.dryRun
              ? { status: 'AGENDADA', scheduledAt: new Date() }
              : {
                  status: 'FALHOU',
                  erro:
                    'O envio foi interrompido no meio (worker reiniciado ou ' +
                    'travado). A mensagem PODE ter saído — confira a conversa ' +
                    'antes de reenviar.',
                  processedAt: new Date(),
                },
          });

          log.warn(
            { outboundMessageId, jobId: job.id, dryRun: atual.dryRun },
            atual.dryRun
              ? 'Envio simulado interrompido — devolvido para a fila'
              : 'Envio real interrompido — marcado FALHOU, sem reenvio automatico'
          );

          return { ignorado: true, motivo: 'envio_interrompido', status: 'FALHOU' };
        }

        log.warn(
          { outboundMessageId, jobId: job.id, status: atual?.status ?? '?' },
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

      // `undefined` explicito: entre o timeout e a confirmacao pela
      // conversa existe um instante em que ainda nao se sabe se a
      // mensagem saiu. O tipo obriga a decidir antes de seguir.
      let resultadoEnvio:
        | { sucesso: boolean; whatsappMessageId: string | null; simulado: boolean; erro?: string }
        | undefined;

      if (dryRun) {
        // O adapter fake registra e loga. Nada sai.
        resultadoEnvio = await comTempoLimite(
          adapter.sendMessage(m.telefoneDestino!, m.textoRenderizado!),
          SEGUNDOS_ATE_DESISTIR_DO_ENVIO
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
        // Guardado ANTES da chamada, com folga de 5s: e a partir daqui
        // que a conversa sera vasculhada se a promessa nao voltar.
        const antesDoEnvio = new Date(Date.now() - 5_000);

        try {
          resultadoEnvio = await comTempoLimite(
            adapter.sendMessage(m.telefoneDestino!, m.textoRenderizado!),
            SEGUNDOS_ATE_DESISTIR_DO_ENVIO
          );
        } catch (err) {
          // ============================================================
          // O ENVIO NAO RESPONDEU — MAS PODE TER SAIDO. PERGUNTE.
          // ============================================================
          // O `whatsapp-web.js` as vezes entrega a mensagem e nunca
          // resolve a promessa. A versao anterior deste bloco so podia
          // supor, e escolhia o caminho conservador: FALHOU, "PODE ter
          // saido".
          //
          // So que ela tinha saido — tres vezes seguidas em uso real.
          // Mensagem entregue no celular do lead as 12:47 e a fila
          // marcando "Falhou". A sequencia parava numa falha que nao
          // existia: a etapa nao avancava, e a mensagem 3 nunca nascia.
          //
          // O WhatsApp sabe a resposta — a mensagem esta na conversa.
          // Basta olhar antes de decidir.
          if (err instanceof EnvioSemResposta) {
            const idConfirmado = await adapter
              .confirmarEnvio(m.telefoneDestino!, m.textoRenderizado!, antesDoEnvio)
              .catch(() => null);

            if (idConfirmado) {
              log.info(
                {
                  outboundMessageId,
                  etapa: m.campaignStep.ordem,
                  whatsappMessageId: idConfirmado,
                },
                'Envio sem resposta, mas a mensagem ESTA na conversa — tratando como enviada'
              );
              // Cai no fluxo normal: grava a mensagem, avanca a etapa e
              // agenda a proxima. Era exatamente isto que nao acontecia.
              resultadoEnvio = {
                sucesso: true,
                whatsappMessageId: idConfirmado,
                simulado: false,
              };
            }
          }

          // Nao confirmada na conversa: agora sim e falha.
          //
          // FALHOU e nao AGENDADA, de proposito. Devolver para a fila
          // reenviaria uma mensagem que pode ter chegado — a mesma frase
          // duas vezes na conversa de um cliente. Um incomodo seu custa
          // menos que isso.
          //
          // Marcar aqui, e nao esperar a varredura de orfas, porque
          // aquela so age depois de 10 minutos: ela existe para worker
          // MORTO, nao para worker vivo travado num await.
          if (!resultadoEnvio) {
          const semResposta = err instanceof EnvioSemResposta;
          await prisma.outboundMessage.update({
            where: { id: outboundMessageId },
            data: {
              status: 'FALHOU',
              erro: semResposta
                ? err.message
                : `Falha no envio: ${err instanceof Error ? err.message : String(err)}`,
              processedAt: new Date(),
              bullJobId: job.id ?? null,
            },
          });

          await prisma.leadEvent.create({
            data: {
              leadId: m.lead.id,
              tipo: 'MENSAGEM_FALHOU',
              descricao: semResposta
                ? `Etapa ${m.campaignStep.ordem}: o WhatsApp não confirmou o envio. Confira a conversa.`
                : `Etapa ${m.campaignStep.ordem}: falha no envio`,
              origem: 'worker',
            },
          });

          // ============================================================
          // FALHA PRECISA CHEGAR ATE VOCE
          // ============================================================
          // Ate agora uma falha de envio so existia na aba Fila. Quem
          // nao abrisse aquela tela nunca saberia — e a sequencia daquele
          // lead parava para sempre, em silencio.
          //
          // O sino e onde as coisas que exigem decisao aparecem. Uma
          // mensagem que talvez tenha saido, e que nao sera reenviada
          // sozinha, e exatamente isso.
          const quemFalhou =
            m.lead.empresa ?? m.lead.nomeCompleto ?? 'Lead sem nome';
          await prisma.notification.create({
            data: {
              leadId: m.lead.id,
              tipo: 'INTERVENCAO_NECESSARIA',
              nivel: 'ERRO',
              prioridade: 5,
              titulo: `Falha no envio da etapa ${m.campaignStep.ordem} — ${quemFalhou}`,
              mensagem: semResposta
                ? 'O WhatsApp não confirmou o envio. A mensagem PODE ter saído: ' +
                  'confira a conversa. A sequência deste lead está parada até você decidir.'
                : `Não foi possível enviar. A sequência deste lead está parada.`,
            },
          });
          void publicarEvento('notificacao.criada', { leadId: m.lead.id });

          log.error(
            { outboundMessageId, etapa: m.campaignStep.ordem, err },
            semResposta
              ? 'Envio sem resposta do WhatsApp — marcada FALHOU, sem reenvio automatico'
              : 'Falha no envio'
          );

          // Nao relanca: relancar faria o BullMQ retentar, e a reserva
          // condicional ja recusaria (a mensagem nao esta mais
          // AGENDADA). Seriam tres tentativas inuteis e tres linhas de
          // erro no log para um caso que ja foi resolvido aqui.
          return { status: 'FALHOU', motivo: 'envio_sem_resposta' };
          }
        }

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

      // ============================================================
      // A PARTIR DAQUI O TRANSPORTE JA TEVE SUCESSO
      // ============================================================
      // O status vai para ENVIADA AGORA, antes de qualquer outra
      // escrita. Nada do que vier depois — gravar historico, mover o
      // quadro, criar notificacao, publicar evento — pode transformar
      // uma mensagem entregue em "FALHOU".
      //
      // Antes, a ordem era o contrario: gravava tudo e so entao mudava o
      // status. Uma falha no meio derrubava o job, o BullMQ retentava, a
      // reserva encontrava PROCESSANDO e marcava FALHOU — para uma
      // mensagem que estava no celular do lead.
      //
      // "Sucesso de transporte" e "falha de pos-processamento" sao
      // coisas diferentes e agora tem registros diferentes.
      const statusFinal = resultadoEnvio.simulado ? 'SIMULADA' : 'ENVIADA';
      await prisma.outboundMessage.update({
        where: { id: outboundMessageId },
        data: {
          status: statusFinal,
          processedAt: new Date(),
          bullJobId: job.id ?? null,
          dryRun: resultadoEnvio.simulado,
        },
      });

      // ============================================================
      // POS-PROCESSAMENTO — NADA AQUI PODE DESFAZER O ENVIO
      // ============================================================
      // Gravar historico, mover o quadro, criar notificacao, publicar
      // evento. Tudo isto e importante, e nada disto e o envio.
      //
      // Se qualquer passo falhar, a mensagem CONTINUA ENVIADA. O erro e
      // registrado no campo `erro` — com o status intacto — para a tela
      // poder dizer "Enviada, sincronizacao pendente" em vez de mentir
      // que falhou.
      //
      // Nao relanca: relancar derrubaria o job, o BullMQ retentaria, e a
      // retentativa encontraria a mensagem ja ENVIADA. No melhor caso
      // seria trabalho jogado fora; no pior, o comportamento antigo de
      // marcar FALHOU o que ja tinha saido.
      try {
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

        // So o vinculo com a mensagem gravada. O status ja foi decidido
        // la em cima, quando o transporte teve sucesso.
        await prisma.outboundMessage.update({
          where: { id: outboundMessageId },
          data: { messageId: mensagem.id },
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
      } catch (err) {
        const detalhe = err instanceof Error ? err.message : String(err);
        await prisma.outboundMessage
          .update({
            where: { id: outboundMessageId },
            data: {
              erro: `Enviada, mas o pós-processamento falhou: ${detalhe}`,
            },
          })
          // Se ate isto falhar, o banco esta fora — e nao ha o que
          // gravar em lugar nenhum. O log e o ultimo recurso.
          .catch(() => undefined);

        log.error(
          {
            outboundMessageId,
            etapa: m.campaignStep.ordem,
            statusPreservado: statusFinal,
            err,
          },
          'Envio concluído, mas o pós-processamento falhou — status preservado'
        );

        return { status: statusFinal, simulado: resultadoEnvio.simulado };
      }

      return { status: statusFinal, simulado: resultadoEnvio.simulado };
    },
    {
      connection: opcoesRedis(),
      // Concorrencia 1 de proposito: o espacamento entre mensagens e
      // uma protecao contra banimento. Processar em paralelo anularia
      // os delays calculados no agendamento.
      concurrency: 1,

      // ============================================================
      // A TRAVA PRECISA DURAR MAIS QUE O ENVIO
      // ============================================================
      // Este e o defeito que produzia o falso FALHOU, e ele nasceu de
      // dois numeros que ninguem tinha comparado:
      //
      //   BullMQ  lockDuration/stalledInterval = 30s (padrao)
      //   envio   tempo limite                 = 90s
      //
      // Um envio lento — que e o normal em conversa LID — passava dos
      // 30s. O BullMQ concluia que o worker tinha morrido, marcava o job
      // como travado e o REEXECUTAVA. A reexecucao encontrava a mensagem
      // em PROCESSANDO e a marcava FALHOU... enquanto a execucao
      // original ainda estava viva, esperando o WhatsApp, que entregou a
      // mensagem normalmente.
      //
      // Resultado: WhatsApp entregou, CRM disse FALHOU. Nao era erro de
      // tela — o banco tinha FALHOU mesmo, escrito por um sosia do
      // proprio job.
      //
      // A trava agora cobre o envio inteiro com folga. Enquanto a
      // execucao estiver viva e dentro dela, nenhum sosia aparece; se o
      // processo morrer de verdade, a trava expira e a recuperacao age.
      lockDuration: (SEGUNDOS_ATE_DESISTIR_DO_ENVIO + 60) * 1000,
      stalledInterval: (SEGUNDOS_ATE_DESISTIR_DO_ENVIO + 60) * 1000,
    }
  );
}
