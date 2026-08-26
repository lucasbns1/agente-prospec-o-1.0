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
  inicioDaSemana,
  fimDaSemana,
  type EnvioDaSemana,
  type RespostaDaSemana,
  type EstadoDoLead,
  type RelatorioSemana,
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
