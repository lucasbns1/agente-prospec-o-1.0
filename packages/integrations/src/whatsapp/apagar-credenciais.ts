/**
 * Apaga a credencial do WhatsApp — e SO ela.
 *
 * ============================================================
 * POR QUE ISTO EXISTE
 * ============================================================
 * Quando o WhatsApp invalida a sessao (401), a credencial no disco
 * deixa de valer. Se ela FICA la, o arranque seguinte a le, tenta
 * logar, leva 401 de novo, e o canal volta para FALHOU — sem nunca
 * pedir QR. Um beco sem saida: a tela manda reiniciar o worker, e
 * reiniciar nao resolve.
 *
 * Apagar nao perde nada. A credencial ja nao vale; o que ela impedia era
 * justamente a recuperacao.
 *
 * ============================================================
 * O QUE NAO PODE SER APAGADO JUNTO
 * ============================================================
 * `arquivo-mensagens.json` mora na MESMA pasta e nao e credencial: e o
 * historico que o WhatsApp so entrega no pareamento. Apagar a pasta
 * inteira — que e o que se faz na mao — leva o historico junto.
 *
 * Por isso aqui a remocao e por ARQUIVO, com uma lista explicita do que
 * e credencial, e nao um `rm -rf` na pasta.
 */
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * O que o Baileys grava e que perde o valor com a sessao.
 *
 * `creds.json` e a credencial em si. Os outros sao estado de sessao
 * criptografica amarrado a ela: mantidos sem a credencial, sujam o
 * pareamento novo.
 */
const PREFIXOS_DE_CREDENCIAL = [
  'creds.json',
  'app-state-sync-key-',
  'app-state-sync-version-',
  'pre-key-',
  'session-',
  'sender-key-',
  'identity-key-',
  'tctoken-',
  'device-list-',
];

/**
 * O que fica, aconteca o que acontecer.
 *
 * O `lid-mapping-` fica de proposito: e o mapa LID -> telefone, ele nao
 * depende da credencial, e foi ele que permitiu devolver o dono de 124
 * conversas perdidas. Jogar fora seria destruir a unica ponte entre um
 * endereco de privacidade e um lead.
 *
 * NOTA HONESTA: hoje esta lista e REDUNDANTE. A protecao de verdade e a
 * remocao ser por lista de PERMISSAO — nada que nao esteja em
 * `PREFIXOS_DE_CREDENCIAL` e tocado, e nenhum destes dois esta la.
 * Descobri isso desligando `NUNCA_APAGAR` e vendo os testes passarem
 * assim mesmo.
 *
 * Ela fica como segunda camada: no dia em que alguem acrescentar um
 * prefixo largo aos de credencial, e ela que segura. Mas quem protege
 * hoje e o `ehCredencial` — e e ele que os testes trancam.
 */
const NUNCA_APAGAR = ['arquivo-mensagens.json', 'lid-mapping-'];

function ehCredencial(nome: string): boolean {
  if (NUNCA_APAGAR.some((p) => nome === p || nome.startsWith(p))) return false;
  return PREFIXOS_DE_CREDENCIAL.some((p) => nome === p || nome.startsWith(p));
}

/**
 * Apaga a credencial da pasta da sessao. Devolve quantos arquivos saiu.
 *
 * NUNCA lanca: isto roda dentro do tratamento de uma queda de conexao, e
 * uma falha de disco aqui nao pode virar uma segunda falha em cima da
 * primeira.
 */
export function apagarCredenciais(
  pastaSessao: string,
  log: (mensagem: string, dados?: Record<string, unknown>) => void = () => {}
): number {
  let arquivos: string[];
  try {
    arquivos = readdirSync(pastaSessao);
  } catch {
    return 0;
  }

  let apagados = 0;
  for (const nome of arquivos) {
    if (!ehCredencial(nome)) continue;
    try {
      rmSync(join(pastaSessao, nome), { force: true });
      apagados += 1;
    } catch (err) {
      // Um arquivo travado pelo Windows nao pode impedir a remocao dos
      // outros — e `creds.json` sozinho ja basta para o Baileys pedir QR.
      log('Nao consegui apagar um arquivo de credencial', {
        nome,
        err: String(err),
      });
    }
  }

  return apagados;
}
