/**
 * As respostas que chegaram enquanto o worker estava fora do ar.
 *
 * ============================================================
 * O BURACO QUE ISTO FECHA
 * ============================================================
 * O evento `message` do WhatsApp so existe AO VIVO. Se o worker nao
 * estiver rodando no instante em que o lead responde, aquele evento
 * nunca e reentregue: a mensagem fica na conversa do celular e o
 * sistema simplesmente nunca soube dela.
 *
 * Isso aconteceu na validacao real, e do jeito mais silencioso
 * possivel:
 *
 *   01:18:48  mensagem 1 enviada
 *   01:18     lead responde "claro!"
 *   (o worker estava reiniciando naquele instante)
 *
 * A resposta apareceu no WhatsApp do lead e do usuario. No sistema, o
 * diagnostico mostrou `RESPOSTAS DELE (0)` — nem mensagem, nem contato
 * desconhecido, nem erro. A sequencia morreu ali, e nao havia nada em
 * lugar nenhum apontando o porque.
 *
 * Reiniciar o worker nao e excecao: acontece a cada `git pull`, a cada
 * queda do Chromium, toda vez que o computador dorme. Uma automacao que
 * perde respostas nesses momentos nao da para confiar.
 *
 * ============================================================
 * POR QUE O REPLAY E SEGURO
 * ============================================================
 * `processarMensagemRecebida` e idempotente por `provider_message_id`,
 * garantido por uma constraint UNIQUE. Reprocessar uma mensagem ja
 * conhecida nao cria linha nova, nao reaplica efeito e nao reenfileira
 * nada — ela colide e volta como `processada: false`.
 *
 * Por isso a varredura pode ser generosa na janela: e melhor reler cem
 * mensagens conhecidas do que perder uma.
 */
import { prisma } from '@prospector/database';
import type { WhatsAppAdapter } from '@prospector/integrations';
import type { Logger } from 'pino';
import { processarMensagemRecebida } from './inbound.js';

/**
 * Ate quando olhar para tras quando nao ha marca melhor.
 *
 * ============================================================
 * ERA UMA CONSTANTE, E ELA VIRAVA UM TETO
 * ============================================================
 * Com 24h fixo, quem descobria na segunda que o worker caiu na sexta
 * perdia as respostas em definitivo — a varredura simplesmente nao
 * olhava tao para tras.
 *
 * Agora quem manda e `WHATSAPP_RECONCILIATION_WINDOW_HOURS` (padrao
 * 72h, um fim de semana inteiro). Este valor continua aqui como piso
 * para quem chama sem configuracao — os testes, tipicamente.
 *
 * Nao adianta subir muito: mensagens de antes de o sistema existir nao
 * sao resposta a campanha nenhuma, e a marca do reset de fabrica vence
 * este valor de qualquer forma.
 */
const JANELA_PADRAO_HORAS = 24;

/**
 * Folga aplicada para tras a partir da ultima mensagem conhecida.
 *
 * Sem ela, uma mensagem que chegou no MESMO segundo da ultima
 * processada ficaria de fora — e foi exatamente esse o caso real
 * (envio 01:18:48, resposta 01:18). Os relogios do celular, do WhatsApp
 * e do banco tambem nao sao o mesmo relogio.
 *
 * O custo de errar para mais e reprocessar mensagens conhecidas, que a
 * idempotencia descarta. O custo de errar para menos e perder a
 * resposta de um cliente.
 */
const FOLGA_MINUTOS = 10;

/**
 * Marca deixada pelo reset de fabrica.
 *
 * ============================================================
 * POR QUE ISTO PRECISA EXISTIR
 * ============================================================
 * O reset apaga o banco, mas NAO apaga a conversa no WhatsApp — nem
 * poderia: aquilo e o celular do usuario, e apagar a conversa de alguem
 * sem pedir seria inaceitavel.
 *
 * So que a varredura le as conversas. Depois de um reset, os "quero
 * sim" e "claro!" dos testes antigos continuam la, e seriam lidos como
 * respostas novas: o lead recem-importado nasceria QUENTE, com um
 * historico de conversa que nunca teve com aquela campanha.
 *
 * Pior no uso real: reimportar uma lista para uma campanha nova faria
 * cada lead herdar a ultima resposta que deu para a campanha ANTERIOR —
 * e um "nao tenho interesse" de tres meses atras encerraria a nova
 * sequencia antes da primeira mensagem sair.
 *
 * A marca resolve isso sem tocar em nada do usuario: o reset grava
 * "comece a olhar daqui", e tudo que e mais velho deixa de existir para
 * o sistema.
 */
export const CHAVE_VARREDURA_DESDE = 'canal.varredura_desde';

