/**
 * O que pode ser apagado quando a sessao morre — e o que nao pode.
 *
 * ============================================================
 * O DEFEITO QUE ISTO CONSERTA
 * ============================================================
 * No 401 o provedor so avisava e parava. A credencial morta continuava
 * no disco, e no arranque seguinte o Baileys a lia, tentava logar, levava
 * 401 de novo, e o canal voltava para FALHOU — sem nunca pedir QR.
 *
 * A tela dizia "Reinicie o worker". Reiniciar nao resolvia nada.
 *
 * ============================================================
 * E O QUE ESTES TESTES PROTEGEM DE VERDADE
 * ============================================================
 * Apagar a pasta inteira e o que se faz na mao — e leva junto duas
 * coisas que NAO sao credencial e que custaram caro para existir:
 *
 *   `arquivo-mensagens.json`  o historico, que o WhatsApp so entrega no
 *                             pareamento
 *   `lid-mapping-*`           o mapa LID -> telefone, que permitiu
 *                             devolver o dono de 124 conversas perdidas
 *
 * Se algum dia alguem trocar isto por um `rm -rf` na pasta, estes testes
 * quebram — e e exatamente esse o trabalho deles.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apagarCredenciais } from './apagar-credenciais.js';

const pastas: string[] = [];

function pastaCom(arquivos: string[]): string {
  const p = mkdtempSync(join(tmpdir(), 'cred-wa-'));
  pastas.push(p);
  for (const nome of arquivos) writeFileSync(join(p, nome), '{}', 'utf8');
  return p;
}

afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

describe('apagarCredenciais', () => {
  it('apaga a credencial e o estado de sessao amarrado a ela', () => {
    const pasta = pastaCom([
      'creds.json',
      'app-state-sync-key-AAAAAOZF.json',
      'app-state-sync-version-regular.json',
      'pre-key-1.json',
      'session-103204524130552_1.0.json',
      'identity-key-174964334420011_1.0.json',
      'tctoken-100394978046108@lid.json',
      'device-list-5511912275459.json',
    ]);

    expect(apagarCredenciais(pasta)).toBe(8);
    expect(readdirSync(pasta)).toEqual([]);
  });

  it('NUNCA apaga o arquivo de mensagens', () => {
    // Ele mora na mesma pasta e nao e credencial: e o historico que o
    // WhatsApp so entrega no pareamento. Perde-lo custa meses de
    // conversa.
    const pasta = pastaCom(['creds.json', 'arquivo-mensagens.json']);

    apagarCredenciais(pasta);

    expect(readdirSync(pasta)).toEqual(['arquivo-mensagens.json']);
  });

  it('NUNCA apaga o mapa LID -> telefone', () => {
    // Ele nao depende da credencial, e foi ele que permitiu devolver o
    // dono de 124 conversas que tinham virado contato desconhecido.
    const pasta = pastaCom([
      'creds.json',
      'lid-mapping-553597299770.json',
      'lid-mapping-171781545574559_reverse.json',
    ]);

    apagarCredenciais(pasta);

    expect(readdirSync(pasta).sort()).toEqual([
      'lid-mapping-171781545574559_reverse.json',
      'lid-mapping-553597299770.json',
    ]);
  });

  it('nao mexe no que nao reconhece', () => {
    // Conservador de proposito: apagar por engano um arquivo alheio e
    // pior do que deixar lixo para tras.
    const pasta = pastaCom(['creds.json', 'anotacao-do-usuario.txt']);

    expect(apagarCredenciais(pasta)).toBe(1);
    expect(readdirSync(pasta)).toEqual(['anotacao-do-usuario.txt']);
  });

  it('pasta que nao existe devolve zero, sem lancar', () => {
    // Isto roda dentro do tratamento de uma queda de conexao: uma falha
    // aqui nao pode virar uma segunda falha em cima da primeira.
    expect(apagarCredenciais(join(tmpdir(), 'nao-existe-mesmo-123'))).toBe(0);
  });

  it('pasta vazia devolve zero', () => {
    expect(apagarCredenciais(pastaCom([]))).toBe(0);
  });
});
