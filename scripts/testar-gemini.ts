/**
 * Uma chamada real ao Gemini, para responder "a chave funciona?".
 *
 * ============================================================
 * POR QUE ISTO PRECISA EXISTIR
 * ============================================================
 * Toda a suite de testes usa um analisador FALSO — de proposito, para
 * ser deterministica e nao gastar chamadas. O efeito colateral e que a
 * chave de verdade nunca e exercitada por teste nenhum.
 *
 * Entao existe este script: ele monta um contexto fabricado, faz UMA
 * chamada, e diz o que aconteceu. Nao toca no banco, nao envia nada, nao
 * cria lead. Rodar dez vezes nao muda nada no sistema.
 *
 * Uso:  pnpm ia:testar
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Import por caminho relativo, como os demais scripts da pasta: a raiz
// do monorepo nao declara os packages como dependencia, entao
// `@prospector/...` nao resolve daqui.
import type { ContextoCadencia } from '../packages/domain/src/index.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(aqui, '../.env') });

/**
 * Um lead fabricado: mensagem 1 entregue, lead respondeu "claro, pode
 * mandar", mensagem 2 ainda sem envio.
 *
 * A resposta certa e obvia para um humano — SEND_STEP na etapa 2 — e e
 * justamente por isso que serve de teste: se o modelo devolver outra
 * coisa, o problema nao e a chave.
 */
function contextoDeTeste(): ContextoCadencia {
  const agora = new Date();
  return {
    gatilho: 'MENSAGEM_RECEBIDA',
    campanha: {
      id: 'teste',
      nome: 'Prospeccao de sites',
      status: 'ATIVA',
      dentroDaJanela: true,
    },
    sequencia: [
      {
        ordem: 1,
        nome: 'Abordagem',
        texto: 'Oi, é o {{empresa}} aí do {{bairro}}?',
        aguardarResposta: true,
        enviarAutomaticamente: true,
        delaySegundos: 0,
      },
      {
        ordem: 2,
        nome: 'Proposta',
        texto: 'Vi vocês no Google e reparei que ainda não têm um site...',
        aguardarResposta: true,
        enviarAutomaticamente: true,
        delaySegundos: 120,
      },
      {
        ordem: 3,
        nome: 'Prévia',
        texto: 'Montei uma ideia rápida de como poderia ficar...',
        aguardarResposta: false,
        enviarAutomaticamente: false,
        delaySegundos: 120,
      },
    ],
    lead: {
      id: 'teste',
      nome: null,
      empresa: 'Studio Teste Prospector',
      bairro: 'Centro',
      cidade: 'São Paulo',
      optOut: false,
      status: 'AGUARDANDO_RESPOSTA',
      temperatura: 'MORNO',
    },
    posicao: {
      etapaAtualOrdem: 1,
      statusNaCampanha: 'AGUARDANDO_RESPOSTA',
      aguardandoLiberacao: false,
      proximoEnvioEm: null,
    },
    envios: [
      {
        ordem: 1,
        statusOutbound: 'ENVIADA',
        statusMensagem: 'ENTREGUE',
        enviadaEm: new Date(agora.getTime() - 300_000).toISOString(),
        erro: null,
        dryRun: false,
      },
    ],
    respostas: [
      {
        texto: 'claro, pode mandar',
        recebidaEm: new Date(agora.getTime() - 60_000).toISOString(),
        categoriaDoMotor: 'POSITIVO',
        confiancaDoMotor: 85,
      },
    ],
    conversa: [
      {
        direcao: 'ENVIADA',
        texto: 'Oi! É do Studio Teste Prospector aí do Centro?',
        quando: new Date(agora.getTime() - 300_000).toISOString(),
        status: 'ENTREGUE',
      },
      {
        direcao: 'RECEBIDA',
        texto: 'claro, pode mandar',
        quando: new Date(agora.getTime() - 60_000).toISOString(),
        status: 'ENTREGUE',
        categoriaDoMotor: 'POSITIVO',
      },
    ],
    regras: [{ categoria: 'POSITIVO', acao: 'AVANCAR' }],
    relogio: {
      agora: agora.toISOString(),
      segundosDesdeUltimoEnvio: 300,
    },
  };
}

