/**
 * O checador de erros de colagem da GEMINI_API_KEY.
 *
 * ============================================================
 * O TESTE MAIS IMPORTANTE DESTE ARQUIVO E O PRIMEIRO
 * ============================================================
 * Duas versoes anteriores desta funcao acusaram de invalida uma chave
 * que funcionava: uma exigia 39 caracteres (a real tinha 53), outra
 * exigia o prefixo `AIza` (a real nao tinha). Nos dois casos o
 * diagnostico mandou o dono trocar a credencial certa.
 *
 * Por isso o primeiro bloco aqui e uma lista de chaves de formatos
 * diferentes que TODAS precisam passar limpas. Ele existe para que a
 * proxima pessoa tentada a "melhorar" a validacao veja a falha antes do
 * usuario.
 *
 * O segundo assunto e o de sempre: nada do conteudo da chave pode sair no
 * diagnostico. Terminal vira print.
 */
import { describe, it, expect } from 'vitest';
import { conferirFormatoDaChave } from '../scripts/formato-da-chave.js';

describe('conferirFormatoDaChave — nao acusa chave boa', () => {
  // Formatos reais e plausiveis, de epocas diferentes do Google.
  const chavesQueDevemPassar: Array<[string, string]> = [
    ['formato antigo, 39 caracteres', 'AIza' + 'B'.repeat(35)],
    ['formato novo, 53 caracteres', 'AIza' + 'C'.repeat(49)],
    ['sem o prefixo AIza', 'k7Fq' + 'D'.repeat(49)],
    ['bem curta', 'abc123XYZ'],
    ['bem longa', 'z'.repeat(140)],
    ['com hifen e sublinhado', 'AIzaSy-chave_com-simbolos_normais123'],
  ];

  for (const [nome, chave] of chavesQueDevemPassar) {
    it(nome, () => {
      expect(conferirFormatoDaChave(chave).problemas).toEqual([]);
    });
  }

  it('ignora espaco nas pontas, que o .env costuma deixar', () => {
    const r = conferirFormatoDaChave('  AIzaSyChaveNormalDeTeste123456789  \n');

    expect(r.problemas).toEqual([]);
    expect(r.comprimento).toBe('AIzaSyChaveNormalDeTeste123456789'.length);
  });
});

describe('conferirFormatoDaChave — pega erro de colagem', () => {
  const CHAVE = 'AIzaSyChaveNormalDeTeste123456789';

  it('aspas do .env', () => {
    expect(conferirFormatoDaChave(`"${CHAVE}"`).problemas.join(' ')).toContain('aspas');
  });

  it('o nome da variavel grudado no valor', () => {
    const r = conferirFormatoDaChave(`GEMINI_API_KEY=${CHAVE}`);
    expect(r.problemas.join(' ')).toContain('GEMINI_API_KEY=');
  });

  it('espaco no meio', () => {
    const r = conferirFormatoDaChave('AIzaSy chave partida');
    expect(r.problemas.join(' ')).toContain('espaco');
  });

  it('um comando de PowerShell no lugar da chave', () => {
    // O caso real: um `Select-String` de 104 caracteres colado no .env,
    // que o script mandou obedientemente para o Google.
    const r = conferirFormatoDaChave(
      'Select-String -Path .env -Pattern "^GEMINI_" | ForEach-Object { $_.Line }'
    );
    expect(r.problemas.join(' ')).toContain('comando de terminal');
  });

  it('a mesma chave colada duas vezes', () => {
    const r = conferirFormatoDaChave(CHAVE + CHAVE);
    expect(r.problemas.join(' ')).toContain('repetida duas vezes');
  });

  it('um token OAuth', () => {
    const r = conferirFormatoDaChave('ya29.' + 'x'.repeat(120));
    expect(r.problemas.join(' ')).toContain('OAuth');
  });

  it('um JSON de conta de servico', () => {
    const r = conferirFormatoDaChave('{"type":"service_account","private_key":"..."}');
    expect(r.problemas.join(' ')).toContain('conta de servico');
  });

  it('chave vazia nao quebra', () => {
    expect(() => conferirFormatoDaChave('')).not.toThrow();
    expect(conferirFormatoDaChave('').comprimento).toBe(0);
  });
});

describe('conferirFormatoDaChave — nao vaza a chave', () => {
  it('nenhum diagnostico contem pedaco do valor', () => {
    const segredo = 'AIzaSyPALAVRASECRETAxxxxxxxxxxxxxxxxxxxx';
    const variantes = [
      segredo,
      `"${segredo}"`,
      `GEMINI_API_KEY=${segredo}`,
      segredo + segredo,
      `ya29.${segredo}`,
      `Select-String ${segredo} | ForEach-Object { $_ }`,
    ];

    for (const v of variantes) {
      const texto = conferirFormatoDaChave(v).problemas.join(' | ');
      expect(texto).not.toContain('PALAVRASECRETA');
      expect(texto).not.toContain(segredo);
    }
  });
});
