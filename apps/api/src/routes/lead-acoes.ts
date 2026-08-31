/**
 * Intervencao manual — quando VOCE assume a conversa.
 *
 * ============================================================
 * POR QUE ISSO EXISTE
 * ============================================================
 * O sistema para de proposito em varias situacoes: nao entendeu a
 * resposta, o lead ficou quente, uma variavel faltou. Ate aqui os leads
 * eram somente-leitura — o CRM sabia dizer "este lead precisa de voce",
 * mas nao havia nada que voce pudesse fazer na tela. A conversa ficava
 * travada num status sem saida.
 *
 * ============================================================
 * TODA ACAO DEIXA RASTRO
 * ============================================================
 * Cada rota daqui grava um `LeadEvent`. Sem isso, daqui a tres meses
 * ninguem saberia por que um lead saiu de AGUARDANDO_INTERVENCAO — e
 * "quem mudou isso?" e a primeira pergunta quando algo da errado.
 *
 * NENHUMA ROTA AQUI ENVIA MENSAGEM. Assumir a conversa significa que
 * VOCE vai falar com a pessoa, pelo seu WhatsApp.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, Prisma } from '@prospector/database';
import { LEAD_STATUS, TEMPERATURA } from '@prospector/shared';
import {
  estadoAoAssumirConversa,
  ORIGEM_MARCADO_A_MAO,
  DESCRICAO_MARCADO_A_MAO,
  ORIGEM_ATENCAO_RESOLVIDA,
  DESCRICAO_ATENCAO_RESOLVIDA,
} from '@prospector/domain';
import { exigirAutenticacao } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';
import { eventsBus } from '../lib/events-bus.js';

const idSchema = z.object({ id: z.string().uuid() });

async function buscarLead(id: string) {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) throw new AppError('Lead não encontrado', 404, 'NAO_ENCONTRADO');
  return lead;
}

/** Cancela a fila pendente do lead. Usado quando a conversa sai do automático. */
async function cancelarFilaDoLead(leadId: string, motivo: string): Promise<number> {
  const r = await prisma.outboundMessage.updateMany({
    where: { leadId, status: { in: ['PENDENTE', 'AGENDADA'] } },
    data: { status: 'CANCELADA', erro: motivo },
  });
  return r.count;
}

