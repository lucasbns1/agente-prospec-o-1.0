/**
 * De onde sai o telefone de quem mandou a mensagem.
 *
 * ============================================================
 * O PROBLEMA: @lid
 * ============================================================
 * Ate pouco tempo, toda conversa individual chegava endereçada como
 * `5519999998888@c.us` — o numero antes do `@`. Bastava cortar.
 *
 * O WhatsApp passou a usar tambem o **LID** (Linked ID), um
 * identificador de privacidade que substitui o numero:
 *
 *   75866486894727@lid
 *
 * Cortar no `@` ali devolve `75866486894727`, que NAO e um telefone —
 * sao 14 digitos, e um numero brasileiro tem 13. O sistema identifica o
 * lead pelo telefone normalizado; com LID, nenhum lead e reconhecido,
 * toda resposta vira "contato desconhecido" e a campanha nunca avanca.
 *
 * ============================================================
 * A ESTRATEGIA: VARIAS FONTES, EM ORDEM, E DIGA QUAL FUNCIONOU
 * ============================================================
 * O numero real existe — so nao esta sempre no mesmo campo. A versao da
 * biblioteca, a versao do WhatsApp Web e as configuracoes de privacidade
 * do remetente mudam onde ele aparece.
 *
 * Em vez de apostar num campo, tentamos varios em ordem de confianca e
 * REGISTRAMOS qual resolveu. Assim o log responde "de onde veio este
 * numero?" — pergunta que aparece toda vez que a biblioteca quebra.
 *
 * ============================================================
 * NA DUVIDA, NENHUM NUMERO
 * ============================================================
 * Se nada resolver, devolvemos `null` e o lead cai em "desconhecido".
 * E o comportamento correto: associar a mensagem ao lead ERRADO e muito
 * pior do que deixa-la sem dono na tela esperando sua decisao.
 */

/** De onde o telefone foi obtido. Vai para o log, nunca para a tela. */
export type FonteTelefone =
  | 'from'
  | 'author'
  | 'senderPn'
  | 'contato'
  | 'contato_id'
  | 'nenhuma';

export interface TelefoneResolvido {
  /** Somente digitos, sem `+`. `null` quando nao foi possivel. */
  telefone: string | null;
  fonte: FonteTelefone;
  /** true quando o endereco da conversa e um LID, e nao um numero. */
  ehLid: boolean;
}

/**
 * Comprimentos plausiveis para um telefone com codigo de pais.
 *
 * Serve para descartar LID (14+ digitos sem ser telefone) e lixo. NAO e
 * validacao de verdade — isso e trabalho do dominio, que conhece DDD e
 * as regras do pais. Aqui so barramos o que claramente nao e telefone.
 */
const MIN_DIGITOS = 10;
const MAX_DIGITOS = 15;

function digitos(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const so = valor.replace(/\D/g, '');
  if (so.length < MIN_DIGITOS || so.length > MAX_DIGITOS) return null;
  return so;
}

/** `true` para "...@lid"; `false` para "...@c.us" e o resto. */
export function ehEnderecoLid(endereco: unknown): boolean {
  return typeof endereco === 'string' && endereco.endsWith('@lid');
}

/**
 * Extrai o numero de um JID, mas SO quando ele e do tipo que carrega
 * numero de verdade (`@c.us`). Um `@lid` devolve `null` de proposito.
 */
function doJid(jid: unknown): string | null {
  if (typeof jid !== 'string') return null;
  if (!jid.endsWith('@c.us')) return null;
  return digitos(jid.split('@')[0]);
}

/**
 * Objeto minimo que precisamos da mensagem da biblioteca.
 *
 * Tipado de forma frouxa por necessidade: os campos variam entre versoes
 * do `whatsapp-web.js`, e um tipo rigido daria erro de compilacao para
 * exatamente os campos que estamos tentando descobrir.
 */
export interface MensagemBruta {
  from?: unknown;
  author?: unknown;
  _data?: { senderPn?: unknown; author?: unknown } | null;
  getContact?: () => Promise<{ number?: unknown; id?: { _serialized?: unknown } } | null>;
}

/**
 * Resolve o telefone de quem enviou.
 *
 * Ordem, da fonte mais confiavel para a menos:
 *
 *   1. `from` com `@c.us`   — o caso classico, sem LID
 *   2. `_data.senderPn`     — o "phone number" que o WhatsApp anexa em
 *                             conversas LID
 *   3. `author` com `@c.us` — presente em alguns formatos
 *   4. `getContact().number`— consulta a agenda da sessao
 *   5. `getContact().id`    — o JID do contato, se for `@c.us`
 *
 * As duas ultimas fazem chamada assincrona a biblioteca; por isso a
 * funcao inteira e async. O volume de entrada e baixo, entao o custo
 * nao pesa — e a alternativa e nao identificar o lead.
 */
export async function resolverTelefoneDaMensagem(
  m: MensagemBruta
): Promise<TelefoneResolvido> {
  const ehLid = ehEnderecoLid(m.from);

  // O proprio LID, em digitos. Nenhuma fonte pode devolver este valor
  // como telefone — e o caso exato que quebrou em producao. Testar o
  // comprimento nao basta: um LID de 14 digitos cabe no limite de 15 do
  // E.164, entao a unica regra confiavel e comparar com o LID em maos.
  const lid = ehLid
    ? (String(m.from).split('@')[0] ?? '').replace(/\D/g, '')
    : null;

  const aceitar = (valor: string | null): string | null =>
    valor !== null && valor === lid ? null : valor;

  const doFrom = aceitar(doJid(m.from));
  if (doFrom) return { telefone: doFrom, fonte: 'from', ehLid };

  const senderPn = aceitar(digitos(m._data?.senderPn) ?? doJid(m._data?.senderPn));
  if (senderPn) return { telefone: senderPn, fonte: 'senderPn', ehLid };

  const doAuthor = aceitar(doJid(m.author) ?? doJid(m._data?.author));
  if (doAuthor) return { telefone: doAuthor, fonte: 'author', ehLid };

  // As fontes que exigem ida a biblioteca ficam por ultimo: sao as mais
  // caras e as que podem falhar se a sessao estiver instavel.
  if (typeof m.getContact === 'function') {
    try {
      const contato = await m.getContact();

      const numero = aceitar(digitos(contato?.number));
      if (numero) return { telefone: numero, fonte: 'contato', ehLid };

      const idContato = aceitar(doJid(contato?.id?._serialized));
      if (idContato) return { telefone: idContato, fonte: 'contato_id', ehLid };
    } catch {
      // Uma falha aqui NAO pode derrubar o recebimento. Seguimos sem
      // telefone: a mensagem vira "desconhecido" e voce decide na tela.
    }
  }

  return { telefone: null, fonte: 'nenhuma', ehLid };
}
