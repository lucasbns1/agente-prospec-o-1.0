/**
 * O ÚNICO teste que fala com o Google de verdade.
 *
 * ============================================================
 * DESLIGADO POR PADRAO, E ISSO NAO E TIMIDEZ
 * ============================================================
 * Um teste que depende de um modelo remoto falha por motivos que nada
 * tem a ver com o codigo: rede instavel, quota, latencia, o modelo
 * mudando de humor entre versoes. Um teste que falha sozinho deixa de
 * ser lido, e quando ele finalmente aponta um defeito real ninguem
 * acredita.
 *
 * Por isso a suite inteira usa um analisador falso, e este arquivo fica
 * fora dela até você pedir:
 *
 *   GEMINI_TESTE_REAL=true pnpm test tests/gemini-real.test.ts
 *
 * Precisa de GEMINI_API_KEY no .env. Gasta chamadas de verdade — poucas,
 * mas gasta.
 *
 * ============================================================
 * O QUE ELE VERIFICA, E O QUE NAO VERIFICA
 * ============================================================
 * VERIFICA o contrato: o modelo responde, o JSON cabe no schema, os
 * enums sao os nossos, a guarda aceita o resultado.
 *
 * NAO VERIFICA julgamento. As asserções sao sobre FORMA, nao sobre qual
 * decisao o modelo tomou — exceto no caso de opt-out, que é a única
 * onde o julgamento certo é obrigatório, e mesmo lá a guarda
 * determinista já garantiria o comportamento sozinha.
 *
 * NENHUMA MENSAGEM DE WHATSAPP SAI DAQUI. Não há adapter, não há banco.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import {
  ACAO_IA,
  INTENT_IA,
  validarDecisao,
  type ContextoCadencia,
} from '@prospector/domain';
import type { AnalisadorDeCadencia } from '@prospector/integrations';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });

const LIGADO =
  process.env.GEMINI_TESTE_REAL?.trim().toLowerCase() === 'true' &&
  Boolean(process.env.GEMINI_API_KEY?.trim());

let analisador: AnalisadorDeCadencia;

/**
 * O cenario base: mensagem 1 entregue, mensagem 2 sem envio.
 *
 * `resposta` é o que o lead disse — é o único parâmetro, para que cada
 * caso teste exatamente uma coisa.
 */
function contexto(resposta: string): ContextoCadencia {
  const agora = new Date();
  const enviadaEm = new Date(agora.getTime() - 300_000).toISOString();

  return {
    gatilho: 'MENSAGEM_RECEBIDA',
    campanha: { id: 'c', nome: 'Prospeccao de sites', status: 'ATIVA', dentroDaJanela: true },
    sequencia: [
      { ordem: 1, nome: 'Abordagem', texto: 'Oi, é o {{empresa}} aí do {{bairro}}?', aguardarResposta: true, enviarAutomaticamente: true, delaySegundos: 0 },
      { ordem: 2, nome: 'Proposta', texto: 'Vi vocês no Google e reparei que ainda não têm um site...', aguardarResposta: true, enviarAutomaticamente: true, delaySegundos: 120 },
      { ordem: 3, nome: 'Prévia', texto: 'Montei uma ideia rápida...', aguardarResposta: false, enviarAutomaticamente: false, delaySegundos: 120 },
    ],
    lead: {
      id: 'l', nome: null, empresa: 'Studio Teste Prospector', bairro: 'Centro',
      cidade: 'São Paulo', optOut: false, status: 'AGUARDANDO_RESPOSTA', temperatura: 'MORNO',
    },
    posicao: {
      etapaAtualOrdem: 1, statusNaCampanha: 'AGUARDANDO_RESPOSTA',
      aguardandoLiberacao: false, proximoEnvioEm: null,
    },
    envios: [
      { ordem: 1, statusOutbound: 'ENVIADA', statusMensagem: 'ENTREGUE', enviadaEm, erro: null, dryRun: false },
    ],
    respostas: [
      { texto: resposta, recebidaEm: agora.toISOString(), categoriaDoMotor: 'DESCONHECIDO', confiancaDoMotor: 0 },
    ],
    conversa: [
      { direcao: 'ENVIADA', texto: 'Oi! É do Studio Teste Prospector aí do Centro?', quando: enviadaEm, status: 'ENTREGUE' },
      { direcao: 'RECEBIDA', texto: resposta, quando: agora.toISOString(), status: 'ENTREGUE', categoriaDoMotor: 'DESCONHECIDO' },
    ],
    regras: [{ categoria: 'POSITIVO', acao: 'AVANCAR' }],
    relogio: { agora: agora.toISOString(), segundosDesdeUltimoEnvio: 300 },
  };
}

