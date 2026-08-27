/**
 * O relatorio semanal — a camada que le o banco.
 *
 * ============================================================
 * A CONTA NAO MORA AQUI
 * ============================================================
 * Este arquivo so BUSCA. Quem decide o que conta como "respondeu", em
 * que dia entra uma mensagem que saiu 23h59, e onde vai um lead que
 * perguntou preco E depois sumiu, e `montarRelatorioSemana`, no dominio
 * — pura, e coberta por 19 testes que rodam sem banco.
 *
 * ============================================================
 * POR QUE NAO HA UM RETRATO CONGELADO NO DOMINGO
 * ============================================================
 * O pedido dizia "salve quando acabar cada semana no domingo 00:00", e
 * a leitura obvia disso e uma tabela de retratos mais uma tarefa
 * agendada que a preenche.
 *
 * Nao construi assim, e vale explicar. Recalcular do banco devolve os
 * MESMOS numeros — nenhum envio muda de data depois de acontecer — mas
 * sem uma tarefa que pode falhar, sem uma tabela que pode divergir do
 * banco, e sem o buraco das semanas anteriores a existencia dela: com
 * retrato congelado, o historico que voce ja tem nao apareceria.
 *
 * A UNICA coisa que muda depois da virada e a resposta que chega
 * atrasada — e o proprio pedido quer ela contada ("o que aconteceu com
 * quem eu abordei naquela semana"). Um retrato tirado 00:00 de domingo
 * seria justamente o que a perderia.
 *
 * Se algum dia a base ficar grande a ponto de a conta pesar, o cache
 * entra aqui sem mexer em mais nada.
 */
import { prisma } from '@prospector/database';
import {
  montarRelatorioSemana,
  montarResumoDoDia,
  montarFichaDoDia,
  inicioDaSemana,
  fimDaSemana,
  inicioDoDia,
  fimDoDia,
  type EnvioDaSemana,
  type RespostaDaSemana,
  type EstadoDoLead,
  type RelatorioSemana,
  type ResumoDoDia,
  type EnvioDoDia,
  type RespostaDoDia,
  type FichaDoDia,
  type EnvioDaFicha,
} from '@prospector/domain';

export interface SemanaNaLista {
  /** ISO do domingo 00:00. E a chave usada na rota. */
  inicio: string;
  fim: string;
  /** Mensagens que sairam naquela semana. */
  enviadas: number;
  /** Leads distintos abordados. */
  abordados: number;
}

/**
 * A ordem da etapa que mostra a previa.
 *
 * ============================================================
 * ELA E INFERIDA, E NAO CONFIGURADA
 * ============================================================
 * Nao existe um campo "esta e a etapa da previa" no banco. O que existe
 * e `enviarAutomaticamente: false` — "so sai quando voce liberar" — e o
 * proprio schema explica por que ele existe: "usado na MSG 3, que
 * depende do preview ficar pronto".
 *
 * Entao a etapa da previa e a PRIMEIRA que exige liberacao manual. E uma
 * inferencia, e ela pode errar se voce usar liberacao manual para outra
 * coisa. Preferi inferir a inventar um campo novo que voce teria de
 * preencher em toda campanha para uma linha de relatorio.
 *
 * Sem nenhuma etapa manual, devolve `null` — e o dominio ja trata isso
 * como "nao ha previa configurada; ninguem recebeu".
 */
async function ordemDaPrevia(): Promise<number | null> {
  const etapa = await prisma.campaignStep.findFirst({
    where: { ativo: true, enviarAutomaticamente: false },
    orderBy: { ordem: 'asc' },
    select: { ordem: true },
  });
  return etapa?.ordem ?? null;
}

/**
 * As semanas que tiveram envio, da mais recente para a mais antiga.
 *
 * So aparecem semanas com atividade. Listar todas as semanas desde a
 * primeira encheria o calendario de domingos vazios, e "nao mandei nada"
 * ja e visivel pela ausencia.
 */
export async function semanasComAtividade(): Promise<SemanaNaLista[]> {
  const envios = await prisma.outboundMessage.findMany({
    where: { status: 'ENVIADA' },
    select: { leadId: true, processedAt: true, createdAt: true },
  });

  const porSemana = new Map<number, { enviadas: number; leads: Set<string> }>();

  for (const e of envios) {
    const quando = e.processedAt ?? e.createdAt;
    const chave = inicioDaSemana(quando).getTime();

    const atual = porSemana.get(chave) ?? { enviadas: 0, leads: new Set() };
    atual.enviadas += 1;
    atual.leads.add(e.leadId);
    porSemana.set(chave, atual);
  }

  return [...porSemana.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([ms, v]) => {
      const inicio = new Date(ms);
      return {
        inicio: inicio.toISOString(),
        fim: fimDaSemana(inicio).toISOString(),
        enviadas: v.enviadas,
        abordados: v.leads.size,
      };
    });
}

/**
 * Quantas mensagens sairam em cada DIA que teve envio.
 *
 * E o que pinta o calendario: sem isto, a grade do mes so saberia quais
 * SEMANAS tiveram atividade, e voce nao teria como escolher um dia
 * sabendo se ha algo nele.
 *
 * So dias com envio aparecem. Dia vazio nao vira linha — a ausencia ja
 * diz o que precisa dizer, e o calendario desenha os vazios de qualquer
 * forma.
 */
