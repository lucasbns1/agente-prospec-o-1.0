/**
 * A traducao entre o vocabulario do Baileys e o do sistema — e o
 * arquivo de mensagens que substitui o store que o Baileys nao tem.
 *
 * ============================================================
 * POR QUE ESTA PARTE MORA SEPARADA
 * ============================================================
 * O provedor de verdade precisa de um socket aberto e de um celular
 * pareado. Nada disso cabe numa suite automatizada.
 *
 * O que cabe — e o que erra na pratica — sao as decisoes: qual campo
 * vira telefone, o que fazer com uma conversa `@lid`, como uma mensagem
 * de tres dias atras se compara com a janela pedida, o que fazer quando
 * a mesma mensagem chega duas vezes. Tudo isso e funcao pura, e mora
 * aqui.
 *
 * ============================================================
 * O BAILEYS NAO TEM STORE
 * ============================================================
 * O `whatsapp-web.js` mantem uma copia das conversas dentro da pagina, e
 * `getChats()` le dali. O Baileys nao tem esse conceito: ele ENTREGA os
 * eventos e nao guarda nada.
 *
 * Em troca, ele entrega uma coisa que o outro nunca teve: um pacote de
 * historico no pareamento (`messaging-history.set`), enviado pelo
 * proprio protocolo. Nao e uma consulta que pode falhar — e o WhatsApp
 * empurrando o que aconteceu.
 *
 * Entao o arquivo aqui e simples: guardamos o que passa, e servimos
 * dele. E memoria, some quando o worker reinicia, e nao tem problema —
 * o que importa ja foi para o Postgres pelo mesmo caminho de sempre.
 */

import type { MensagemProvedor } from './provedor.js';

/** Um sufixo `@lid` NAO e telefone. Ver `telefone-da-mensagem.ts`. */
const SUFIXO_LID = '@lid';

/** Conversa de um numero. Grupo e `@g.us`, e nao interessa. */
const SUFIXO_NUMERO = '@s.whatsapp.net';

/**
 * O telefone de um endereco do Baileys.
 *
 * O Baileys usa `55119...@s.whatsapp.net` onde o whatsapp-web.js usa
 * `55119...@c.us`. O numero e o mesmo; so o sufixo muda.
 *
 * `null` para grupo, para LID, e para qualquer coisa que nao seja
 * digitos. Um LID devolvido como telefone nao casa com lead nenhum e
 * ainda contamina o cadastro — melhor ficar sem numero.
 */
export function telefoneDoJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  if (jid.endsWith(SUFIXO_LID)) return null;
  if (jid.includes('@g.us')) return null;

  const antes = jid.split('@')[0] ?? '';
  // O sufixo `:12` de dispositivo (`5511999:12@...`) nao faz parte do
  // numero.
  const semDispositivo = antes.split(':')[0] ?? '';
  const so = semDispositivo.replace(/\D/g, '');

  // Menos de 8 digitos nao e telefone de ninguem; mais de 15 estoura o
  // E.164. Nos dois casos e melhor devolver nada.
  return so.length >= 8 && so.length <= 15 ? so : null;
}

/** `true` para conversa de grupo — a varredura as ignora. */
export function ehGrupo(jid: string | null | undefined): boolean {
  return typeof jid === 'string' && jid.includes('@g.us');
}

/**
 * O texto de uma mensagem do Baileys.
 *
 * Ele guarda o texto em lugares diferentes conforme o tipo: uma mensagem
 * simples usa `conversation`, uma com formatacao ou resposta usa
 * `extendedTextMessage.text`, uma foto com legenda usa a `caption`.
 *
 * Procurar num lugar so faria mensagens inteiras chegarem vazias — e uma
 * resposta vazia nao classifica, nao avanca etapa e nao vira nada.
 */
export function textoDaMensagem(m: unknown): string {
  const msg = (m as { message?: Record<string, unknown> } | null)?.message;
  if (!msg) return '';

  const conversa = msg.conversation;
  if (typeof conversa === 'string' && conversa) return conversa;

  const estendida = (msg.extendedTextMessage as { text?: unknown } | undefined)?.text;
  if (typeof estendida === 'string' && estendida) return estendida;

  for (const chave of ['imageMessage', 'videoMessage', 'documentMessage']) {
    const legenda = (msg[chave] as { caption?: unknown } | undefined)?.caption;
    if (typeof legenda === 'string' && legenda) return legenda;
  }

  return '';
}