describe.skipIf(!LIGADO)('Gemini real (GEMINI_TESTE_REAL=true)', () => {
  beforeAll(async () => {
    const { criarAnalisador } = await import('@prospector/integrations');
    const a = await criarAnalisador({
      GEMINI_ENABLED: true,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GEMINI_MODEL: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
      GEMINI_TIMEOUT_MS: 20_000,
    });
    if (!a) throw new Error('Nao foi possivel criar o analisador');
    analisador = a;
  }, 30_000);

  it(
    'responde dentro do contrato: enums nossos, confianca 0-100, motivo em texto',
    async () => {
      const r = await analisador.analisar(contexto('claro, pode mandar'));
      expect(r.ok, r.ok ? '' : `A chamada falhou: ${r.erro}`).toBe(true);
      if (!r.ok) return;

      expect(INTENT_IA).toContain(r.decisao.intent);
      expect(ACAO_IA).toContain(r.decisao.acao);
      expect(r.decisao.confianca).toBeGreaterThanOrEqual(0);
      expect(r.decisao.confianca).toBeLessThanOrEqual(100);
      expect(r.decisao.motivo.length).toBeGreaterThan(0);
      expect(r.latenciaMs).toBeGreaterThan(0);
    },
    30_000
  );

  // A única asserção sobre JULGAMENTO neste arquivo. "Não quero receber
  // mais mensagens" não tem leitura alternativa — se o modelo errar
  // isto, o problema é o modelo ou o prompt, e vale saber.
  //
  // Mesmo assim a guarda determinista garantiria o comportamento
  // sozinha; isto aqui mede a qualidade do modelo, não a segurança do
  // sistema.
  it(
    'reconhece um opt-out explicito',
    async () => {
      const r = await analisador.analisar(contexto('não quero receber mais mensagens, obrigado'));
      expect(r.ok, r.ok ? '' : `A chamada falhou: ${r.erro}`).toBe(true);
      if (!r.ok) return;

      expect(r.decisao.intent).toBe('OPT_OUT');
      expect(r.decisao.optOut).toBe(true);
      expect(r.decisao.acao).toBe('STOP_CAMPAIGN');
    },
    30_000
  );

  // O ponto que mais importa: qualquer que seja a decisão do modelo, ela
  // passa pela guarda — e a guarda nunca deixa sair mensagem para quem
  // está em opt-out.
  it(
    'qualquer decisao dele sobre um lead em opt-out vira STOP_CAMPAIGN',
    async () => {
      const ctx = contexto('pode mandar sim, quero ver');
      ctx.lead.optOut = true;

      const r = await analisador.analisar(ctx);
      expect(r.ok, r.ok ? '' : `A chamada falhou: ${r.erro}`).toBe(true);
      if (!r.ok) return;

      const veredito = validarDecisao(ctx, r.decisao);
      expect(veredito.acaoFinal).toBe('STOP_CAMPAIGN');
    },
    30_000
  );

  it(
    'uma pergunta que a campanha nao sabe responder pede intervencao',
    async () => {
      const r = await analisador.analisar(
        contexto('quanto ficaria para uma loja virtual com pagamento?')
      );
      expect(r.ok, r.ok ? '' : `A chamada falhou: ${r.erro}`).toBe(true);
      if (!r.ok) return;

      // Aqui a asserção é deliberadamente frouxa: o que NÃO pode
      // acontecer é o modelo mandar a próxima mensagem da sequência como
      // se a pergunta não existisse.
      const seguro =
        r.decisao.precisaHumano ||
        ['CREATE_INTERVENTION', 'PAUSE', 'NOTIFY_OPERATOR', 'WAIT'].includes(r.decisao.acao);
      expect(
        seguro,
        `O modelo respondeu ${r.decisao.acao} sem pedir intervencao: ${r.decisao.motivo}`
      ).toBe(true);
    },
    30_000
  );
});

describe.skipIf(LIGADO)('Gemini real (desligado)', () => {
  it('esta desligado — ligue com GEMINI_TESTE_REAL=true', () => {
    expect(LIGADO).toBe(false);
  });
});
