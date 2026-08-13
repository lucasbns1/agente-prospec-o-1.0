/**
 * As barreiras contra envio real.
 *
 * Este e o arquivo mais importante da suite. Ele nao verifica uma
 * funcionalidade — verifica que uma funcionalidade NAO acontece. Se
 * qualquer teste aqui falhar, existe um caminho pelo qual uma mensagem
 * chega a um cliente real sem que ninguem tenha autorizado.
 */
import { describe, expect, it } from 'vitest';
import { decidirDryRun } from '../apps/worker/src/workers/outbound.js';
import { resolverModo } from '../packages/integrations/src/whatsapp/factory.js';

describe('decidirDryRun — so envia de verdade com as tres barreiras baixas', () => {
  const baixadas = {
    campanhaDryRun: false,
    mensagemDryRun: false,
    modoGlobal: 'live',
  };

  it('a unica combinacao que envia de verdade e todas baixas', () => {
    expect(decidirDryRun(baixadas)).toBe(false);
  });

  it('campanha em dry-run simula, mesmo com o modo global live', () => {
    expect(decidirDryRun({ ...baixadas, campanhaDryRun: true })).toBe(true);
  });

  it('mensagem marcada dry-run simula, mesmo com a campanha liberada', () => {
    expect(decidirDryRun({ ...baixadas, mensagemDryRun: true })).toBe(true);
  });

  it('modo global diferente de "live" simula', () => {
    for (const modo of ['dry-run', 'liv', 'LIVE ', 'true', '1', '', undefined]) {
      const r = decidirDryRun({ ...baixadas, modoGlobal: modo });
      // "LIVE " com espaco e maiuscula E aceito — o valor e normalizado.
      const esperado = modo?.trim().toLowerCase() !== 'live';
      expect(r).toBe(esperado);
    }
  });

  /**
   * Tabela verdade completa. Escrita a mao em vez de gerada: o objetivo
   * e que qualquer pessoa consiga ler e confirmar que existe exatamente
   * UMA linha `false`.
   */
  it.each([
    [false, false, 'live', false],
    [true, false, 'live', true],
    [false, true, 'live', true],
    [true, true, 'live', true],
    [false, false, 'dry-run', true],
    [true, false, 'dry-run', true],
    [false, true, 'dry-run', true],
    [true, true, 'dry-run', true],
    [false, false, undefined, true],
  ])(
    'campanha=%s mensagem=%s global=%s => simula=%s',
    (campanhaDryRun, mensagemDryRun, modoGlobal, esperado) => {
      expect(
        decidirDryRun({
          campanhaDryRun: campanhaDryRun as boolean,
          mensagemDryRun: mensagemDryRun as boolean,
          modoGlobal: modoGlobal as string | undefined,
        })
      ).toBe(esperado);
    }
  );

  it('exatamente uma das nove combinacoes envia de verdade', () => {
    const valores = [true, false];
    const modos = ['live', 'dry-run', undefined];
    let enviamDeVerdade = 0;

    for (const campanhaDryRun of valores) {
      for (const mensagemDryRun of valores) {
        for (const modoGlobal of modos) {
          if (!decidirDryRun({ campanhaDryRun, mensagemDryRun, modoGlobal })) {
            enviamDeVerdade += 1;
          }
        }
      }
    }

    expect(enviamDeVerdade).toBe(1);
  });
});

describe('o padrao e sempre seguro', () => {
  it('sem WHATSAPP_MODE configurado, simula', () => {
    expect(decidirDryRun({
      campanhaDryRun: false,
      mensagemDryRun: false,
      modoGlobal: undefined,
    })).toBe(true);
  });

  it('resolverModo e decidirDryRun concordam', () => {
    for (const v of ['live', 'dry-run', 'liv', '', undefined]) {
      const modoResolvido = resolverModo(v);
      const simula = decidirDryRun({
        campanhaDryRun: false,
        mensagemDryRun: false,
        modoGlobal: v,
      });
      expect(simula).toBe(modoResolvido !== 'live');
    }
  });

  it('o .env do repositorio nao esta em live', async () => {
    // Uma rede de seguranca contra commit acidental de WHATSAPP_MODE=live.
    const { readFileSync, existsSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const raiz = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..'
    );

    for (const arquivo of ['.env', '.env.example']) {
      const caminho = path.join(raiz, arquivo);
      if (!existsSync(caminho)) continue;
      const conteudo = readFileSync(caminho, 'utf8');
      const linha = conteudo
        .split('\n')
        .find((l) => l.trim().startsWith('WHATSAPP_MODE='));
      if (linha) {
        expect(linha.split('=')[1]?.trim()).not.toBe('live');
      }
    }
  });
});
