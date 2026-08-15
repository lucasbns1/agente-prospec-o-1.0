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

// ---------------------------------------------------------------------------
// O ENVIO QUE NÃO RESPONDE
//
// `sendMessage` não tinha tempo limite. O whatsapp-web.js roda sobre um
// Chromium controlado remotamente e, em algumas conversas — LID
// principalmente —, a promessa nunca resolve. A mensagem CHEGA no
// celular e o worker fica pendurado.
//
// Visto em uso real: mensagem 2 entregue às 12:19, fila presa em
// "Processando" indefinidamente. Sem o envio concluir, a etapa não
// avança e a mensagem 3 nunca nasce.
// ---------------------------------------------------------------------------
describe('comTempoLimite', () => {
  it('devolve o valor quando a promessa responde a tempo', async () => {
    const { comTempoLimite } = await import('../apps/worker/src/workers/outbound.js');
    await expect(comTempoLimite(Promise.resolve('ok'), 5)).resolves.toBe('ok');
  });

  it('desiste quando a promessa nunca resolve', async () => {
    const { comTempoLimite, EnvioSemResposta } = await import(
      '../apps/worker/src/workers/outbound.js'
    );
    // Uma promessa que nunca resolve é exatamente o caso real: o
    // Chromium aceitou a mensagem e não devolveu nada.
    const travada = new Promise<string>(() => {});
    await expect(comTempoLimite(travada, 0.05)).rejects.toBeInstanceOf(EnvioSemResposta);
  });

  it('o erro avisa que a mensagem PODE ter saído', async () => {
    const { comTempoLimite } = await import('../apps/worker/src/workers/outbound.js');
    const travada = new Promise<string>(() => {});
    await expect(comTempoLimite(travada, 0.05)).rejects.toThrow(/PODE ter saído/i);
  });

  it('propaga o erro original quando o envio falha de verdade', async () => {
    const { comTempoLimite } = await import('../apps/worker/src/workers/outbound.js');
    // Uma recusa real não pode ser confundida com timeout: os dois
    // levam a mensagens diferentes para o usuário.
    await expect(
      comTempoLimite(Promise.reject(new Error('numero invalido')), 5)
    ).rejects.toThrow('numero invalido');
  });

  it('o limite padrão é generoso o bastante para envio lento', async () => {
    const { SEGUNDOS_ATE_DESISTIR_DO_ENVIO } = await import(
      '../apps/worker/src/workers/outbound.js'
    );
    // Curto demais transformaria envio lento em falha; longo demais
    // seria indistinguível de travado.
    expect(SEGUNDOS_ATE_DESISTIR_DO_ENVIO).toBeGreaterThanOrEqual(30);
    expect(SEGUNDOS_ATE_DESISTIR_DO_ENVIO).toBeLessThanOrEqual(180);
  });
});
