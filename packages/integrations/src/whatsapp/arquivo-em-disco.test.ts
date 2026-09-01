/**
 * O historico tem que sobreviver a um reinicio.
 *
 * ============================================================
 * O DEFEITO QUE ESTES TESTES TRANCAM
 * ============================================================
 * O pacote de historico do WhatsApp chega UMA vez, no pareamento. Numa
 * reconexao o Baileys anuncia "skipping history sync wait" e nao manda
 * nada.
 *
 * O arquivo era so memoria. Na pratica: 2532 mensagens em 484 conversas
 * chegaram, o worker reiniciou num `git pull`, e a varredura seguinte
 * leu `conversasNoArquivo: 0`. O historico so voltaria pareando o
 * aparelho de novo.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  caminhoDoArquivo,
  carregarArquivo,
  salvarArquivo,
} from './arquivo-em-disco.js';
import type { MensagemProvedor } from './provedor.js';

const pastas: string[] = [];

function pastaNova(): string {
  const p = mkdtempSync(join(tmpdir(), 'arquivo-wa-'));
  pastas.push(p);
  return p;
}

afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function msg(id: string, extra: Partial<MensagemProvedor> = {}): MensagemProvedor {
  return {
    id,
    from: '5511999999999@c.us',
    to: 'eu@c.us',
    body: 'oi',
    timestamp: 1_756_000_000,
    fromMe: false,
    type: 'chat',
    hasMedia: false,
    ...extra,
  };
}

describe('o arquivo sobrevive ao reinicio', () => {
  it('o que foi gravado volta igual', () => {
    const caminho = caminhoDoArquivo(pastaNova());
    const original = [
      msg('a'),
      msg('b', { fromMe: true, body: 'Boa tarde!', timestamp: 1_756_000_500 }),
    ];

    expect(salvarArquivo(caminho, original)).toBe(true);
    const lido = carregarArquivo(caminho);

    // Igualdade estrutural, e nao "tem o mesmo tamanho": um campo que se
    // perdesse na volta — `fromMe`, por exemplo — faria a varredura
    // confundir a mensagem do lead com a minha.
    expect(lido.mensagens).toEqual(original);
    expect(lido.descartadas).toBe(0);
  });

  it('sem arquivo, devolve vazio e diz por que — nao lanca', () => {
    const lido = carregarArquivo(caminhoDoArquivo(pastaNova()));

    // O primeiro arranque cai aqui. Lancar faria o worker nao subir na
    // primeira vez que alguem instalasse o sistema.
    expect(lido.mensagens).toEqual([]);
    expect(lido.motivo).toBeTruthy();
  });

  it('arquivo corrompido nao derruba o worker', () => {
    const caminho = caminhoDoArquivo(pastaNova());
    writeFileSync(caminho, '{isto nao e json', 'utf8');

    const lido = carregarArquivo(caminho);

    // Historico perdido e ruim; worker que nao sobe e pior — sem ele nao
    // ha canal, nem cadencia, nem tela. E o proximo pareamento
    // reconstroi o arquivo.
    expect(lido.mensagens).toEqual([]);
    expect(lido.motivo).toBe('json ilegivel');
  });

  it('linha sem timestamp e descartada, e as boas continuam valendo', () => {
    const caminho = caminhoDoArquivo(pastaNova());
    writeFileSync(
      caminho,
      JSON.stringify([msg('boa'), { id: 'ruim', from: 'x', body: 'y', fromMe: false }]),
      'utf8'
    );

    const lido = carregarArquivo(caminho);

    // Sem o filtro, `timestamp` ausente viraria `NaN` na comparacao da
    // varredura e a mensagem sumiria em silencio. Descartar na leitura e
    // o unico ponto onde da para CONTAR quantas caíram.
    expect(lido.mensagens).toHaveLength(1);
    expect(lido.mensagens[0]!.id).toBe('boa');
    expect(lido.descartadas).toBe(1);
  });

  it('uma lista vazia apaga o que havia, em vez de manter o velho', () => {
    const caminho = caminhoDoArquivo(pastaNova());
    salvarArquivo(caminho, [msg('a')]);
    salvarArquivo(caminho, []);

    expect(carregarArquivo(caminho).mensagens).toEqual([]);
  });

  it('nao deixa arquivo temporario para tras', () => {
    const pasta = pastaNova();
    salvarArquivo(caminhoDoArquivo(pasta), [msg('a')]);

    // A escrita e temporario + rename. Se o `.tmp` sobrevivesse, a pasta
    // da sessao iria acumulando copias do historico inteiro.
    expect(readdirSync(pasta).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('grava numa pasta que ainda nao existe', () => {
    const caminho = caminhoDoArquivo(join(pastaNova(), 'sessao-que-nao-existe'));

    // O provedor grava ao lado da sessao, e no primeiro arranque essa
    // pasta pode nao ter sido criada ainda.
    expect(salvarArquivo(caminho, [msg('a')])).toBe(true);
    expect(carregarArquivo(caminho).mensagens).toHaveLength(1);
  });

  it('caminho impossivel devolve false em vez de lancar', () => {
    const pasta = pastaNova();
    // Um ARQUIVO onde o codigo espera uma pasta: `mkdirSync` falha com
    // ENOTDIR. E a falha de disco mais facil de reproduzir sem depender
    // de permissao de root.
    const bloqueio = join(pasta, 'bloqueio');
    writeFileSync(bloqueio, 'sou um arquivo, nao uma pasta', 'utf8');

    // Gravar o historico e acessorio: uma falha de disco nao pode
    // derrubar o canal do WhatsApp.
    expect(salvarArquivo(join(bloqueio, 'dentro.json'), [msg('a')])).toBe(false);
  });
});