export async function rotasLeadAcoes(app: FastifyInstance): Promise<void> {
  // ------------------------------------------------------ mudar o status
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/status',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { status, motivo } = z
        .object({
          status: z.enum(LEAD_STATUS as unknown as [string, ...string[]]),
          motivo: z.string().trim().max(500).optional(),
        })
        .parse(request.body);

      const lead = await buscarLead(id);

      // Opt-out nao entra por aqui. Ele tem rota propria, com confirmacao,
      // porque e a unica mudanca de status que o sistema trata como
      // promessa feita a outra pessoa.
      if (status === 'OPT_OUT') {
        throw new AppError(
          'Use POST /api/leads/:id/opt-out para registrar um opt-out',
          422,
          'USE_ROTA_OPT_OUT'
        );
      }
      if (lead.optOut) {
        throw new AppError(
          'Este lead pediu para não ser mais contatado. Reverta o opt-out antes de mudar o status.',
          422,
          'LEAD_EM_OPT_OUT'
        );
      }

      if (lead.status === status) return { lead };

      const atualizado = await prisma.lead.update({
        where: { id },
        data: { status: status as never },
      });

      await prisma.leadEvent.create({
        data: {
          leadId: id,
          tipo: 'STATUS_ALTERADO',
          descricao: `Status alterado de ${lead.status} para ${status}${
            motivo ? ` — ${motivo}` : ''
          }`,
          origem: 'usuario',
          dados: { de: lead.status, para: status } as Prisma.InputJsonValue,
        },
      });

      // Sair do automático cancela o que estava agendado. Se a fila
      // continuasse andando, o sistema mandaria a próxima etapa por cima
      // da conversa que você acabou de assumir.
      if (['PAUSADO', 'ENCERRADO', 'CLIENTE', 'AGUARDANDO_INTERVENCAO'].includes(status)) {
        await cancelarFilaDoLead(id, `Lead movido para ${status}`);
      }

      eventsBus.publicar('lead.status_alterado', { leadId: id, status });
      return { lead: atualizado };
    }
  );

  // ------------------------------------------------- mudar a temperatura
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/temperatura',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { temperatura } = z
        .object({
          temperatura: z.enum(TEMPERATURA as unknown as [string, ...string[]]),
        })
        .parse(request.body);

      const lead = await buscarLead(id);
      if (lead.temperatura === temperatura) return { lead };

      const atualizado = await prisma.lead.update({
        where: { id },
        data: { temperatura: temperatura as never },
      });

      await prisma.leadEvent.create({
        data: {
          leadId: id,
          tipo: 'TEMPERATURA_ALTERADA',
          descricao: `Temperatura alterada de ${lead.temperatura} para ${temperatura}`,
          origem: 'usuario',
          dados: { de: lead.temperatura, para: temperatura } as Prisma.InputJsonValue,
        },
      });

      eventsBus.publicar('lead.temperatura_alterada', { leadId: id, temperatura });
      return { lead: atualizado };
    }
  );

  // --------------------------------------------- resolver a intervencao
  //
  // O caso central da Fase 5: o sistema parou, voce resolveu, a conversa
  // volta a andar (ou termina).
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/resolver-intervencao',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { novoStatus, nota, concluirTarefas } = z
        .object({
          novoStatus: z
            .enum(['EM_CONVERSA', 'AGENDADO', 'PAUSADO', 'ENCERRADO', 'OPORTUNIDADE', 'CLIENTE'])
            .default('EM_CONVERSA'),
          nota: z.string().trim().max(2000).optional(),
          concluirTarefas: z.boolean().default(true),
        })
        .parse(request.body ?? {});

      const lead = await buscarLead(id);

      if (lead.status !== 'AGUARDANDO_INTERVENCAO') {
        throw new AppError(
          `Este lead não está aguardando intervenção (está ${lead.status})`,
          422,
          'SEM_INTERVENCAO_PENDENTE'
        );
      }

      const atualizado = await prisma.lead.update({
        where: { id },
        data: {
          status: novoStatus as never,
          // A próxima ação some junto: ela descrevia a intervenção que
          // acabou de ser resolvida.
          proximaAcao: null,
          proximaAcaoEm: null,
          ultimaInteracaoEm: new Date(),
          ...(nota
            ? {
                observacoes: lead.observacoes
                  ? `${lead.observacoes}\n\n${nota}`
                  : nota,
              }
            : {}),
        },
      });

      await prisma.leadEvent.create({
        data: {
          leadId: id,
          tipo: 'INTERVENCAO_RESOLVIDA',
          descricao: nota
            ? `Intervenção resolvida — ${nota}`
            : `Intervenção resolvida; lead movido para ${novoStatus}`,
          origem: 'usuario',
          dados: { novoStatus } as Prisma.InputJsonValue,
        },
      });

      // As tarefas abertas do tipo "resposta não reconhecida" descrevem
      // exatamente o problema que acabou de ser resolvido. Deixá-las
      // abertas faria o contador do dashboard mentir.
      let tarefasConcluidas = 0;
      if (concluirTarefas) {
        const r = await prisma.task.updateMany({
          where: {
            leadId: id,
            tipo: { in: ['RESPOSTA_NAO_RECONHECIDA', 'RESPONDER_CLIENTE'] },
            status: { in: ['ABERTA', 'EM_ANDAMENTO'] },
          },
          data: { status: 'CONCLUIDA', concluidaEm: new Date() },
        });
        tarefasConcluidas = r.count;
      }

      // Notificações sobre este lead já não pedem ação.
      await prisma.notification.updateMany({
        where: { leadId: id, tipo: 'INTERVENCAO_NECESSARIA', lida: false },
        data: { lida: true, lidaEm: new Date() },
      });

      eventsBus.publicar('lead.status_alterado', { leadId: id, status: novoStatus });
      eventsBus.publicar('dashboard.atualizar');

      return { lead: atualizado, tarefasConcluidas };
    }
  );

  // ------------------------------------------------------ marcar opt-out
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/opt-out',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { motivo } = z
        .object({ motivo: z.string().trim().max(500).optional() })
        .parse(request.body ?? {});

      const lead = await buscarLead(id);
      if (lead.optOut) return { lead, canceladas: 0 };

      const atualizado = await prisma.lead.update({
        where: { id },
        data: {
          optOut: true,
          optOutEm: new Date(),
          status: 'OPT_OUT',
          proximaAcao: null,
          proximaAcaoEm: null,
        },
      });

      // Opt-out sem cancelar a fila seria uma promessa quebrada: a pessoa
      // pediu para parar e receberia a próxima etapa mesmo assim.
      const canceladas = await cancelarFilaDoLead(id, 'Lead registrou opt-out');

      await prisma.leadEvent.create({
        data: {
          leadId: id,
          tipo: 'OPT_OUT_REGISTRADO',
          descricao: motivo
            ? `Opt-out registrado manualmente — ${motivo}`
            : 'Opt-out registrado manualmente',
          origem: 'usuario',
        },
      });

      eventsBus.publicar('lead.status_alterado', { leadId: id, status: 'OPT_OUT' });
      return { lead: atualizado, canceladas };
    }
  );

  // ----------------------------------------------------- reverter opt-out
  //
  // Existe porque um clique errado nao pode condenar um lead para sempre.
  // Mas exige confirmacao e justificativa, e grava o evento: desfazer um
  // opt-out e uma decisao que precisa ter dono.
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/opt-out/reverter',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { confirmar, motivo } = z
        .object({
          confirmar: z.literal(true),
          motivo: z.string().trim().min(3).max(500),
        })
        .parse(request.body);

      const lead = await buscarLead(id);
      if (!lead.optOut) {
        throw new AppError('Este lead não está em opt-out', 422, 'SEM_OPT_OUT');
      }

      const atualizado = await prisma.lead.update({
        where: { id },
        data: { optOut: false, optOutEm: null, status: 'PAUSADO' },
      });

      await prisma.leadEvent.create({
        data: {
          leadId: id,
          tipo: 'OPT_OUT_REGISTRADO',
          descricao: `OPT-OUT REVERTIDO manualmente — ${motivo}`,
          origem: 'usuario',
          dados: { revertido: true, confirmado: confirmar } as Prisma.InputJsonValue,
        },
      });

      request.log.warn({ leadId: id, motivo }, 'Opt-out revertido manualmente');

      // Volta como PAUSADO, nunca direto para a campanha: retomar o envio
      // automático tem que ser um segundo ato consciente.
      eventsBus.publicar('lead.status_alterado', { leadId: id, status: 'PAUSADO' });
      return { lead: atualizado };
    }
  );

  // -------------------------------------------------------- anotar algo
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/nota',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { texto } = z
        .object({ texto: z.string().trim().min(1).max(2000) })
        .parse(request.body);

      const lead = await buscarLead(id);
      const carimbo = new Date().toLocaleString('pt-BR');

      const atualizado = await prisma.lead.update({
        where: { id },
        data: {
          observacoes: lead.observacoes
            ? `${lead.observacoes}\n\n[${carimbo}] ${texto}`
            : `[${carimbo}] ${texto}`,
        },
      });

      await prisma.leadEvent.create({
        data: {
          leadId: id,
          tipo: 'STATUS_ALTERADO',
          descricao: `Nota adicionada: ${texto.slice(0, 120)}`,
          origem: 'usuario',
        },
      });

      eventsBus.publicar('lead.atualizado', { leadId: id });
      return { lead: atualizado };
    }
  );

  // ------------------------------------------------- definir proxima acao
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/proxima-acao',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const { texto, quando } = z
        .object({
          texto: z.string().trim().max(300).nullable(),
          quando: z.coerce.date().nullable().optional(),
        })
        .parse(request.body);

      await buscarLead(id);

      const atualizado = await prisma.lead.update({
        where: { id },
        data: { proximaAcao: texto, proximaAcaoEm: quando ?? null },
      });

      eventsBus.publicar('lead.atualizado', { leadId: id });
      return { lead: atualizado };
    }
  );

  // ------------------------------------------------ "já mandei para este"
  //
  // ============================================================
  // O BOTAO DA LISTA DE QUEM NAO RESPONDEU
  // ============================================================
  // Pedido: "colocar um botao de marcado como mandado em cada lead e
  // atualizar a lista — porque ai eu mando".
  //
  // Aquela lista e uma fila de trabalho: voce passa por ela abrindo o
  // WhatsApp e escrevendo na mao. Sem uma forma de riscar o que ja foi
  // feito, ela nunca encolhe, e na proxima visita voce reescreve para os
  // mesmos leads.
  //
  // ISTO NAO ENVIA NADA. E uma anotacao — "cuidei deste".
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/marcar-mandado',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      const lead = await buscarLead(id);

      // Um lead em opt-out nao devia estar na lista, mas a tela pode
      // estar velha. Recusar aqui e a ultima chance de nao registrar
      // "mandei mensagem" para quem pediu para parar.
      if (lead.optOut) {
        throw new AppError(
          'Este lead pediu para não ser mais contatado.',
          422,
          'LEAD_EM_OPT_OUT'
        );
      }

      await prisma.leadEvent.create({
        data: {
          leadId: id,
          tipo: 'MENSAGEM_ENVIADA',
          descricao: DESCRICAO_MARCADO_A_MAO,
          origem: ORIGEM_MARCADO_A_MAO,
        },
      });

      // ============================================================
      // ELE E UMA ANOTACAO, E SO ISSO
      // ============================================================
      // A primeira versao copiava o comportamento de "assumir a
      // conversa": marcava QUENTE, punha EM_CONVERSA, cancelava a fila e
      // pausava a campanha com `aguardandoLiberacao`.
      //
      // Estava errado, e o erro apareceu em uso real: 39 leads clicados
      // de uma vez viraram 39 cartoes em "Precisa de voce", pedindo uma
      // decisao que a pessoa acabara de tomar. O oposto de "atualizar a
      // lista".
      //
      // As duas acoes SAO diferentes:
      //
      //   - assumir a conversa = alguem RESPONDEU e voce entrou. Pausar
      //     faz sentido: o robo mandando a etapa 3 por cima de uma
      //     negociacao e o jeito mais rapido de perder a venda.
      //
      //   - "ja mandei" = a pessoa NAO respondeu nada, e voce deu um
      //     empurrao a mao. Nada nela ficou mais quente — ela continua em
      //     silencio — e a sequencia dela nao tem por que congelar.
      //
      // Entao aqui: o evento acima (que e o que tira o lead da lista de
      // "nao responderam"), e o carimbo de tempo. Nada mais. Se voce
      // quiser parar a sequencia de alguem, o botao de pausar existe e e
      // explicito.
      const atualizado = await prisma.lead.update({
        where: { id },
        data: { ultimaInteracaoEm: new Date() },
      });

      eventsBus.publicar('dashboard.atualizar');

      return { lead: atualizado };
    }
  );

  // ---------------------------------------- "já cuidei disso" na atenção
  //
  // ============================================================
  // POR QUE ISTO NÃO MEXE EM NADA DO LEAD
  // ============================================================
  // "Precisa da sua atenção" não é uma tabela — ela é recalculada a cada
  // carga, de seis consultas. Não há linha para apagar: um lead quente
  // está ali porque a coluna `temperatura` diz QUENTE.
  //
  // A saída óbvia seria o botão MUDAR o dado que colocou o lead ali —
  // rebaixar a temperatura, limpar a última categoria, cancelar o envio
  // que falhou. A lista encolheria, e o histórico passaria a mentir: o
  // lead REALMENTE perguntou preço; o envio REALMENTE falhou.
  //
  // Em vez disso, grava uma DISPENSA com carimbo de tempo. A lista
  // esconde as pendências mais VELHAS que ela — e mostra as mais novas.
  // Se o lead responder de novo amanhã, ele volta, porque aquilo é
  // posterior ao seu "já cuidei". Ver `peneirarResolvidos`.
  app.post<{ Params: { id: string } }>(
    '/api/leads/:id/atencao/resolver',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      await buscarLead(id);

      const evento = await prisma.leadEvent.create({
        data: {
          leadId: id,
          tipo: 'INTERVENCAO_RESOLVIDA',
          descricao: DESCRICAO_ATENCAO_RESOLVIDA,
          origem: ORIGEM_ATENCAO_RESOLVIDA,
        },
      });

      // O sino tem que concordar com a tela. Deixar a notificação aberta
      // faria o ponto vermelho continuar cobrando o que você acabou de
      // dizer que resolveu.
      await prisma.notification.updateMany({
        where: { leadId: id, lida: false },
        data: { lida: true, lidaEm: new Date() },
      });

      eventsBus.publicar('dashboard.atualizar');
      return { resolvidoEm: evento.createdAt };
    }
  );

  // Desfazer: apaga só a dispensa mais recente, e não todas. Cada uma
  // cobre um momento diferente, e apagar o histórico inteiro traria de
  // volta pendências que você resolveu semanas atrás.
  app.delete<{ Params: { id: string } }>(
    '/api/leads/:id/atencao/resolver',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      await buscarLead(id);

      const ultima = await prisma.leadEvent.findFirst({
        where: { leadId: id, origem: ORIGEM_ATENCAO_RESOLVIDA },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (!ultima) return { desfeitos: 0 };

      await prisma.leadEvent.delete({ where: { id: ultima.id } });
      eventsBus.publicar('dashboard.atualizar');
      return { desfeitos: 1 };
    }
  );

  // Desfazer. Um clique errado nesta lista tira o lead dela para sempre;
  // sem volta, o botao acima fica perigoso demais para usar com pressa.
  app.delete<{ Params: { id: string } }>(
    '/api/leads/:id/marcar-mandado',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = idSchema.parse(request.params);
      await buscarLead(id);

      const r = await prisma.leadEvent.deleteMany({
        where: { leadId: id, tipo: 'MENSAGEM_ENVIADA', origem: ORIGEM_MARCADO_A_MAO },
      });

      // O status NAO volta sozinho. O lead pode ter andado por outros
      // motivos desde a marcacao, e adivinhar de onde ele veio erraria
      // mais do que acertaria — desfazer devolve a lista, nao o passado.
      eventsBus.publicar('dashboard.atualizar');
      return { desfeitos: r.count };
    }
  );
}
