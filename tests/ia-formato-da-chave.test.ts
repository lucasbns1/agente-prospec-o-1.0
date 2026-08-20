/**
 * O checador de formato da GEMINI_API_KEY.
 *
 * ============================================================
 * O QUE ESTES TESTES PROTEGEM
 * ============================================================
 * Duas coisas, e a segunda importa tanto quanto a primeira:
 *
 * 1. Que o diagnostico esteja certo — uma chave boa nao pode ser acusada
 *    de nada, senao a pessoa troca uma chave que funcionava.
 * 2. Que NADA do conteudo da chave saia no diagnostico. Cada mensagem
 *    vai para o terminal, o terminal vira print, e print vira grupo de
 *    WhatsApp. O ultimo teste deste arquivo e so sobre isso.
 */
import { describe, it, expect } from 'vitest';
import { conferirFormatoDaChave, TAMANHO_MAXIMO } from '../scripts/formato-da-chave.js';

/** Uma chave com a forma antiga: `AIza` + 35 caracteres = 39. */
const CHAVE_BOA = 'AIza' + 'B'.repeat(35);

/** Uma chave recem-criada de verdade: 53 caracteres, e valida. */
const CHAVE_NOVA = 'AIza' + 'C'.repeat(49);

describe('conferirFormatoDaChave', () => {
  it('nao reclama de uma chave bem formada', () => {
    const r = conferirFormatoDaChave(CHAVE_BOA);

    expect(r.problemas).toEqual([]);
    expect(r.pareceAiStudio).toBe(true);
    expect(r.comprimento).toBe(39);
  });

  it('nao reclama de uma chave NOVA, de 53 caracteres', () => {
    // O caso que fez esta regra ser afrouxada. A checagem exigia 39
    // caracteres exatos e teria acusado de errada uma chave que acabara
    // de comecar a funcionar. Acusar o que esta certo e pior que nao
    // checar nada: manda a pessoa desfazer o acerto.
    const r = conferirFormatoDaChave(CHAVE_NOVA);

    expect(r.comprimento).toBe(53);
    expect(r.problemas).toEqual([]);
    expect(r.pareceAiStudio).toBe(true);
  });

  it('ignora espaco nas pontas, que o .env costuma deixar', () => {
    const r = conferirFormatoDaChave(`  ${CHAVE_BOA}\n`);

    expect(r.problemas).toEqual([]);
    expect(r.comprimento).toBe(39);
  });

  it('pega a chave entre aspas', () => {
    const r = conferirFormatoDaChave(`"${CHAVE_BOA}"`);

    expect(r.pareceAiStudio).toBe(false);
    expect(r.problemas.join(' ')).toContain('aspas');
  });

  it('pega o "GEMINI_API_KEY=" colado junto', () => {
    const r = conferirFormatoDaChave(`GEMINI_API_KEY=${CHAVE_BOA}`);

    expect(r.problemas.join(' ')).toContain('GEMINI_API_KEY=');
  });

  it('pega a chave colada duas vezes', () => {
    // Este e o caso que explica um tamanho perto do dobro sem nenhum
    // outro sintoma: prefixo certo, so que duas vezes.
    const r = conferirFormatoDaChave(CHAVE_BOA + CHAVE_BOA);

    expect(r.pareceAiStudio).toBe(false);
    expect(r.problemas.join(' ')).toContain('mais de uma vez');
  });

  it('reconhece um token OAuth como outra credencial', () => {
    const r = conferirFormatoDaChave('ya29.' + 'x'.repeat(120));

    expect(r.problemas.join(' ')).toContain('OAuth');
  });

  it('reconhece um JSON de conta de servico', () => {
    const r = conferirFormatoDaChave('{"type":"service_account","private_key":"..."}');

    expect(r.problemas.join(' ')).toContain('conta de servico');
  });

  it('reclama do tamanho quando ele nao bate', () => {
    // O caso real que motivou tudo isto: 104 caracteres.
    const r = conferirFormatoDaChave('A'.repeat(104));

    expect(r.comprimento).toBe(104);
    expect(r.pareceAiStudio).toBe(false);
    expect(r.problemas.join(' ')).toContain('104 caracteres');
    expect(104).toBeGreaterThan(TAMANHO_MAXIMO);
  });

  it('trata chave vazia sem quebrar', () => {
    const r = conferirFormatoDaChave('');

    expect(r.comprimento).toBe(0);
    expect(r.pareceAiStudio).toBe(false);
    expect(() => conferirFormatoDaChave('')).not.toThrow();
  });

  it('NUNCA devolve pedaco da chave no diagnostico', () => {
    // A regra da casa: a chave nao vai para o terminal. Um diagnostico
    // "util demais" que mostrasse os primeiros caracteres seria um vazamento
    // com aparencia de recurso.
    const segredo = 'AIzaSyPALAVRASECRETAxxxxxxxxxxxxxxxxxxxx';
    const variantes = [
      segredo,
      `"${segredo}"`,
      `GEMINI_API_KEY=${segredo}`,
      segredo + segredo,
      `ya29.${segredo}`,
    ];

    for (const v of variantes) {
      const texto = conferirFormatoDaChave(v).problemas.join(' | ');
      expect(texto).not.toContain('PALAVRASECRETA');
      expect(texto).not.toContain(segredo);
    }
  });
});