/** `true` quando a mensagem carrega midia — foto, video, audio, arquivo. */
export function temMidia(m: unknown): boolean {
  const msg = (m as { message?: Record<string, unknown> } | null)?.message;
  if (!msg) return false;
  return [
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'documentMessage',
    'stickerMessage',
  ].some((k) => msg[k] !== undefined);
}

/** O tipo, para o log e para o registro. `chat` quando e so texto. */
export function tipoDaMensagem(m: unknown): string {
  const msg = (m as { message?: Record<string, unknown> } | null)?.message;
  if (!msg) return 'chat';
  if (msg.imageMessage) return 'image';
  if (msg.videoMessage) return 'video';
  if (msg.audioMessage) return 'audio';
  if (msg.documentMessage) return 'document';
  if (msg.stickerMessage) return 'sticker';
  return 'chat';
}

/**
 * Chaves que identificam um aviso do protocolo, e nao uma mensagem.
 *
 * `protocolMessage` cobre a maioria (historico, revogacao, chaves);
 * os outros aparecem sozinhos em situacoes especificas.
 */
const AVISOS_DE_PROTOCOLO = [
  'protocolMessage',
  'senderKeyDistributionMessage',
  'deviceSentMessage',
  'messageContextInfo',
  'reactionMessage',
  'pollUpdateMessage',
];

export function temAvisoDeProtocolo(m: unknown): boolean {
  const msg = (m as { message?: Record<string, unknown> } | null)?.message;
  if (!msg) return false;

  const chaves = Object.keys(msg);
  // `messageContextInfo` VEM JUNTO de mensagens de verdade, entao ele so
  // condena a mensagem quando esta sozinho — do contrario descartariamos
  // respostas legitimas.
  const uteis = chaves.filter((k) => !AVISOS_DE_PROTOCOLO.includes(k));
  if (uteis.length > 0) return false;

  return chaves.some((k) => AVISOS_DE_PROTOCOLO.includes(k));
}

interface MensagemBaileys {
  key?: {
    id?: string | null;
    remoteJid?: string | null;
    fromMe?: boolean | null;
    participant?: string | null;
  } | null;
  messageTimestamp?: number | Long | null;
  pushName?: string | null;
  message?: Record<string, unknown> | null;
}

/** O `Long` do protobuf, quando o timestamp nao vem como number. */
interface Long {
  toNumber(): number;
}

function segundos(t: MensagemBaileys['messageTimestamp']): number {
  if (typeof t === 'number') return t;
  if (t && typeof (t as Long).toNumber === 'function') return (t as Long).toNumber();
  return Math.floor(Date.now() / 1000);
}

/**
 * Converte uma mensagem do Baileys para o formato do sistema.
 *
 * Devolve `null` quando nao ha o que aproveitar: sem id, de grupo, ou
 * sem texto nenhum. Deixar passar uma mensagem vazia so produziria uma
 * linha inutil no historico e uma classificacao sem entrada.
 */
export function traduzir(m: MensagemBaileys): MensagemProvedor | null {
  const id = m.key?.id;
  const jid = m.key?.remoteJid;
  if (!id || !jid) return null;
  if (ehGrupo(jid)) return null;

  // ============================================================
  // O QUE NAO E MENSAGEM
  // ============================================================
  // O WhatsApp entrega, pelo MESMO canal das mensagens, uma serie de
  // avisos internos do protocolo: os pedacos do historico, revogacoes,
  // sincronizacao de dispositivos, chaves.
  //
  // Em uso real eles passaram e viraram "contatos desconhecidos": o log
  // mostrava `Mensagem recebida processada / leadId: null` com ids que
  // eram exatamente os das notificacoes de historico do Baileys. Lixo no
  // cadastro, e uma tela de contatos desconhecidos cheia de coisa que
  // nunca foi conversa com ninguem.
  //
  // A checagem e explicita, e nao so "sem texto": um `protocolMessage`
  // as vezes carrega conteudo, e mesmo assim nao e uma mensagem.
  if (temAvisoDeProtocolo(m)) return null;

  const texto = textoDaMensagem(m);
  const midia = temMidia(m);
  // Sem texto E sem midia nao ha mensagem: e um evento de sistema
  // (revogacao, reacao) que o WhatsApp entrega junto.
  if (!texto && !midia) return null;

  const fromMe = m.key?.fromMe === true;
  // Numa conversa `@lid`, `participant` as vezes traz o numero real.
  const telefone = telefoneDoJid(jid) ?? telefoneDoJid(m.key?.participant);

  return {
    id,
    from: jid,
    to: '',
    body: texto,
    timestamp: segundos(m.messageTimestamp),
    fromMe,
    type: tipoDaMensagem(m),
    hasMedia: midia,
    notifyName: m.pushName ?? null,
    telefone,
    fonteTelefone: telefoneDoJid(jid) ? 'jid' : telefone ? 'participant' : 'nenhuma',
  };
}

