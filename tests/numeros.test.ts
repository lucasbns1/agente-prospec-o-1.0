/**
 * Os dois numeros de WhatsApp — o contrato, sem ligar nada.
 *
 * O que estes testes prendem no lugar e justamente o que, se sair do
 * lugar, custa um QR e um historico:
 *
 *   - o numero 1 mora na pasta ANTIGA (a sessao que ja esta no ar);
 *   - os dois nunca dividem pasta;
 *   - valor estranho no banco cai para o numero 1, e nunca para o 2.
 */
import { describe, expect, it } from 'vitest';
import {
  caminhoDaSessao,
  ehNumeroWhatsApp,
  numeroAtivoDeSetting,
  NUMEROS_WHATSAPP,
} from '@prospector/shared';

describe('caminhoDaSessao', () => {
  /**
   * Este e O teste desta funcionalidade inteira. Se o numero 1 deixar de
   * apontar para a pasta antiga, a sessao que esta conectada AGORA fica
   * orfa: o efeito de ganhar um segundo numero seria perder o primeiro,
   * junto com o arquivo de mensagens e o mapa LID.
   */
  it('o numero 1 usa a pasta antiga, sem sufixo nenhum', () => {
    expect(caminhoDaSessao('./data/whatsapp', '1')).toBe('./data/whatsapp');
  });

  it('o numero 2 estreia pasta propria', () => {
    expect(caminhoDaSessao('./data/whatsapp', '2')).toBe('./data/whatsapp-numero-2');
  });

  it('os dois NUNCA caem na mesma pasta', () => {
    const caminhos = NUMEROS_WHATSAPP.map((n) => caminhoDaSessao('./data/whatsapp', n));
    expect(new Set(caminhos).size).toBe(NUMEROS_WHATSAPP.length);
  });

  it('barra sobrando no fim nao cria pasta diferente', () => {
    // "./data/whatsapp/" e "./data/whatsapp" sao o mesmo lugar. Sem a
    // limpeza, o numero 2 iria para "./data/whatsapp/-numero-2" — uma
    // pasta DENTRO da sessao do numero 1.
    expect(caminhoDaSessao('./data/whatsapp/', '1')).toBe('./data/whatsapp');
    expect(caminhoDaSessao('./data/whatsapp/', '2')).toBe('./data/whatsapp-numero-2');
    expect(caminhoDaSessao('C:\\dados\\whatsapp\\', '2')).toBe(
      'C:\\dados\\whatsapp-numero-2'
    );
  });
});

describe('numeroAtivoDeSetting', () => {
  it('le o valor gravado', () => {
    expect(numeroAtivoDeSetting('2')).toBe('2');
    expect(numeroAtivoDeSetting('1')).toBe('1');
  });

  it('aceita o formato de objeto, para quem editar o banco na mao', () => {
    expect(numeroAtivoDeSetting({ numero: '2' })).toBe('2');
  });

  /**
   * O padrao e '1' e nao pode ser outra coisa: e o numero que ja estava
   * em uso antes desta funcionalidade existir. Um setting ausente,
   * corrompido ou de tipo errado nao pode fazer a ferramenta acordar
   * conectada no numero errado — e mandar mensagem por ele.
   */
  it('qualquer coisa estranha cai no numero 1, nunca no 2', () => {
    const lixo = [null, undefined, '', '3', 3, {}, [], 'dois', { numero: 9 }, true];
    for (const v of lixo) {
      expect(numeroAtivoDeSetting(v), `errou em ${JSON.stringify(v)}`).toBe('1');
    }
  });
});

describe('ehNumeroWhatsApp', () => {
  it('so aceita 1 e 2, como texto', () => {
    expect(ehNumeroWhatsApp('1')).toBe(true);
    expect(ehNumeroWhatsApp('2')).toBe(true);
    expect(ehNumeroWhatsApp(1)).toBe(false);
    expect(ehNumeroWhatsApp('3')).toBe(false);
    expect(ehNumeroWhatsApp(null)).toBe(false);
  });
});
