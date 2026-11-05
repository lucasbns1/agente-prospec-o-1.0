/**
 * Zerar a credencial sem trocar o objeto.
 *
 * ============================================================
 * O DEFEITO QUE ISTO FECHA
 * ============================================================
 * O `saveCreds` do Baileys fecha sobre o objeto lido do disco:
 *
 *     const creds = (await readData('creds.json')) || initAuthCreds();
 *     saveCreds: () => writeData(creds, 'creds.json')
 *
 * Ele grava a VARIAVEL capturada, nao `state.creds`. Trocar
 * `state.creds = initAuthCreds()` deixava o socket usando a credencial
 * nova e o disco recebendo a antiga — o pareamento parecia dar certo e
 * morria no proximo reinicio do worker.
 */
import { describe, expect, it } from 'vitest';
import { zerarCredencialNoLugar, type Credencial } from './zerar-credencial.js';

/** Imita `useMultiFileAuthState`: o save fecha sobre o objeto lido. */
function comoOBaileysFaz(doDisco: Credencial) {
  const creds = doDisco;
  let gravado: Credencial | null = null;
  return {
    state: { creds },
    saveCreds: (): void => {
      gravado = JSON.parse(JSON.stringify(creds)) as Credencial;
    },
    oQueFoiParaODisco: (): Credencial | null => gravado,
  };
}

const credencialMorta = (): Credencial => ({
  me: { id: '5511111111111:1@s.whatsapp.net' },
  account: { detalhes: 'conta antiga' },
  registered: true,
  noiseKey: 'chave-velha',
});

const credencialNova = (): Credencial => ({
  registered: false,
  noiseKey: 'chave-nova',
});

describe('zerarCredencialNoLugar', () => {
  /**
   * ESTE e o teste do defeito. Com a troca de objeto, o disco recebia a
   * credencial morta mesmo depois de "zerada".
   */
  it('o que vai para o disco e a credencial NOVA', () => {
    const baileys = comoOBaileysFaz(credencialMorta());

    zerarCredencialNoLugar(baileys.state.creds, credencialNova);
    baileys.saveCreds();

    expect(baileys.oQueFoiParaODisco()).toEqual(credencialNova());
  });

  /** O contraste: era exatamente isto que o codigo fazia antes. */
  it('trocar o objeto grava a credencial VELHA — o defeito', () => {
    const baileys = comoOBaileysFaz(credencialMorta());

    // Reproduz de proposito o que estava no ar: trocar o objeto.
    (baileys.state as { creds: Credencial }).creds = credencialNova();
    baileys.saveCreds();

    expect(baileys.oQueFoiParaODisco()).toEqual(credencialMorta());
  });

  it('mantem a identidade do objeto', () => {
    const creds = credencialMorta();
    const antes = creds;

    zerarCredencialNoLugar(creds, credencialNova);

    expect(creds).toBe(antes);
  });

  /**
   * As chaves que a credencial nova nao tem precisam SUMIR. Um
   * `Object.assign` sozinho deixaria `me` e `account` para tras — uma
   * credencial zerada com o numero antigo grudado e pior que nenhuma,
   * porque o Baileys tentaria logar com ele.
   */
  it('apaga o que a credencial nova nao tem — nada do numero antigo fica', () => {
    const creds = credencialMorta();

    zerarCredencialNoLugar(creds, credencialNova);

    expect(creds.me).toBeUndefined();
    expect(creds.account).toBeUndefined();
    expect(creds.registered).toBe(false);
    expect(Object.keys(creds).sort()).toEqual(['noiseKey', 'registered']);
  });
});
