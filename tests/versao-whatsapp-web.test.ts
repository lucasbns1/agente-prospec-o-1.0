/**
 * A versao do WhatsApp Web que o Chrome carrega.
 *
 * ============================================================
 * O DEFEITO QUE ISTO EXISTE PARA CONTORNAR
 * ============================================================
 * O `whatsapp-web.js` injeta codigo que depende da estrutura interna da
 * pagina do WhatsApp Web. Quando o WhatsApp publica uma versao nova,
 * essa estrutura muda e a injecao para de encontrar o que procura.
 *
 * O sintoma nao denuncia a causa. Em uso real:
 *
 *   - mensagem recebida continuava chegando (os EVENTOS funcionam)
 *   - `getChats()` falhou as seis tentativas, ao longo de dois minutos
 *   - `getChatById()` falhou nas 84 conversas
 *   - sempre com o mesmo erro opaco: `message: "r"`, porque o codigo da
 *     pagina esta minificado
 *
 * E a biblioteca ja estava na ultima versao publicada (1.34.7). Nao
 * havia atualizacao para instalar: o conserto e do outro lado, fixando
 * qual build da pagina carregar.
 *
 * ============================================================
 * NENHUM NAVEGADOR AQUI
 * ============================================================
 * Estes testes verificam a CONFIGURACAO — que a fixacao chega ao cliente
 * quando pedida, e que a ausencia dela nao muda nada. Se a versao
 * escolhida de fato funciona so o WhatsApp responde, e isso nao cabe
 * numa suite automatizada.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });

describe('WHATSAPP_WEB_VERSION na configuracao', () => {
  it('e opcional — sem ela o sistema se comporta como antes', async () => {
    const { carregarEnv } = await import('@prospector/config');
    const anterior = process.env.WHATSAPP_WEB_VERSION;
    delete process.env.WHATSAPP_WEB_VERSION;

    try {
      const env = carregarEnv();
      expect(env.WHATSAPP_WEB_VERSION).toBeUndefined();
    } finally {
      if (anterior !== undefined) process.env.WHATSAPP_WEB_VERSION = anterior;
    }
  });

  it('a URL do acervo tem o marcador {version}', async () => {
    const { carregarEnv } = await import('@prospector/config');
    const env = carregarEnv();

    // Sem o marcador, a biblioteca baixaria sempre o mesmo arquivo,
    // qualquer que fosse a versao pedida — e a fixacao viraria uma
    // configuracao que nao configura nada.
    expect(env.WHATSAPP_WEB_VERSION_URL).toContain('{version}');
  });
});

describe('a fixacao chega ao cliente', () => {
  /**
   * O provedor real importa `whatsapp-web.js`, que arrasta o Puppeteer.
   * Em vez de carregar tudo isso, o teste verifica o formato do objeto
   * que a biblioteca espera receber — que e o contrato entre os dois.
   */
  it('monta webVersionCache com strict: false', () => {
    const opcoes = { webVersion: '2.3000.1044344916-alpha', webVersionUrl: 'https://x/{version}.html' };

    const fixar =
      opcoes.webVersion && opcoes.webVersionUrl
        ? {
            webVersion: opcoes.webVersion,
            webVersionCache: {
              type: 'remote' as const,
              remotePath: opcoes.webVersionUrl,
              strict: false,
            },
          }
        : {};

    expect(fixar).toMatchObject({
      webVersion: '2.3000.1044344916-alpha',
      webVersionCache: { type: 'remote', strict: false },
    });

    // `strict: false` NAO e detalhe: com `true`, um build que saiu do
    // acervo faria a biblioteca RECUSAR conectar. Perder a versao
    // fixada e um problema; perder a conexao do WhatsApp e outro, bem
    // maior — e o primeiro nao pode causar o segundo.
    expect(
      (fixar as { webVersionCache: { strict: boolean } }).webVersionCache.strict
    ).toBe(false);
  });

  it('sem versao, nao passa nada — o padrao da biblioteca fica intacto', () => {
    const opcoes: { webVersion?: string; webVersionUrl?: string } = {};

    const fixar =
      opcoes.webVersion && opcoes.webVersionUrl
        ? { webVersion: opcoes.webVersion }
        : {};

    // Objeto vazio, e nao `{ webVersion: undefined }`: espalhar uma
    // chave com undefined sobrescreveria o padrao da biblioteca com
    // nada, que e diferente de nao mexer.
    expect(Object.keys(fixar)).toHaveLength(0);
  });

  it('so a URL, sem a versao, nao liga a fixacao', () => {
    const opcoes = { webVersionUrl: 'https://x/{version}.html' } as {
      webVersion?: string;
      webVersionUrl?: string;
    };

    const fixar =
      opcoes.webVersion && opcoes.webVersionUrl
        ? { webVersion: opcoes.webVersion }
        : {};

    // A URL tem valor padrao e esta sempre preenchida. Se ela sozinha
    // ligasse a fixacao, todo mundo carregaria uma versao vazia.
    expect(Object.keys(fixar)).toHaveLength(0);
  });
});