async function main(): Promise<void> {
  console.log('\n=== TESTE DA CHAVE DO GEMINI ===\n');

  const ligada = process.env.GEMINI_ENABLED?.trim().toLowerCase() === 'true';
  const temChave = Boolean(process.env.GEMINI_API_KEY?.trim());
  const modelo = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  const sombra = process.env.AI_ANALYSIS_ONLY?.trim().toLowerCase() !== 'false';

  console.log(`GEMINI_ENABLED    : ${ligada ? 'true' : 'false'}`);
  // O tamanho basta para distinguir "vazia" de "preenchida" sem imprimir
  // a chave. Ela nao vai para o terminal, que costuma virar print.
  console.log(
    `GEMINI_API_KEY    : ${temChave ? `preenchida (${process.env.GEMINI_API_KEY!.trim().length} caracteres)` : 'VAZIA'}`
  );
  console.log(`GEMINI_MODEL      : ${modelo}`);
  console.log(`AI_ANALYSIS_ONLY  : ${sombra ? 'true (modo sombra)' : 'false (IA no comando)'}`);
  console.log('');

  if (!ligada) {
    console.log('A IA esta DESLIGADA. Ponha GEMINI_ENABLED=true no .env para testar.\n');
    process.exit(1);
  }
  if (!temChave) {
    console.log('Falta a GEMINI_API_KEY no .env.');
    console.log('Pegue a sua em: https://aistudio.google.com/apikey\n');
    process.exit(1);
  }

  const { criarAnalisador } = await import('../packages/integrations/src/index.js');
  const analisador = await criarAnalisador({
    GEMINI_ENABLED: true,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: modelo,
    GEMINI_TIMEOUT_MS: Number(process.env.GEMINI_TIMEOUT_MS) || 8000,
  });

  if (!analisador) {
    console.log('Nao foi possivel criar o analisador.\n');
    process.exit(1);
  }

  console.log('Fazendo UMA chamada de verdade ao Gemini...\n');
  const r = await analisador.analisar(contextoDeTeste());

  if (!r.ok) {
    console.log('--- FALHOU ---\n');
    console.log(`erro     : ${r.erro}`);
    console.log(`latencia : ${r.latenciaMs}ms\n`);
    console.log('O que costuma causar isso:');
    console.log('  - chave invalida ou revogada     -> gere outra em aistudio.google.com/apikey');
    console.log('  - sem internet ou atras de proxy -> teste abrir o site acima no navegador');
    console.log(`  - modelo inexistente             -> confira GEMINI_MODEL (esta "${modelo}")`);
    console.log('  - tempo esgotado                 -> aumente GEMINI_TIMEOUT_MS\n');
    console.log('IMPORTANTE: mesmo com isto falhando, a cadencia funciona.');
    console.log('O motor deterministico assume e nada para.\n');
    process.exit(1);
  }

  const d = r.decisao;
  console.log('--- FUNCIONOU ---\n');
  console.log(`modelo   : ${r.modelo}`);
  console.log(`latencia : ${r.latenciaMs}ms\n`);
  console.log('O cenario apresentado: mensagem 1 ENTREGUE, lead respondeu');
  console.log('"claro, pode mandar", mensagem 2 ainda sem envio.\n');
  console.log('O que a IA decidiu:');
  console.log(`  intent        : ${d.intent}`);
  console.log(`  acao          : ${d.acao}`);
  console.log(`  etapa alvo    : ${d.etapaOrdem ?? '(nenhuma)'}`);
  console.log(`  confianca     : ${d.confianca}`);
  console.log(`  precisa humano: ${d.precisaHumano ? 'sim' : 'nao'}`);
  console.log(`  opt-out       : ${d.optOut ? 'SIM' : 'nao'}`);
  console.log(`  motivo        : ${d.motivo}\n`);

  const esperado = d.acao === 'SEND_STEP' && d.etapaOrdem === 2;
  console.log(
    esperado
      ? 'A decisao bate com o esperado (enviar a etapa 2). A chave esta boa.\n'
      : 'A chamada funcionou, mas a decisao nao foi a esperada (SEND_STEP na etapa 2).\n' +
          'A chave esta boa; o que varia e o julgamento do modelo. Em modo sombra\n' +
          'isso e inofensivo — quem comanda continua sendo o motor.\n'
  );

  if (!sombra) {
    console.log('ATENCAO: AI_ANALYSIS_ONLY=false. A IA esta COMANDANDO a cadencia.');
    console.log('Se voce ainda nao olhou a tabela ai_decisions, volte para true.\n');
  }
}

main().catch((err) => {
  console.error('\n[FALHA]', err instanceof Error ? err.message : err, '\n');
  process.exit(1);
});
