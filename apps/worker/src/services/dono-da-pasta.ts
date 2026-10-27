/**
 * A trava que vive NA PASTA DA SESSAO, e nao no Redis.
 *
 * ============================================================
 * POR QUE A TRAVA DO REDIS NAO ALCANCA ISTO
 * ============================================================
 * Ja existe uma trava por sessao em `dono-da-sessao.ts`. Ela resolve o
 * caso de dois `pnpm dev` na mesma copia — e so esse.
 *
 * Duas COPIAS da ferramenta usam bancos diferentes do Redis (e esse
 * isolamento e proposital: filas e estado nao podem se misturar). O
 * efeito colateral e que a trava de uma copia e invisivel para a
 * outra. Se as duas acabarem apontando para a MESMA pasta de sessao —
 * por um `WHATSAPP_SESSION_PATH` esquecido, por uma variavel que nao
 * pegou, por um caminho relativo que resolveu para o mesmo lugar —
 * nada avisa.
 *
 * O sintoma e exatamente o que apareceu em uso: conecta uma copia, e a
 * outra passa a pedir QR. Elas estao usando a mesma credencial, e cada
 * conexao invalida a anterior.
 *
 * O disco e o unico lugar que as duas copias enxergam igual. Por isso a
 * trava mora aqui: ela e sobre a PASTA, e quem compartilha a pasta
 * compartilha a trava, nao importa em qual banco do Redis cada uma
 * esteja.
 *
 * ============================================================
 * ELA EXPIRA SOZINHA
 * ============================================================
 * Um arquivo de trava que so some na mao transforma uma queda feia em
 * ferramenta travada. Aqui o dono carimba a hora enquanto esta vivo;
 * uma trava velha e considerada abandonada e o proximo worker assume.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Depois de quanto tempo sem carimbo a trava e considerada abandonada. */
export const ABANDONADA_APOS_MS = 90_000;

export interface Dono {
  identidade: string;
  em: number;
}

export function caminhoDaTrava(pastaSessao: string): string {
  return join(pastaSessao, 'dono.lock');
}

/**
 * Le o dono atual. `null` quando nao ha trava, ela esta ilegivel, ou
 * foi abandonada.
 *
 * Ilegivel conta como ausente de proposito: um arquivo truncado por uma
 * queda de energia nao pode deixar a ferramenta travada para sempre.
 */
export function lerDono(pastaSessao: string, agora = Date.now()): Dono | null {
  try {
    const bruto = readFileSync(caminhoDaTrava(pastaSessao), 'utf8');
    const dono = JSON.parse(bruto) as Partial<Dono>;

    if (typeof dono.identidade !== 'string' || typeof dono.em !== 'number') {
      return null;
    }
    if (agora - dono.em > ABANDONADA_APOS_MS) return null;

    return { identidade: dono.identidade, em: dono.em };
  } catch {
    return null;
  }
}

export interface ResultadoDaTrava {
  assumiu: boolean;
  /** Quem esta com a pasta, quando nao foi possivel assumir. */
  dono?: string;
}

/**
 * Tenta virar o dono da pasta.
 *
 * A propria identidade conta como livre: e o reinicio rapido, em que o
 * mesmo worker volta antes de a trava anterior expirar.
 */
export function assumirPasta(
  pastaSessao: string,
  identidade: string,
  agora = Date.now()
): ResultadoDaTrava {
  const atual = lerDono(pastaSessao, agora);

  if (atual && atual.identidade !== identidade) {
    return { assumiu: false, dono: atual.identidade };
  }

  try {
    mkdirSync(pastaSessao, { recursive: true });
    writeFileSync(
      caminhoDaTrava(pastaSessao),
      JSON.stringify({ identidade, em: agora }),
      'utf8'
    );
    return { assumiu: true };
  } catch {
    // Sem poder gravar, o certo e DEIXAR PASSAR: a trava e uma protecao
    // contra engano de configuracao, e nao uma permissao de uso. Uma
    // pasta somente-leitura nao pode impedir a ferramenta de rodar.
    return { assumiu: true };
  }
}

/** Renova o carimbo. Chamado enquanto o worker esta vivo. */
export function renovarPasta(
  pastaSessao: string,
  identidade: string,
  agora = Date.now()
): boolean {
  const atual = lerDono(pastaSessao, agora);
  if (atual && atual.identidade !== identidade) return false;

  try {
    writeFileSync(
      caminhoDaTrava(pastaSessao),
      JSON.stringify({ identidade, em: agora }),
      'utf8'
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Solta a trava no encerramento — e SO se ainda for nossa.
 *
 * Sem a checagem, um worker lento encerrando apagaria a trava de quem
 * ja assumiu, e a disputa recomecaria sem ninguem olhando.
 */
export function soltarPasta(
  pastaSessao: string,
  identidade: string,
  agora = Date.now()
): boolean {
  const atual = lerDono(pastaSessao, agora);
  if (atual && atual.identidade !== identidade) return false;

  try {
    rmSync(caminhoDaTrava(pastaSessao), { force: true });
    return true;
  } catch {
    return false;
  }
}
