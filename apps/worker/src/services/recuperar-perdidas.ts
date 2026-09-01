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
import { publicarEvento } from '../events.js';

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
 * A janela da PRIMEIRA varredura, quando o sistema nunca viu uma
 * mensagem recebida.
 *
 * ============================================================
 * O CASO REAL QUE ISTO RESOLVE
 * ============================================================
 * O provedor novo trouxe o historico inteiro do WhatsApp — milhares de
 * mensagens, meses para tras — e a varredura devolveu `encontradas: 0`.
 * Nao era o historico: era a janela. Ela olhava 72h, e as mensagens que
 * a pessoa queria reencontrar tinham sido mandadas na quinta e na sexta
 * anteriores, cinco e seis dias antes.
 *
 * 72h continua sendo o numero certo para o regime normal, em que a
 * varredura roda a cada poucos minutos e so precisa cobrir um fim de
 * semana de worker desligado. O que estava faltando era o caso de
 * ESTREIA: banco sem nenhuma mensagem recebida, historico inteiro na
 * mao, uma unica chance de aproveita-lo.
 *
 * Dez dias, e nao "tudo": o historico vai a meses, e mensagem de antes
 * de a campanha existir nao e resposta a campanha nenhuma. Dez dias
 * cobrem com folga a semana de trabalho que antecede a estreia, que e o
 * que tem chance de ser resposta de verdade.
 *
 * A marca do reset de fabrica continua vencendo este valor — quem
 * apagou o banco de proposito nao quer o passado de volta.
 */
const JANELA_PRIMEIRA_VEZ_HORAS = 240;

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

/**
 * O relatorio de uma varredura.
 *
 * ============================================================
 * POR QUE TANTOS NUMEROS, E NAO SO "N MENSAGENS"
 * ============================================================
 * Um total sozinho nao responde a pergunta que se faz depois de uma
 * varredura grande: "achou o que eu esperava, ou achou outra coisa?".
 * Sessenta mensagens lidas com sessenta ja conhecidas e uma varredura
 * que funcionou e nao tinha nada a fazer; sessenta lidas com quarenta
 * sem lead e um problema de cadastro. Os dois totais sao iguais.
 *
 * As categorias sao exclusivas de proposito, e fecham a conta:
 *
 *   lidas = novas + jaConhecidas + semLead + erros
 *
 * `manuais` e `manuaisHistoricas` cortam por outro eixo (de quem saiu a
 * mensagem, e quao antiga ela e), entao elas NAO entram nessa soma.
 */