/**
 * O arquivo de mensagens que o Baileys nao mantem.
 *
 * ============================================================
 * POR QUE UM TETO, E POR QUE ELE E POR CONVERSA
 * ============================================================
 * O pacote de historico do pareamento pode trazer dezenas de milhares de
 * mensagens de uma vez. Guardar tudo estouraria a memoria do worker.
 *
 * O teto e POR CONVERSA, e nao global: com um teto global, uma unica
 * conversa movimentada expulsaria todas as outras — e o lead que
 * respondeu uma vez, que e justamente quem interessa, seria o primeiro a
 * sumir.
 */
/**
 * Qual endereco usar para enviar, dado o que o WhatsApp respondeu.
 *
 * ============================================================
 * O DEFEITO QUE ISTO CONSERTA — O NONO DIGITO
 * ============================================================
 * Montavamos o endereco colando `@c.us` nos digitos do lead e mandavamos
 * para ali, sem perguntar nada a ninguem. Para Sao Paulo isso funciona.
 * Para o resto do Brasil, muitas vezes nao.
 *
 * O caso real, com o print do CRM ao lado do print do WhatsApp:
 *
 *   CRM:      5535998598710  "Boa tarde!"  ENVIADA
 *   WhatsApp: +55 35 9859-8710 — conversa VAZIA
 *
 * Repare no numero que o WhatsApp mostra: ele tem um digito a MENOS. A
 * conta daquela pessoa foi registrada antes de o nono digito existir, e
 * o endereco de verdade dela e `553598598710@s.whatsapp.net`. Mandamos
 * para `5535998598710@c.us`, que nao e a conta de ninguem.
 *
 * O envio nao deu erro. Nao ha para quem dar erro: o endereco e
 * sintaticamente valido, so nao pertence a nenhuma conta. A mensagem
 * saiu do CRM, foi marcada ENVIADA, e nao chegou em lugar nenhum.
 *
 * Isso explica o padrao inteiro do relato: as unicas mensagens que
 * apareceram no celular foram as de DDD 11, e as de DDD 35 — a campanha
 * de Minas — sumiram todas.
 *
 * ============================================================
 * A REGRA
 * ============================================================
 * Quem sabe o endereco de uma conta e o WhatsApp, e ele responde isso em
 * `onWhatsApp`. Entao a regra e simples: perguntar, e usar a resposta.
 *
 * Nao tentamos adivinhar quando tirar ou por o nono digito. Regra
 * inventada erra nos dois sentidos, e o custo de errar e mandar mensagem
 * para a pessoa errada.
 */
export interface RespostaOnWhatsApp {
  jid?: string;
  exists?: boolean;
}

export type EscolhaDeJid =
  | { ok: true; jid: string; mudou: boolean }
  | { ok: false; motivo: 'nao-tem-whatsapp' | 'sem-resposta' };

export function escolherJid(
  chatIdPedido: string,
  resposta: RespostaOnWhatsApp[] | null | undefined
): EscolhaDeJid {
  // Sem resposta NAO e "nao tem WhatsApp": e "nao consegui perguntar".
  // Tratar os dois como a mesma coisa faria uma falha de rede descartar
  // a lista inteira de leads como invalida.
  if (!Array.isArray(resposta) || resposta.length === 0) {
    return { ok: false, motivo: 'sem-resposta' };
  }

  const primeira = resposta[0];
  if (primeira?.exists !== true || typeof primeira.jid !== 'string' || !primeira.jid) {
    return { ok: false, motivo: 'nao-tem-whatsapp' };
  }

  // Comparacao pelos DIGITOS, e nao pela string inteira: o pedido vem
  // como `...@c.us` e a resposta vem como `...@s.whatsapp.net`. Comparar
  // as strings acusaria mudanca em todo envio e o log perderia o valor.
  const digitos = (s: string): string => s.split('@')[0]?.replace(/\D/g, '') ?? '';

  return {
    ok: true,
    jid: primeira.jid,
    mudou: digitos(primeira.jid) !== digitos(chatIdPedido),
  };
}