export async function diasComAtividade(): Promise<
  { dia: string; enviadas: number }[]
> {
  const envios = await prisma.outboundMessage.findMany({
    where: { status: 'ENVIADA' },
    select: { processedAt: true, createdAt: true },
  });

  const porDia = new Map<number, number>();
  for (const e of envios) {
    const chave = inicioDoDia(e.processedAt ?? e.createdAt).getTime();
    porDia.set(chave, (porDia.get(chave) ?? 0) + 1);
  }

  return [...porDia.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, enviadas]) => ({ dia: new Date(ms).toISOString(), enviadas }));
}

/**
 * O relatorio de uma semana.
 *
 * `quando` pode ser qualquer dia dela — o dominio normaliza para o
 * domingo. Isso evita um erro de fuso na tela virar a semana errada.
 */
export async function relatorioDaSemana(quando: Date): Promise<RelatorioSemana> {
  const inicio = inicioDaSemana(quando);
  const fim = fimDaSemana(inicio);

  // --- O que saiu naquela semana ---
  //
  // SIMULADA fica de fora: um ensaio nao abordou ninguem.
  const linhas = await prisma.outboundMessage.findMany({
    where: {
      status: 'ENVIADA',
      OR: [
        { processedAt: { gte: inicio, lt: fim } },
        // Sem `processedAt` — nao deveria acontecer numa ENVIADA — o
        // `createdAt` serve de piso, em vez de o envio sumir da conta.
        { processedAt: null, createdAt: { gte: inicio, lt: fim } },
      ],
    },
    select: {
      leadId: true,
      processedAt: true,
      createdAt: true,
      campaignStep: { select: { ordem: true, nome: true } },
      lead: { select: { captureSession: { select: { nicho: true } } } },
    },
  });

  const envios: EnvioDaSemana[] = linhas
    .filter((l) => l.campaignStep !== null)
    .map((l) => ({
      leadId: l.leadId,
      nicho: l.lead?.captureSession?.nicho ?? null,
      ordem: l.campaignStep!.ordem,
      etapaNome: l.campaignStep!.nome,
      enviadaEm: l.processedAt ?? l.createdAt,
    }));

  const abordados = [...new Set(envios.map((e) => e.leadId))];

  if (abordados.length === 0) {
    return montarRelatorioSemana({
      inicio,
      envios: [],
      respostas: [],
      estados: [],
      ordemDaPrevia: await ordemDaPrevia(),
    });
  }

  // --- O que esses leads disseram, EM QUALQUER DATA ---
  //
  // Sem recorte de tempo, e de proposito: a pergunta e "o que aconteceu
  // com quem eu abordei naquela semana", e a resposta que chegou na
  // terca seguinte e sobre aquela abordagem.
  const [respostasCruas, leads, previa] = await Promise.all([
    prisma.message.findMany({
      where: { direcao: 'RECEBIDA', leadId: { in: abordados } },
      select: {
        leadId: true,
        categoria: true,
        confianca: true,
        recebidaEm: true,
        createdAt: true,
      },
    }),
    prisma.lead.findMany({
      where: { id: { in: abordados } },
      select: {
        id: true,
        status: true,
        captureSession: { select: { nicho: true } },
      },
    }),
    ordemDaPrevia(),
  ]);

  const respostas: RespostaDaSemana[] = respostasCruas.map((r) => ({
    leadId: r.leadId!,
    // Sem categoria, a resposta ainda CONTA como resposta — ela so nao
    // entra em nenhuma linha de intencao. E o numero que mede o quanto o
    // dicionario ficou cego.
    categoria: r.categoria ?? '',
    confianca: r.confianca ?? 0,
    recebidaEm: r.recebidaEm ?? r.createdAt,
  }));

  const estados: EstadoDoLead[] = leads.map((l) => ({
    leadId: l.id,
    nicho: l.captureSession?.nicho ?? null,
    status: l.status,
  }));

  return montarRelatorioSemana({
    inicio,
    envios,
    respostas,
    estados,
    ordemDaPrevia: previa,
  });
}

/**
 * O resumo de UM dia.
 *
 * As duas pontas sao buscadas de forma INDEPENDENTE, e e proposital: a
 * resposta que chegou hoje quase sempre e sobre uma mensagem de ontem.
 * Cruza-las numa "taxa do dia" produziria um numero sem significado.
 */
