/**
 * Notificacao com idempotencia.
 *
 * ============================================================
 * O BURACO QUE ISTO FECHA
 * ============================================================
 * Havia TRES lugares criando notificacao com `prisma.notification.create()`
 * seco — `inbound.ts`, `outbound.ts` e `avancar-etapa.ts` — e nenhum deles
 * tinha como saber que o aviso ja existia.
 *
 * Na pratica isso significava: o lead responde duas vezes seguidas, ou o
 * BullMQ reexecuta um job, ou a varredura de recuperacao releu a mesma
 * conversa — e o sino mostrava "Studio Teste chegou na etapa 3" duas
 * vezes. Voce abria as duas, e a segunda nao tinha nada de novo.
 *
 * ============================================================
 * POR QUE UMA CHAVE, E NAO UM `findFirst` ANTES DO `create`
 * ============================================================
 * `findFirst` + `create` e uma corrida: duas execucoes simultaneas
 * passam as duas pelo SELECT (nenhuma ve a outra, que ainda nao
 * commitou) e criam as duas. Sob concorrencia real — que e exatamente o
 * cenario dos jobs do BullMQ — isso falha.
 *
 * A UNIQUE do banco nao tem esse problema: uma das duas transacoes
 * ganha, a outra recebe P2002. Por isso o padrao aqui e INSERT direto +
 * catch, e nunca consulta antes.
 */
import { prisma, Prisma } from '@prospector/database';
import { chaveNotificacao } from '@prospector/domain';
import { PRIORIDADE_NOTIFICACAO } from '@prospector/shared';
import { publicarEvento } from '../events.js';

export interface DadosNotificacao {
  tipo: string;
  titulo: string;
  mensagem: string;
  nivel?: 'INFO' | 'SUCESSO' | 'ALERTA' | 'ERRO';
  leadId?: string | null;
  link?: string | null;
  /**
   * O QUE torna este aviso unico dentro do tipo: o id da etapa, o id da
   * mensagem recebida, o id do envio que falhou.
   *
   * Omitir e legitimo para avisos avulsos ("WhatsApp desconectou"), que
   * nao tem acontecimento que os identifique. Sem referencia, nao ha
   * chave, e o comportamento e o de antes: sempre cria.
   */
  referencia?: string | null;
}

export interface ResultadoNotificacao {
  /** false quando o aviso ja existia e nada foi criado. */
  criada: boolean;
  notificationId: string | null;
}

/**
 * Cria a notificacao, ou nao faz nada se ela ja existe.
 *
 * Devolve `criada: false` em vez de lancar: para quem chama, "ja avisei"
 * e sucesso, nao erro.
 */
export async function criarNotificacaoIdempotente(
  dados: DadosNotificacao
): Promise<ResultadoNotificacao> {
  const chave =
    dados.referencia && dados.leadId
      ? chaveNotificacao(dados.tipo, dados.leadId, dados.referencia)
      : null;

  try {
    const n = await prisma.notification.create({
      data: {
        tipo: dados.tipo as never,
        titulo: dados.titulo,
        mensagem: dados.mensagem,
        nivel: (dados.nivel ?? 'INFO') as never,
        prioridade: PRIORIDADE_NOTIFICACAO[dados.tipo] ?? 50,
        leadId: dados.leadId ?? null,
        link: dados.link ?? null,
        chaveIdempotencia: chave,
      },
      select: { id: true },
    });

    // O evento so sai quando a notificacao e nova. Publicar na colisao
    // faria a tela piscar "chegou aviso novo" para algo que ja estava la.
    await publicarEvento('notificacao.criada', { titulo: dados.titulo });
    return { criada: true, notificationId: n.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { criada: false, notificationId: null };
    }
    throw err;
  }
}

/**
 * A tarefa equivalente. Mesmo raciocinio, problema um pouco diferente.
 *
 * `Task` nao tem coluna de idempotencia, e criar uma exigiria migrar uma
 * tabela que voce ja usa no dia a dia. Aqui a dedupe continua sendo por
 * consulta — mas restrita ao que de fato importa: uma tarefa ABERTA do
 * mesmo tipo para o mesmo lead.
 *
 * A corrida continua teoricamente possivel; na pratica ela e inofensiva,
 * porque duas tarefas identicas na sua lista custam um clique, enquanto
 * duas MENSAGENS custam um cliente. Onde o erro e irreversivel, a
 * protecao e a constraint; onde e so incomodo, a consulta basta.
 */
export async function criarTarefaSeNaoExistir(dados: {
  leadId: string;
  tipo: string;
  titulo: string;
  descricao: string;
  prioridade?: 'BAIXA' | 'MEDIA' | 'ALTA' | 'URGENTE';
}): Promise<{ criada: boolean }> {
  const jaTem = await prisma.task.findFirst({
    where: {
      leadId: dados.leadId,
      tipo: dados.tipo as never,
      status: { in: ['ABERTA', 'EM_ANDAMENTO'] },
    },
    select: { id: true },
  });
  if (jaTem) return { criada: false };

  await prisma.task.create({
    data: {
      leadId: dados.leadId,
      tipo: dados.tipo as never,
      prioridade: (dados.prioridade ?? 'ALTA') as never,
      titulo: dados.titulo,
      descricao: dados.descricao,
    },
  });
  void publicarEvento('tarefa.criada', { leadId: dados.leadId });
  return { criada: true };
}