export class ArquivoDeMensagens {
  private readonly porConversa = new Map<string, MensagemProvedor[]>();

  constructor(private readonly maxPorConversa = 60) {}

  /** Quantas conversas ha no arquivo. */
  get conversas(): number {
    return this.porConversa.size;
  }

  /** Quantas mensagens ao todo. */
  get total(): number {
    let n = 0;
    for (const lista of this.porConversa.values()) n += lista.length;
    return n;
  }

  /**
   * Guarda uma mensagem. Repetida NAO entra duas vezes.
   *
   * A dedupe aqui e por conveniencia — a garantia real e a UNIQUE do
   * banco. Mas sem ela o mesmo id apareceria varias vezes numa
   * varredura, e o relatorio ("lidas: 340") mentiria.
   */
  guardar(m: MensagemProvedor): void {
    const lista = this.porConversa.get(m.from) ?? [];
    if (lista.some((x) => x.id === m.id)) return;

    lista.push(m);
    // Mais antiga primeiro: o pipeline aplica efeitos na ordem em que
    // recebe, e um "pare" processado antes do "quero" inverteria o
    // resultado final do lead.
    lista.sort((a, b) => a.timestamp - b.timestamp);

    // Estourou o teto: as mais ANTIGAS saem. Uma varredura olha para
    // tras dias, nao meses.
    if (lista.length > this.maxPorConversa) {
      lista.splice(0, lista.length - this.maxPorConversa);
    }

    this.porConversa.set(m.from, lista);
  }

  /**
   * Tudo o que esta guardado, sem filtro.
   *
   * Existe para o arquivo poder ir para o disco. O pacote de historico
   * chega UMA vez, no pareamento — numa reconexao o WhatsApp nao manda
   * de novo ("skipping history sync wait"). Sem uma copia em disco, um
   * `git pull` seguido de reinicio joga fora meses de conversa que so
   * voltam se a pessoa parear o aparelho outra vez.
   */
  todas(): MensagemProvedor[] {
    const saida: MensagemProvedor[] = [];
    for (const lista of this.porConversa.values()) saida.push(...lista);
    return saida;
  }

  /** Guarda varias de uma vez. Devolve quantas eram novas. */
  guardarVarias(ms: MensagemProvedor[]): number {
    const antes = this.total;
    for (const m of ms) this.guardar(m);
    return this.total - antes;
  }

  /**
   * Tudo o que aconteceu a partir de `desde`, em ordem cronologica.
   *
   * `chatIds` restringe as conversas — usado quando quem chama sabe com
   * quem falou e nao quer o resto.
   */
  desde(quando: Date, chatIds?: string[]): MensagemProvedor[] {
    const corte = Math.floor(quando.getTime() / 1000);
    const filtro = chatIds?.length ? new Set(chatIds) : null;
    const saida: MensagemProvedor[] = [];

    for (const [jid, lista] of this.porConversa) {
      if (filtro && !filtro.has(jid)) continue;
      for (const m of lista) {
        if (m.timestamp >= corte) saida.push(m);
      }
    }

    return saida.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * A mensagem NOSSA com este texto, nesta conversa, a partir de `desde`.
   *
   * E o que responde "o envio saiu ou nao?" quando a promessa do envio
   * nao volta. Devolve o id, ou `null`.
   */
  procurarEnviada(chatId: string, texto: string, desde: Date): string | null {
    const corte = Math.floor(desde.getTime() / 1000);
    const alvo = texto.trim();
    const lista = this.porConversa.get(chatId) ?? [];

    // Da mais recente para a mais antiga: um envio recem-feito esta no
    // fim, e procurar do inicio percorreria o historico inteiro a toa.
    for (let i = lista.length - 1; i >= 0; i -= 1) {
      const m = lista[i]!;
      if (m.timestamp < corte) break;
      if (m.fromMe && m.body.trim() === alvo) return m.id;
    }

    return null;
  }
}
