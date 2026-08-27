/**
 * "O Gemini le todas as mensagens do dia."
 *
 * ============================================================
 * O PEDIDO
 * ============================================================
 * "Quero que o proprio gemini veja todas as mensagens do dia e atualizar
 * (mesmo quando eu encaminho manualmente)."
 *
 * Duas coisas que o dicionario nao sabe dar, e que a ficha do dia pede:
 * quem PEDIU PREVIA, e qual foi a OBJECAO. A primeira nao tem termo no
 * dicionario; a segunda nao e classificacao nenhuma — e o texto do que
 * impede.
 *
 * ============================================================
 * "MESMO QUANDO EU ENCAMINHO MANUALMENTE"
 * ============================================================
 * Esta e a parte que muda o desenho. A orquestracao normal so olha
 * respostas que chegaram por uma campanha ativa, no momento em que
 * chegam. Uma conversa que voce tocou na mao, ou que aconteceu enquanto
 * a IA estava desligada, nunca foi lida por ninguem.
 *
 * Entao este servico NAO passa pela cadencia. Ele varre as mensagens
 * RECEBIDAS do dia — todas, tenham vindo de campanha ou nao — e le uma a
 * uma. E uma leitura de historico, e nao uma decisao sobre o futuro.
 *
 * ============================================================
 * ELE NAO DECIDE NADA
 * ============================================================
 * Nao enfileira, nao pausa, nao muda status, nao move o lead. Grava dois
 * campos ao lado da mensagem e para por ai. E por isso que ele pode
 * rodar sobre historico antigo sem risco: o pior erro possivel e uma
 * linha errada num relatorio.
 *
 * ============================================================
 * IDEMPOTENTE POR MENSAGEM
 * ============================================================
 * Rodar duas vezes no mesmo dia nao paga duas vezes: mensagem que ja tem
 * leitura e pulada. `forcar: true` refaz — util quando o prompt muda.
 */
import { prisma } from '@prospector/database';
// Pela factory, e nao pela classe: `gemini.ts` nao e exportado do
// indice do package, e o import dinamico la dentro e o que faz a SDK do
// Google nao ser carregada quando nao ha chave.
import { criarLeitor } from '@prospector/integrations';
import {
  inicioDoDia,
  fimDoDia,
  type MensagemParaLer,
} from '@prospector/domain';
import { carregarEnv } from '@prospector/config';

export interface ResultadoLeituraDoDia {
  dia: string;
  /** Mensagens recebidas naquele dia. */
  total: number;
  /** Quantas foram enviadas ao modelo agora. */
  lidas: number;
  /** Quantas ja tinham leitura e foram puladas. */
  puladas: number;
  /** Quantas falharam — a leitura delas continua nula. */
  falhas: number;
  pediramPrevia: number;
  objecoesEncontradas: number;
  /** Preenchido quando nem comecou: sem chave, IA desligada. */
  motivo?: string;
}

/**
 * Confianca minima para GRAVAR a leitura.
 *
 * O mesmo piso do resto do sistema. Abaixo dele o modelo esta chutando, e
 * um chute gravado vira numero numa tela — que e pior do que um vazio,
 * porque parece dado.
 */
const CONFIANCA_MINIMA = 50;

/**
 * Teto de mensagens por chamada.
 *
 * Um dia normal tem dezenas; um dia de importacao grande pode ter
 * centenas, e cada uma e uma chamada paga. O teto e a diferenca entre
 * "custou alguns centavos" e uma surpresa na fatura.
 */
const TETO_POR_LOTE = 200;

export async function lerMensagensDoDia(p: {
  quando: Date;
  forcar?: boolean;
}): Promise<ResultadoLeituraDoDia> {
  const inicio = inicioDoDia(p.quando);
  const fim = fimDoDia(inicio);
  const dia = inicio.toISOString();

  const env = carregarEnv();
  const chave = env.GEMINI_API_KEY?.trim();
  if (!chave) {
    return {
      dia,
      total: 0,
      lidas: 0,
      puladas: 0,
      falhas: 0,
      pediramPrevia: 0,
      objecoesEncontradas: 0,
      motivo:
        'Não há GEMINI_API_KEY configurada. A leitura precisa do modelo — ' +
        'as outras linhas da ficha continuam funcionando sem ela.',
    };
  }

  // TODAS as recebidas do dia, venham de campanha ou não.
  const mensagens = await prisma.message.findMany({
    where: {
      direcao: 'RECEBIDA',
      OR: [
        { recebidaEm: { gte: inicio, lt: fim } },
        { recebidaEm: null, createdAt: { gte: inicio, lt: fim } },
      ],
    },
    select: {
      id: true,
      leadId: true,
      texto: true,
      aiIntent: true,
      aiObjecao: true,
      recebidaEm: true,
      createdAt: true,
      lead: { select: { empresa: true, nomeCompleto: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: TETO_POR_LOTE,
  });

  const leitor = await criarLeitor({
    GEMINI_API_KEY: chave,
    GEMINI_MODEL: env.GEMINI_MODEL,
    GEMINI_TIMEOUT_MS: env.GEMINI_TIMEOUT_MS,
  });
  // A factory ja devolveu non-null: a checagem de chave aconteceu acima.
  if (!leitor) throw new Error('Leitor indisponivel apesar da chave presente');

  let lidas = 0;
  let puladas = 0;
  let falhas = 0;
  let pediramPrevia = 0;
  let objecoesEncontradas = 0;

  for (const m of mensagens) {
    // Já lida: `aiObjecao` preenchida, OU o intent já marcado como
    // PREVIA. As duas juntas cobrem os dois resultados possíveis de uma
    // leitura bem-sucedida sem objeção.
    const jaLida = m.aiObjecao !== null || m.aiIntent === 'PREVIA';
    if (jaLida && !p.forcar) {
      puladas += 1;
      continue;
    }

    // O que o sistema mandou antes desta resposta. Sem isto, "sim" é
    // ilegível — e "sim" é exatamente o caso que motivou tudo.
    const anterior = await prisma.message.findFirst({
      where: {
        leadId: m.leadId,
        direcao: 'ENVIADA',
        createdAt: { lt: m.recebidaEm ?? m.createdAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { texto: true },
    });

    const entrada: MensagemParaLer = {
      texto: m.texto,
      ultimaMensagemEnviada: anterior?.texto ?? null,
      empresa: m.lead?.empresa ?? m.lead?.nomeCompleto ?? null,
    };

    const r = await leitor.ler(entrada);

    if (!r.ok || !r.leitura) {
      falhas += 1;
      continue;
    }
    if (r.leitura.confianca < CONFIANCA_MINIMA) {
      // Não é falha: o modelo respondeu, e disse que não tem certeza.
      // Gravar um chute seria pior do que deixar em branco.
      falhas += 1;
      continue;
    }

    await prisma.message.update({
      where: { id: m.id },
      data: {
        aiObjecao: r.leitura.objecao,
        // O intent só é sobrescrito para marcar a prévia. Apagar um
        // intent que a orquestração gravou seria trocar uma leitura
        // completa por uma parcial.
        ...(r.leitura.pediuPrevia ? { aiIntent: 'PREVIA' } : {}),
      },
    });

    lidas += 1;
    if (r.leitura.pediuPrevia) pediramPrevia += 1;
    if (r.leitura.objecao) objecoesEncontradas += 1;
  }

  return {
    dia,
    total: mensagens.length,
    lidas,
    puladas,
    falhas,
    pediramPrevia,
    objecoesEncontradas,
  };
}