export interface ResultadoRecuperacao {
  /** Quantas o WhatsApp devolveu na janela. */
  lidas: number;
  /** Quantas entraram no banco agora. */
  novas: number;
  /** Quantas ja estavam aqui — a idempotencia trabalhando. */
  jaConhecidas: number;
  desde: Date;
  /** Quando a varredura terminou. Vira o carimbo de sincronizacao. */
  em: Date;
  /** Quantas sairam do SEU numero (manuais), de qualquer idade. */
  manuais: number;
  /** Quantas eram suas, e antigas o bastante para nao pausar nada. */
  manuaisHistoricas: number;
  /** Quantas vieram do lead — o complemento de `manuais`. */
  doLead: number;
  /**
   * Quantas nao bateram com lead nenhum.
   *
   * Nao e erro: e um numero que o cadastro tem que explicar. Elas viram
   * `unknown_contacts` e aparecem na tela de contatos desconhecidos.
   */
  semLead: number;
  /** Quantas estouraram no processamento. Cada uma foi para o log. */
  erros: number;
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
  janelaHoras: number = JANELA_PADRAO_HORAS,
  janelaPrimeiraVezHoras: number = JANELA_PRIMEIRA_VEZ_HORAS
): Promise<Date> {
  const ultima = await prisma.message.findFirst({
    where: { direcao: 'RECEBIDA' },
    orderBy: { recebidaEm: 'desc' },
    select: { recebidaEm: true },
  });

  // Sem nenhuma mensagem recebida no banco, esta e a estreia: vale a
  // janela larga, uma vez so. Na varredura seguinte ja existe uma
  // ultima mensagem conhecida, e a janela normal volta a valer.
  const efetiva = ultima ? janelaHoras : Math.max(janelaHoras, janelaPrimeiraVezHoras);

  const base =
    ultima?.recebidaEm ?? new Date(agora.getTime() - efetiva * 3600_000);

  const comFolga = new Date(base.getTime() - FOLGA_MINUTOS * 60_000);

  // Nunca antes da janela inicial: um banco com uma mensagem antiga e
  // nada depois faria a varredura reler meses de conversa a cada
  // reconexao.
  const piso = new Date(agora.getTime() - efetiva * 3600_000);
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
/**
 * As conversas que o CRM ja conhece, em formato de `chatId`.
 *
 * ============================================================
 * PARA QUE ISTO SERVE (E PARA QUE NAO SERVE)
 * ============================================================
 * E o PLANO B da varredura. O caminho normal pede a lista inteira de
 * conversas ao WhatsApp de uma vez so. Em uso real essa chamada falhou
 * seis vezes seguidas, ao longo de dois minutos, com um erro opaco de
 * dentro do Chromium — enquanto os eventos de mensagem chegavam
 * normalmente. Nao era a sessao: era a consulta a lista completa.
 *
 * Com esta lista, o provedor busca conversa por conversa e a varredura
 * funciona mesmo assim.
 *
 * O que ela NAO cobre: quem o CRM nao conhece. Isso e aceitavel — a
 * varredura de mensagens perdidas existe para reencontrar respostas de
 * LEADS, e um numero que nunca entrou no sistema nao tem lead a
 * reencontrar.
 *
 * Duas fontes, porque uma sozinha deixa buraco: `conversations` tem o
 * `chatId` de verdade (inclusive o formato LID), e os leads cobrem quem
 * recebeu mensagem mas nunca respondeu — que e justamente a maioria.
 */
async function chatIdsConhecidos(): Promise<string[]> {
  const [conversas, leads] = await Promise.all([
    prisma.conversation.findMany({
      where: { chatId: { not: '' } },
      select: { chatId: true },
    }),
    prisma.lead.findMany({
      where: { telefoneNormalizado: { not: null }, optOut: false },
      select: { telefoneNormalizado: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const c of conversas) if (c.chatId) ids.add(c.chatId);
  for (const l of leads) {
    if (l.telefoneNormalizado) ids.add(`${l.telefoneNormalizado}@c.us`);
  }
  return [...ids];
}

export async function recuperarMensagensPerdidas(
  adapter: WhatsAppAdapter,
  log: Logger,
  agora: Date = new Date(),
  janelaHoras: number = JANELA_PADRAO_HORAS,
  janelaPrimeiraVezHoras: number = JANELA_PRIMEIRA_VEZ_HORAS
): Promise<ResultadoRecuperacao> {
  const desde = await inicioDaVarredura(agora, janelaHoras, janelaPrimeiraVezHoras);
  const resultado: ResultadoRecuperacao = {
    lidas: 0,
    novas: 0,
    jaConhecidas: 0,
    desde,
    em: agora,
    manuais: 0,
    manuaisHistoricas: 0,
    doLead: 0,
    semLead: 0,
    erros: 0,
  };

  const brutas = await adapter.mensagensPerdidas(desde, await chatIdsConhecidos());
  resultado.lidas = brutas.length;

  // ============================================================
  // ORDEM CRONOLOGICA, E NAO A ORDEM DA BIBLIOTECA
  // ============================================================
  // O provedor devolve conversa por conversa, e dentro de cada uma a
  // ordem depende de como o WhatsApp pagina o historico. Reprocessar
  // fora de ordem faz o estado do lead terminar errado: um "quanto
  // custa?" aplicado DEPOIS de um "não tenho interesse" deixa o lead
  // morno quando ele saiu da conversa.
  //
  // A cadeia inteira de efeitos (classificar, avancar etapa, cancelar
  // fila, marcar opt-out) supoe que a mensagem anterior ja aconteceu.
  // Ordenar aqui e o que torna essa suposicao verdadeira.
  const mensagens = [...brutas].sort(
    (a, b) => (a.recebidaEm?.getTime() ?? 0) - (b.recebidaEm?.getTime() ?? 0)
  );

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

  // EM SERIE, e nao em paralelo. Nao e cautela exagerada: duas
  // mensagens do mesmo lead processadas ao mesmo tempo disputariam o
  // estado dele — uma avancaria a etapa que a outra acabou de cancelar.
  // A idempotencia impede mensagem duplicada; ela nao impede dois
  // caminhos escrevendo o mesmo lead.
  for (const m of mensagens) {
    try {
      const quando = m.recebidaEm ?? agora;
      const historica = m.deMim === true && quando < corteDoAoVivo;

      if (m.deMim === true) resultado.manuais += 1;
      else resultado.doLead += 1;
      if (historica) resultado.manuaisHistoricas += 1;

      // MESMO pipeline das mensagens ao vivo. Nao ha um segundo caminho
      // para mensagem recuperada — a idempotencia por
      // `provider_message_id` e o que torna o replay seguro, e ela so
      // vale se for o mesmo processamento.
      const r = await processarMensagemRecebida({ ...m, historica });

      if (r.contatoDesconhecidoId) resultado.semLead += 1;
      else if (r.processada && r.messageId) resultado.novas += 1;
      else resultado.jaConhecidas += 1;
    } catch (err) {
      // Uma mensagem problematica nao pode custar as outras. O erro vai
      // para o log com o id, para dar para investigar depois.
      resultado.erros += 1;
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

  // ============================================================
  // A TELA FICA SABENDO NA HORA
  // ============================================================
  // Sem isto, a faixa "WhatsApp sincronizado ha X min" so descobriria a
  // varredura na proxima sondagem — e apertar "buscar o que faltou"
  // pareceria nao ter feito nada por meio minuto.
  //
  // Ele sai SEMPRE, inclusive numa varredura que nao achou nada: e
  // justamente ai que ele mais serve, porque e o que diferencia
  // "rodou e nao havia nada" de "parou de rodar".
  //
  // As mensagens que ENTRARAM ja publicaram os eventos delas la no
  // inbound, pelo mesmo caminho das mensagens ao vivo. Este aqui fala
  // pela VARREDURA, nao pelas mensagens.
  void publicarEvento('sincronizacao.atualizada', {
    em: agora.toISOString(),
    lidas: resultado.lidas,
    novas: resultado.novas,
    jaConhecidas: resultado.jaConhecidas,
    manuais: resultado.manuais,
    manuaisHistoricas: resultado.manuaisHistoricas,
    doLead: resultado.doLead,
    semLead: resultado.semLead,
    erros: resultado.erros,
  });

  // Os cartoes do dashboard so mudam quando algo mudou de fato. Um aviso
  // a cada cinco minutos dizendo "nada novo" faria a tela recarregar
  // sozinha o dia inteiro sem motivo.
  if (resultado.novas > 0) void publicarEvento('dashboard.atualizar');

  return resultado;
}
