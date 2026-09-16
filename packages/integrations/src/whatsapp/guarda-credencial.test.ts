/**
 * A trava que impede a credencial morta de renascer.
 *
 * O caso real, lido do log da maquina do usuario:
 *
 *   Credencial invalida removida   arquivos: 1448
 *   "node":{"username":"5511968662120",...},"msg":"logging in..."
 *
 * Apagou e, em seguida, logou com a mesma conta em vez de pedir QR —
 * porque o socket antigo regravou a credencial entre uma coisa e outra.
 */
import { describe, expect, it, vi } from 'vitest';
import { criarGuardaCredencial } from './guarda-credencial.js';

describe('criarGuardaCredencial', () => {
  it('grava normalmente enquanto esta liberada', async () => {
    const gravar = vi.fn(async () => {});
    const guarda = criarGuardaCredencial(gravar);

    expect(await guarda.gravar()).toBe('gravou');
    expect(gravar).toHaveBeenCalledTimes(1);
  });

  /**
   * ESTE e o teste do defeito. O socket antigo emite `creds.update`
   * depois de a credencial ter sido apagada; se essa gravacao passar, o
   * arquivo volta e o proximo login leva 401 de novo — o ciclo que
   * terminava em "Falhou" e que reiniciar nao resolvia.
   */
  it('um evento atrasado do socket antigo NAO regrava a credencial', async () => {
    const gravar = vi.fn(async () => {});
    const guarda = criarGuardaCredencial(gravar);

    guarda.travar(); // antes de apagar os arquivos

    expect(await guarda.gravar()).toBe('bloqueado');
    expect(await guarda.gravar()).toBe('bloqueado');
    expect(gravar).not.toHaveBeenCalled();
  });

  /**
   * Reabrir com o gravador ANTIGO seria o mesmo defeito com mais
   * passos: `saveCreds` carrega consigo o estado que leu, e o antigo
   * carrega o que ja nao vale. Por isso `liberar` exige o novo.
   */
  it('ao liberar, passa a usar o gravador novo e nunca mais o antigo', async () => {
    const antigo = vi.fn(async () => {});
    const novo = vi.fn(async () => {});
    const guarda = criarGuardaCredencial(antigo);

    guarda.travar();
    guarda.liberar(novo);

    expect(await guarda.gravar()).toBe('gravou');
    expect(novo).toHaveBeenCalledTimes(1);
    expect(antigo).not.toHaveBeenCalled();
  });

  it('diz quando esta travada', () => {
    const guarda = criarGuardaCredencial(async () => {});
    expect(guarda.travada).toBe(false);
    guarda.travar();
    expect(guarda.travada).toBe(true);
    guarda.liberar(async () => {});
    expect(guarda.travada).toBe(false);
  });

  /**
   * O Baileys emite `creds.update` o tempo todo. Uma falha de disco
   * numa gravacao nao pode virar excecao solta e derrubar a conexao —
   * a proxima emissao grava de novo.
   */
  it('falha ao gravar nao vira excecao', async () => {
    const guarda = criarGuardaCredencial(async () => {
      throw new Error('disco cheio');
    });

    await expect(guarda.gravar()).resolves.toBe('falhou');
  });
});
