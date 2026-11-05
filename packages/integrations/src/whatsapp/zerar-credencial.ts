/**
 * Zera a credencial DENTRO do mesmo objeto.
 *
 * ============================================================
 * POR QUE TROCAR O OBJETO NAO FUNCIONA
 * ============================================================
 * O `useMultiFileAuthState` do Baileys devolve `{ state, saveCreds }`,
 * e o `saveCreds` fecha sobre o objeto de credencial lido do disco:
 *
 *     const creds = (await readData('creds.json')) || initAuthCreds();
 *     return { state: { creds, ... }, saveCreds: () => writeData(creds, ...) }
 *
 * Repare que ele grava `creds`, a variavel capturada — e nao
 * `state.creds`. Entao `state.creds = initAuthCreds()` troca o objeto
 * que o SOCKET passa a usar, e deixa o `saveCreds` gravando o ANTIGO.
 *
 * O efeito e cruel porque o pareamento parece dar certo:
 *
 *   1. voce le o QR e conecta — a memoria tem a credencial nova;
 *   2. o `saveCreds` grava em disco a credencial MORTA;
 *   3. o worker reinicia (o `tsx watch` reinicia a cada arquivo salvo);
 *   4. ele le do disco a credencial velha, tenta logar com o numero
 *      antigo, leva 401, apaga, pede QR de novo;
 *   5. cada pareamento novo soma um aparelho conectado no celular, ate
 *      estourar o limite de quatro.
 *
 * Foi assim que o ciclo sobreviveu a quatro tentativas de conserto: as
 * correcoes anteriores cuidaram de quem grava e de quando, e esta
 * cuidava de ONDE — o lugar errado.
 *
 * ============================================================
 * A SOLUCAO E NAO MEXER NA IDENTIDADE DO OBJETO
 * ============================================================
 * Esvaziar e repreencher o MESMO objeto mantem a referencia que o
 * `saveCreds` capturou. O que ele grava passa a ser o conteudo novo.
 *
 * As chaves antigas sao APAGADAS antes, e nao sobrescritas: um
 * `Object.assign` sozinho deixaria para tras o que a credencial nova
 * nao tem — `me`, `account`, `platform` —, e uma credencial zerada com
 * o numero antigo grudado nela e pior do que nenhuma.
 */

/** O que o Baileys entrega como credencial. Forma livre de proposito. */
export type Credencial = Record<string, unknown>;

export function zerarCredencialNoLugar(
  creds: Credencial,
  criarNova: () => Credencial
): void {
  const nova = criarNova();

  for (const chave of Object.keys(creds)) {
    delete creds[chave];
  }

  Object.assign(creds, nova);
}
