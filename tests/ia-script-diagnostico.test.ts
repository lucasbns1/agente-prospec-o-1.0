/**
 * O `pnpm ia:testar` nao pode quebrar antes de falar com o Google.
 *
 * ============================================================
 * A FALHA QUE ESTE ARQUIVO EXISTE PARA IMPEDIR
 * ============================================================
 * O `ContextoCadencia` ganhou o campo `tarefasPendentes`. O contexto
 * fabricado do script de diagnostico nao acompanhou. `tsx` apaga os
 * tipos sem conferir e nenhum teste importava o script, entao ninguem
 * viu — ate `montarPrompt` estourar com "Cannot read properties of
 * undefined (reading 'length')" na maquina do usuario.
 *
 * O estrago nao foi o erro em si: foi o script ter dito "chave invalida
 * ou revogada -> gere outra". A chamada nunca saiu. A chave estava boa.
 *
 * ============================================================
 * POR QUE UM TESTE, E NAO SO CORRIGIR O CAMPO
 * ============================================================
 * Corrigir o campo resolve hoje. O que se repete e o padrao: um campo
 * novo no contexto, um fixture de script que fica para tras, e o usuario
 * como primeiro a descobrir. Aqui o prompt e montado de verdade — logo
 * qualquer campo obrigatorio que o fixture deixe de ter derruba o
 * `pnpm test`, que e onde isso tem que aparecer.
 */
import { describe, it, expect } from 'vitest';
import { montarPrompt, esquemaRespostaIA } from '@prospector/domain';
import { contextoDeTeste } from '../scripts/contexto-de-teste.js';

describe('contexto fabricado do pnpm ia:testar', () => {
  it('monta o prompt sem estourar', () => {
    // O `expect(...).not.toThrow()` e o teste inteiro. Se faltar um campo
    // que o prompt le, isto falha aqui e nao no terminal do usuario.
    expect(() => montarPrompt(contextoDeTeste())).not.toThrow();
  });

  it('leva o cenario que o script promete descrever', () => {
    const prompt = montarPrompt(contextoDeTeste());

    // O script imprime "mensagem 1 ENTREGUE, lead respondeu 'claro, pode
    // mandar', mensagem 2 sem envio" e depois compara a decisao com
    // SEND_STEP na etapa 2. Se o prompt nao contiver esses fatos, a
    // comparacao vira sorte.
    expect(prompt).toContain('claro, pode mandar');
    expect(prompt).toContain('ENTREGUE');
    expect(prompt).toContain('Proposta');
  });

  it('nao inventa tarefa aberta para o lead', () => {
    // Cenario e de lead intocado. Com tarefa aberta no retrato, o modelo
    // teria motivo para NAO pedir intervencao — e o script deixaria de
    // testar o que diz testar.
    expect(contextoDeTeste().tarefasPendentes).toEqual([]);
    expect(montarPrompt(contextoDeTeste())).not.toContain('TAREFA ABERTA');
  });

  it('o relogio do contexto e coerente com os envios', () => {
    const agora = new Date('2026-08-20T15:00:00.000Z');
    const ctx = contextoDeTeste(agora);

    expect(ctx.relogio.agora).toBe(agora.toISOString());
    expect(ctx.relogio.segundosDesdeUltimoEnvio).toBe(300);
    expect(ctx.envios[0]!.enviadaEm).toBe(
      new Date(agora.getTime() - 300_000).toISOString()
    );
  });

  it('o schema que a guarda usa aceita a resposta que o script espera', () => {
    // O script considera sucesso `acao === 'SEND_STEP' && etapaOrdem === 2`.
    // Se essa combinacao nao passar pelo Zod, o script cobraria do modelo
    // uma resposta que o proprio sistema recusaria depois.
    const r = esquemaRespostaIA.safeParse({
      intent: 'INTERESSE',
      action: 'SEND_STEP',
      confidence: 90,
      needs_human: false,
      opt_out: false,
      reason: 'lead pediu para mandar',
      next_step: 2,
      wait_seconds: null,
    });

    expect(r.success).toBe(true);
  });
});