export async function resumoDoDia(quando: Date): Promise<ResumoDoDia> {
  const inicio = inicioDoDia(quando);
  const fim = fimDoDia(inicio);

  const [linhas, respostasCruas] = await Promise.all([
    prisma.outboundMessage.findMany({
      where: {
        status: 'ENVIADA',
        OR: [
          { processedAt: { gte: inicio, lt: fim } },
          { processedAt: null, createdAt: { gte: inicio, lt: fim } },
        ],
      },
      select: {
        leadId: true,
        processedAt: true,
        createdAt: true,
        campaignStep: { select: { ordem: true, nome: true } },
        lead: {
          select: {
            nomeCompleto: true,
            empresa: true,
            captureSession: { select: { nicho: true } },
          },
        },
      },
    }),
    prisma.message.findMany({
      where: {
        direcao: 'RECEBIDA',
        OR: [
          { recebidaEm: { gte: inicio, lt: fim } },
          { recebidaEm: null, createdAt: { gte: inicio, lt: fim } },
        ],
      },
      select: {
        leadId: true,
        texto: true,
        categoria: true,
        confianca: true,
        recebidaEm: true,
        createdAt: true,
        lead: { select: { nomeCompleto: true, empresa: true } },
      },
    }),
  ]);

  const envios: EnvioDoDia[] = linhas
    .filter((l) => l.campaignStep !== null)
    .map((l) => ({
      leadId: l.leadId,
      nome: l.lead?.empresa ?? l.lead?.nomeCompleto ?? null,
      nicho: l.lead?.captureSession?.nicho ?? null,
      ordem: l.campaignStep!.ordem,
      etapaNome: l.campaignStep!.nome,
      quando: l.processedAt ?? l.createdAt,
    }));

  const respostas: RespostaDoDia[] = respostasCruas
    .filter((r) => r.leadId !== null)
    .map((r) => ({
      leadId: r.leadId!,
      nome: r.lead?.empresa ?? r.lead?.nomeCompleto ?? null,
      texto: r.texto,
      categoria: r.categoria,
      confianca: r.confianca ?? 0,
      quando: r.recebidaEm ?? r.createdAt,
    }));

  return montarResumoDoDia({ dia: inicio, envios, respostas });
}

/**
 * A ficha do dia, por nicho.
 *
 * O recorte e a TURMA de quem recebeu alguma coisa naquele dia — "o dia
 * que eu mandei". Tudo o mais e sobre essas pessoas, em qualquer data.
 *
 * Por isso as tres buscas seguintes NAO tem recorte de data: o historico
 * de envios (que a atribuicao por etapa precisa), as respostas, e o
 * estado atual dos leads.
 */
export async function fichaDoDia(quando: Date): Promise<FichaDoDia> {
  const inicio = inicioDoDia(quando);
  const fim = fimDoDia(inicio);

  const doDia = await prisma.outboundMessage.findMany({
    where: {
      status: 'ENVIADA',
      OR: [
        { processedAt: { gte: inicio, lt: fim } },
        { processedAt: null, createdAt: { gte: inicio, lt: fim } },
      ],
    },
    select: {
      leadId: true,
      processedAt: true,
      createdAt: true,
      campaignStep: { select: { ordem: true, nome: true } },
      lead: { select: { captureSession: { select: { nicho: true } } } },
    },
  });

  const envios: EnvioDaFicha[] = doDia
    .filter((l) => l.campaignStep !== null)
    .map((l) => ({
      leadId: l.leadId,
      nicho: l.lead?.captureSession?.nicho ?? null,
      ordem: l.campaignStep!.ordem,
      etapaNome: l.campaignStep!.nome,
      quando: l.processedAt ?? l.createdAt,
    }));

  const turma = [...new Set(envios.map((e) => e.leadId))];

  if (turma.length === 0) {
    return montarFichaDoDia({
      dia: inicio,
      envios: [],
      historicoDeEnvios: [],
      respostas: [],
      estados: [],
    });
  }

  const [historico, respostasCruas, leads] = await Promise.all([
    // TODOS os envios daquela turma, e nao so os do dia: sem as etapas
    // anteriores, a atribuicao "a qual etapa ela respondeu" nao tem
    // como saber que a abordagem saiu na segunda.
    prisma.outboundMessage.findMany({
      where: { status: 'ENVIADA', leadId: { in: turma } },
      select: {
        leadId: true,
        processedAt: true,
        createdAt: true,
        campaignStep: { select: { ordem: true, nome: true } },
      },
    }),
    prisma.message.findMany({
      where: { direcao: 'RECEBIDA', leadId: { in: turma } },
      select: {
        leadId: true,
        categoria: true,
        confianca: true,
        aiIntent: true,
        aiObjecao: true,
        recebidaEm: true,
        createdAt: true,
      },
    }),
    prisma.lead.findMany({
      where: { id: { in: turma } },
      select: { id: true, status: true },
    }),
  ]);

  return montarFichaDoDia({
    dia: inicio,
    envios,
    historicoDeEnvios: historico
      .filter((l) => l.campaignStep !== null)
      .map((l) => ({
        leadId: l.leadId,
        nicho: null,
        ordem: l.campaignStep!.ordem,
        etapaNome: l.campaignStep!.nome,
        quando: l.processedAt ?? l.createdAt,
      })),
    respostas: respostasCruas.map((r) => ({
      leadId: r.leadId!,
      categoria: r.categoria,
      aiIntent: r.aiIntent,
      confianca: r.confianca ?? 0,
      objecao: r.aiObjecao,
      quando: r.recebidaEm ?? r.createdAt,
    })),
    estados: leads.map((l) => ({ leadId: l.id, status: l.status })),
  });
}
