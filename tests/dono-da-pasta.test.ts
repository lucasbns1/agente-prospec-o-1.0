/**
 * A trava que vive na PASTA da sessao.
 *
 * ============================================================
 * O QUE ELA PEGA QUE A OUTRA NAO PEGA
 * ============================================================
 * A trava do Redis (`dono-da-sessao`) so enxerga dentro da propria
 * copia: duas copias da ferramenta usam bancos diferentes do Redis, e a
 * trava de uma e invisivel para a outra.
 *
 * Se as duas apontarem para a mesma PASTA de sessao, as duas usam a
 * mesma credencial — e cada conexao invalida a anterior. O sintoma e o
 * que apareceu em uso real: conecta uma copia, e a outra passa a pedir
 * QR.
 *
 * O disco e o unico lugar que as duas enxergam igual.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ABANDONADA_APOS_MS,
  assumirPasta,
  caminhoDaTrava,
  lerDono,
  renovarPasta,
  soltarPasta,
} from '../apps/worker/src/services/dono-da-pasta.js';

let pasta: string;

beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), 'sessao-'));
});

afterEach(() => {
  rmSync(pasta, { recursive: true, force: true });
});

describe('assumirPasta', () => {
  it('a primeira copia assume', () => {
    expect(assumirPasta(pasta, 'copia-a')).toEqual({ assumiu: true });
  });

  /**
   * ESTE e o teste do defeito. Sem ele, a segunda copia sobe apontando
   * para a mesma credencial, e as duas passam a se derrubar.
   */
  it('a segunda copia NAO assume, e sabe de quem e a pasta', () => {
    assumirPasta(pasta, 'copia-a');

    const r = assumirPasta(pasta, 'copia-b');

    expect(r.assumiu).toBe(false);
    expect(r.dono).toBe('copia-a');
  });

  it('pastas diferentes nao disputam entre si', () => {
    const outra = join(pasta, 'brasil');
    mkdirSync(outra, { recursive: true });

    assumirPasta(pasta, 'copia-a');

    expect(assumirPasta(outra, 'copia-b').assumiu).toBe(true);
  });

  it('o mesmo worker reassume a propria trava (reinicio rapido)', () => {
    assumirPasta(pasta, 'copia-a');
    expect(assumirPasta(pasta, 'copia-a').assumiu).toBe(true);
  });

  /**
   * Uma trava que so some na mao transforma uma queda feia — energia,
   * Ctrl+C no meio, azul da morte — em ferramenta travada ate alguem
   * descobrir qual arquivo apagar.
   */
  it('trava velha e considerada abandonada', () => {
    const antiga = Date.now() - ABANDONADA_APOS_MS - 1_000;
    writeFileSync(
      caminhoDaTrava(pasta),
      JSON.stringify({ identidade: 'copia-morta', em: antiga })
    );

    expect(lerDono(pasta)).toBeNull();
    expect(assumirPasta(pasta, 'copia-nova').assumiu).toBe(true);
  });

  it('arquivo corrompido conta como pasta livre', () => {
    writeFileSync(caminhoDaTrava(pasta), '{isto nao e json');
    expect(assumirPasta(pasta, 'copia-nova').assumiu).toBe(true);
  });

  /**
   * A trava protege contra engano de CONFIGURACAO; ela nao e uma
   * permissao de uso. Numa pasta sem permissao de escrita, o certo e
   * deixar rodar — e nao travar a ferramenta por causa da protecao.
   */
  it('nao conseguir gravar deixa passar, em vez de bloquear', () => {
    const inexistente = join(pasta, 'arquivo-no-caminho');
    writeFileSync(inexistente, 'sou um arquivo, nao uma pasta');

    // Criar a pasta falha porque ha um ARQUIVO nesse caminho.
    expect(assumirPasta(join(inexistente, 'dentro'), 'copia-a').assumiu).toBe(true);
  });
});

describe('renovarPasta', () => {
  it('renova enquanto a trava for nossa', () => {
    assumirPasta(pasta, 'copia-a');
    expect(renovarPasta(pasta, 'copia-a')).toBe(true);
  });

  it('nao renova a trava de outra copia', () => {
    assumirPasta(pasta, 'copia-a');
    expect(renovarPasta(pasta, 'copia-b')).toBe(false);
  });
});

describe('soltarPasta', () => {
  it('solta a propria trava', () => {
    assumirPasta(pasta, 'copia-a');

    expect(soltarPasta(pasta, 'copia-a')).toBe(true);
    expect(lerDono(pasta)).toBeNull();
  });

  it('nao apaga a trava de outra copia ao encerrar', () => {
    assumirPasta(pasta, 'copia-nova');

    expect(soltarPasta(pasta, 'copia-velha')).toBe(false);
    expect(lerDono(pasta)?.identidade).toBe('copia-nova');
  });
});