async function marcaDoReset(): Promise<Date | null> {
  const s = await prisma.setting.findUnique({
    where: { chave: CHAVE_VARREDURA_DESDE },
    select: { valor: true },
  });
  if (typeof s?.valor !== 'string') return null;

  const d = new Date(s.valor);
  // Valor corrompido nao pode virar `Invalid Date` e envenenar a
  // comparacao — toda data comparada com NaN da false, e a varredura
  // passaria a ler tudo de novo em silencio.
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ResultadoRecuperacao {
  lidas: number;
  novas: number;
  jaConhecidas: number;
  desde: Date;
  /** Quando a varredura terminou. Vira o carimbo de sincronizacao. */
  em: Date;
  /** Quantas eram suas, e antigas o bastante para nao pausar nada. */
  manuaisHistoricas: number;
}

/**
 * Onde fica o carimbo da ultima varredura bem-sucedida.
 *
 * E ele que alimenta o "WhatsApp sincronizado ha X minutos" da tela. Sem
 * um carimbo, uma varredura que parou de rodar e indistinguivel de uma
 * que roda e nao acha nada — e as duas dao a mesma tela: zero mensagens
 * novas.
 */
export const CHAVE_ULTIMA_VARREDURA = 'canal.ultima_varredura';

/** Quantas mensagens NOVAS a ultima varredura trouxe. */
export const CHAVE_RECUPERADAS_NA_ULTIMA = 'canal.ultima_varredura_novas';

/**
 * De quando comecar a varredura.
 *
 * Da ultima mensagem RECEBIDA que o sistema conhece, menos a folga.
 * Usar a ultima ENVIADA seria errado: se o worker ficou dias fora, a
 * ultima coisa que ele fez foi enviar, e as respostas vieram depois.
 */
export async function inicioDaVarredura(
  agora: Date = new Date(),
  janelaHoras: number = JANELA_PADRAO_HORAS
): Promise<Date> {
  const ultima = await prisma.message.findFirst({
    where: { direcao: 'RECEBIDA' },
    orderBy: { recebidaEm: 'desc' },
    select: { recebidaEm: true },
  });

  const base =
    ultima?.recebidaEm ?? new Date(agora.getTime() - janelaHoras * 3600_000);

  const comFolga = new Date(base.getTime() - FOLGA_MINUTOS * 60_000);

  // Nunca antes da janela inicial: um banco com uma mensagem antiga e
  // nada depois faria a varredura reler meses de conversa a cada
  // reconexao.
  const piso = new Date(agora.getTime() - janelaHoras * 3600_000);
  const resultado = comFolga < piso ? piso : comFolga;

  // A marca do reset vence os dois. Ela e uma afirmacao explicita —
  // "o que veio antes disto nao me pertence" — e nenhum calculo de
  // janela pode passar por cima dela.
  const marca = await marcaDoReset();
  if (marca && resultado < marca) return marca;

  return resultado;
}

/**
 * Le as conversas e processa o que ficou para tras.
 *
 * Processa em SERIE, e nao em paralelo: os efeitos de uma resposta
 * (avancar etapa, cancelar fila, opt-out) dependem do estado que a
 * anterior deixou. Duas mensagens do mesmo lead em paralelo poderiam
 * aplicar efeitos fora de ordem — e um "quero" processado depois de um
 * "pare" reabriria uma sequencia que o lead pediu para encerrar.
 */
export async function recuperarMensagensPerdidas(
  adapter: WhatsAppAdapter,
  log: Logger,
  agora: Date = new Date(),
  janelaHoras: number = JANELA_PADRAO_HORAS
): Promise<ResultadoRecuperacao> {
  const desde = await inicioDaVarredura(agora, janelaHoras);
  const resultado: ResultadoRecuperacao = {
    lidas: 0,
    novas: 0,
    jaConhecidas: 0,
    desde,
    em: agora,
    manuaisHistoricas: 0,
  };

  const mensagens = await adapter.mensagensPerdidas(desde);
  resultado.lidas = mensagens.length;

  // ============================================================
  // O QUE E "HISTORICO", E POR QUE ISSO IMPORTA
  // ============================================================
  // A varredura tambem recupera mensagens SUAS, digitadas no celular.
  // No caminho ao vivo, uma mensagem sua PAUSA a automacao daquele lead
  // — voce entrou na conversa, o robo sai.
  //
  // Aplicar isso a uma mensagem de tres dias atras seria absurdo:
  // pausaria hoje uma conversa por causa de algo que ja aconteceu, e o
  // lead ficaria travado esperando uma decisao que voce tomou na
  // sexta-feira.
  //
  // O corte e a mesma FOLGA que a janela usa: mais nova que isso ainda
  // e "efetivamente agora" (worker reiniciando), e se comporta como ao
  // vivo. Mais velha e passado, e so entra no historico.
  const corteDoAoVivo = new Date(agora.getTime() - FOLGA_MINUTOS * 60_000);

  for (const m of mensagens) {
    try {
      const quando = m.recebidaEm ?? agora;
      const historica = m.deMim === true && quando < corteDoAoVivo;
      if (historica) resultado.manuaisHistoricas += 1;

      // MESMO pipeline das mensagens ao vivo. Nao ha um segundo caminho
      // para mensagem recuperada — a idempotencia por
      // `provider_message_id` e o que torna o replay seguro, e ela so
      // vale se for o mesmo processamento.
      const r = await processarMensagemRecebida({ ...m, historica });
      if (r.processada && r.messageId) resultado.novas += 1;
      else resultado.jaConhecidas += 1;
    } catch (err) {
      // Uma mensagem problematica nao pode custar as outras. O erro vai
      // para o log com o id, para dar para investigar depois.
      log.error(
        { err, providerMessageId: m.providerMessageId },
        'Falha ao reprocessar mensagem da varredura'
      );
    }
  }

  // O carimbo so e gravado no fim, e so quando chegou aqui: uma
  // varredura que estourou no meio nao pode dizer "sincronizado agora".
  await prisma.setting.upsert({
    where: { chave: CHAVE_ULTIMA_VARREDURA },
    update: { valor: agora.toISOString() },
    create: {
      chave: CHAVE_ULTIMA_VARREDURA,
      valor: agora.toISOString(),
      descricao: 'Quando a ultima varredura do WhatsApp terminou bem',
    },
  });
  await prisma.setting.upsert({
    where: { chave: CHAVE_RECUPERADAS_NA_ULTIMA },
    update: { valor: resultado.novas },
    create: {
      chave: CHAVE_RECUPERADAS_NA_ULTIMA,
      valor: resultado.novas,
      descricao: 'Mensagens novas trazidas pela ultima varredura',
    },
  });

  return resultado;
}
