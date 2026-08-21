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

/**
 * ============================================================
 * O MODO GLOBAL SAIU — E POR QUE ISTO CONTINUA IMPORTANDO
 * ============================================================
 * Havia aqui uma terceira barreira, `WHATSAPP_MODE`, que travava o envio
 * do sistema inteiro por variavel de ambiente. Ela foi removida a pedido
 * do dono do projeto: era invisivel de dentro do produto e fazia uma
 * campanha corretamente liberada parecer quebrada.
 *
 * Sobraram DUAS barreiras nesta funcao — campanha e mensagem — mais a
 * trava de fase, que vive no codigo e e testada em `canal-adapter`.
 *
 * A tabela verdade encolheu de nove linhas para quatro. O que NAO mudou e
 * a regra: basta uma barreira levantada para nada sair, e existe
 * exatamente UMA combinacao que envia de verdade.
 */
describe('decidirDryRun — so envia de verdade com as duas barreiras baixas', () => {
  const baixadas = {
    campanhaDryRun: false,
    mensagemDryRun: false,
  };

  it('a unica combinacao que envia de verdade e todas baixas', () => {
    expect(decidirDryRun(baixadas)).toBe(false);
  });

  it('campanha em dry-run simula', () => {
    expect(decidirDryRun({ ...baixadas, campanhaDryRun: true })).toBe(true);
  });

  it('mensagem marcada dry-run simula, mesmo com a campanha liberada', () => {
    expect(decidirDryRun({ ...baixadas, mensagemDryRun: true })).toBe(true);
  });

  /**
   * Tabela verdade completa. Escrita a mao em vez de gerada: o objetivo
   * e que qualquer pessoa consiga ler e confirmar que existe exatamente
   * UMA linha `false`.
   */
  it.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])(
    'campanha=%s mensagem=%s => simula=%s',
    (campanhaDryRun, mensagemDryRun, esperado) => {
      expect(
        decidirDryRun({
          campanhaDryRun: campanhaDryRun as boolean,
          mensagemDryRun: mensagemDryRun as boolean,
        })
      ).toBe(esperado);
    }
  );

  it('exatamente uma das quatro combinacoes envia de verdade', () => {
    const valores = [true, false];
    let enviamDeVerdade = 0;

    for (const campanhaDryRun of valores) {
      for (const mensagemDryRun of valores) {
        if (!decidirDryRun({ campanhaDryRun, mensagemDryRun })) {
          enviamDeVerdade += 1;
        }
      }
    }

    expect(enviamDeVerdade).toBe(1);
  });
});

describe('o modo global nao volta pela porta dos fundos', () => {
  it('nenhum arquivo do codigo le WHATSAPP_MODE', async () => {
    // Substitui o antigo "o .env do repositorio nao esta em live".
    //
    // Aquele teste protegia uma variavel que nao existe mais. Este
    // protege a REMOCAO: se alguem reintroduzir a leitura da variavel,
    // o sistema volta a ter uma trava invisivel que ninguem consegue
    // desligar pela tela — o defeito exato que motivou tira-la.
    //
    // Comentario que apenas MENCIONA o nome nao conta; o que nao pode
    // voltar e a leitura.
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

    const culpados: string[] = [];

    const varrer = (dir: string): void => {
      for (const nome of readdirSync(dir)) {
        if (nome === 'node_modules' || nome === '.git' || nome === 'dist') continue;
        const completo = path.join(dir, nome);
        if (statSync(completo).isDirectory()) {
          varrer(completo);
        } else if (/\.(ts|tsx)$/.test(nome) && !completo.includes(`${path.sep}tests${path.sep}`)) {
          const conteudo = readFileSync(completo, 'utf8');
          if (/process\.env\.WHATSAPP_MODE|env\.WHATSAPP_MODE/.test(conteudo)) {
            culpados.push(path.relative(raiz, completo));
          }
        }
      }
    };

    for (const alvo of ['apps', 'packages']) varrer(path.join(raiz, alvo));

    expect(culpados).toEqual([]);
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
