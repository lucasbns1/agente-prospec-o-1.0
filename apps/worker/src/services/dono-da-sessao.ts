/**
 * Um worker de cada vez — e o segundo diz por que nao subiu.
 *
 * ============================================================
 * O DEFEITO QUE ISTO TORNA IMPOSSIVEL
 * ============================================================
 * Dois workers abrem a MESMA pasta de sessao e conectam com a MESMA
 * credencial. O WhatsApp nao aceita: ele derruba um, o derrubado
 * reconecta e derruba o outro, e os dois ficam se expulsando. O que
 * aparece na tela e `401 Connection Failure`, repetido, ate as
 * tentativas acabarem e o canal parar em "Falhou".
 *
 * Nada no erro diz "ha outro worker". Pelo contrario: ele parece um
 * problema de credencial, e a reacao natural e apagar a sessao e
 * escanear o QR de novo — o que reconecta e recomeca a briga.
 *
 * Acontece mais facil do que parece: um `pnpm dev` esquecido em outro
 * PowerShell, uma janela minimizada, ou a ferramenta aberta em dois
 * computadores contra o mesmo banco.
 *
 * ============================================================
 * COMO A TRAVA FUNCIONA
 * ============================================================
 * Uma chave no Redis com dono e prazo. Quem esta vivo renova; quem
 * morreu deixa a chave expirar, e o proximo worker assume sem ninguem
 * precisar limpar nada — um cadeado que so abre na mao seria pior do
 * que o problema, porque uma queda feia deixaria a ferramenta travada.
 *
 * A trava e por SESSAO, e nao por maquina: dois workers em numeros
 * diferentes nao se atrapalham, e e por isso que a chave carrega o
 * caminho da sessao.
 */

/** O minimo de Redis que isto precisa — para o teste nao subir um. */
export interface RedisDaTrava {
  set(
    chave: string,
    valor: string,
    modo: 'EX',
    segundos: number,
    condicao: 'NX'
  ): Promise<'OK' | null>;
  get(chave: string): Promise<string | null>;
  expire(chave: string, segundos: number): Promise<number>;
  del(chave: string): Promise<number>;
}

export const PRAZO_SEGUNDOS = 60;
/** Renova bem antes de vencer: um atraso nao pode soltar a trava. */
export const RENOVACAO_MS = 20_000;

export function chaveDaTrava(sessao: string): string {
  return `prospector:worker:dono:${sessao}`;
}

export interface ResultadoDaTrava {
  assumiu: boolean;
  /** Quem esta com a trava, quando nao foi possivel assumir. */
  dono?: string;
}

/**
 * Tenta virar o dono da sessao.
 *
 * `SET NX EX` e a operacao inteira: ou grava porque ninguem tinha, ou
 * nao grava. Nao ha janela entre "consultar" e "gravar" — que e
 * justamente por onde dois workers subindo juntos passariam.
 */
export async function assumirSessao(
  redis: RedisDaTrava,
  sessao: string,
  identidade: string
): Promise<ResultadoDaTrava> {
  const chave = chaveDaTrava(sessao);
  const ok = await redis.set(chave, identidade, 'EX', PRAZO_SEGUNDOS, 'NX');

  if (ok === 'OK') return { assumiu: true };

  const dono = await redis.get(chave);

  // A propria identidade na chave e o caso do reinicio rapido: o mesmo
  // worker voltando antes de a chave anterior vencer. Nao e disputa.
  if (dono === identidade) {
    await redis.expire(chave, PRAZO_SEGUNDOS);
    return { assumiu: true };
  }

  return { assumiu: false, ...(dono ? { dono } : {}) };
}

/**
 * Renova o prazo. Devolve false quando a trava ja nao e nossa — o que
 * significa que outro worker assumiu enquanto este estava lento.
 */
export async function renovarSessao(
  redis: RedisDaTrava,
  sessao: string,
  identidade: string
): Promise<boolean> {
  const chave = chaveDaTrava(sessao);
  const dono = await redis.get(chave);

  if (dono !== identidade) return false;

  await redis.expire(chave, PRAZO_SEGUNDOS);
  return true;
}

/**
 * Solta a trava no encerramento — mas SO se ainda for nossa.
 *
 * Sem essa checagem, um worker lento encerrando apagaria a chave de
 * quem ja tinha assumido, e a briga comecaria de novo com a diferenca
 * de ninguem estar olhando.
 */
export async function soltarSessao(
  redis: RedisDaTrava,
  sessao: string,
  identidade: string
): Promise<boolean> {
  const chave = chaveDaTrava(sessao);
  const dono = await redis.get(chave);

  if (dono !== identidade) return false;

  await redis.del(chave);
  return true;
}
