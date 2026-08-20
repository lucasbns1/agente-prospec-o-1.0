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
// O contexto fabricado mora num arquivo proprio para que a suite de
// testes consiga monta-lo tambem. Ver o cabecalho de la.
import { contextoDeTeste } from './contexto-de-teste.js';
import { conferirFormatoDaChave } from './formato-da-chave.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(aqui, '../.env') });

/**
 * Tira a frase de dentro do JSON que a SDK devolve como mensagem.
 *
 * A coluna `erro` de `ai_decisions` guarda o texto inteiro de proposito —
 * la o detalhe vale. Aqui na tela, um bloco JSON de tres linhas so
 * esconde o "API key not valid" que e a unica coisa que interessa ler.
 *
 * Nao lanca em nada: se o formato mudar, mostra o texto cru.
 */
function legivel(erro: string): string {
  try {
    const j = JSON.parse(erro) as { error?: { message?: string; code?: number } };
    const msg = j.error?.message;
    if (!msg) return erro;
    return j.error?.code ? `${msg} (HTTP ${j.error.code})` : msg;
  } catch {
    return erro;
  }
}

async function main(): Promise<void> {
  console.log('\n=== TESTE DA CHAVE DO GEMINI ===\n');

  const ligada = process.env.GEMINI_ENABLED?.trim().toLowerCase() === 'true';
  const temChave = Boolean(process.env.GEMINI_API_KEY?.trim());
  const modelo = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash';
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

  // O Google responde "API key not valid" para chave revogada e para
  // texto que nunca foi chave. Aqui da para separar os dois casos sem
  // gastar a chamada — e sem a chave aparecer na tela.
  if (temChave) {
    const formato = conferirFormatoDaChave(process.env.GEMINI_API_KEY!);
    if (formato.problemas.length > 0) {
      console.log('A CHAVE NAO TEM O FORMATO DE UMA API KEY DO AI STUDIO:');
      for (const p of formato.problemas) console.log(`  - ${p}`);
      console.log('');
      console.log('A chamada vai ser feita mesmo assim, para voce ver a resposta');
      console.log('do Google. Mas o mais provavel e que ela seja recusada.\n');
    }
  }

  if (!ligada) {
    console.log('A IA esta DESLIGADA. Ponha GEMINI_ENABLED=true no .env para testar.\n');
    process.exitCode = 1;
    return;
  }
  if (!temChave) {
    console.log('Falta a GEMINI_API_KEY no .env.');
    console.log('Pegue a sua em: https://aistudio.google.com/apikey\n');
    process.exitCode = 1;
    return;
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
    process.exitCode = 1;
    return;
  }

  console.log('Fazendo UMA chamada de verdade ao Gemini...\n');
  const r = await analisador.analisar(contextoDeTeste());

  if (!r.ok) {
    console.log('--- FALHOU ---\n');
    console.log(`erro     : ${legivel(r.erro)}`);
    console.log(`latencia : ${r.latenciaMs}ms\n`);

    // A origem muda o conselho inteiro. Antes o script sugeria trocar a
    // chave para QUALQUER falha — inclusive para um bug nosso, com a
    // chave perfeita.
    if (r.origem === 'CODIGO') {
      console.log('Isto e um DEFEITO DO PROSPECTOR, nao da sua chave.');
      console.log('A chamada nem chegou ao Google. Nao troque a chave.\n');
      if (r.pilha) {
        console.log('Onde quebrou:');
        console.log(
          r.pilha
            .split('\n')
            .slice(0, 6)
            .map((l) => `  ${l.trim()}`)
            .join('\n')
        );
        console.log('');
      }
      console.log('Mande estas linhas para quem cuida do codigo.\n');
    } else if (r.origem === 'RESPOSTA') {
      console.log('A chave FUNCIONA — a chamada foi e voltou. O que veio e que');
      console.log('nao serviu: resposta vazia ou fora do formato combinado.');
      console.log('Costuma ser modelo trocado ou limite de token.\n');
      console.log(`Confira GEMINI_MODEL (esta "${modelo}").\n`);
    } else {
      const formato = conferirFormatoDaChave(process.env.GEMINI_API_KEY ?? '');
      if (formato.problemas.length > 0) {
        // Nao repete a lista: ela ja saiu la em cima. Repete a conclusao,
        // porque e ela que responde "e agora?".
        console.log('Sua chave nao tem o formato de uma API key do AI Studio');
        console.log('(os motivos estao logo no comeco desta saida).');
        console.log('Pegue uma em https://aistudio.google.com/apikey — ela comeca');
        console.log('com "AIza" e vem numa linha unica, sem aspas.\n');
        console.log('IMPORTANTE: mesmo com isto falhando, a cadencia funciona.');
        console.log('O motor deterministico assume e nada para.\n');
        process.exitCode = 1;
        return;
      }
      console.log('O que costuma causar isso:');
      console.log('  - chave invalida ou revogada     -> gere outra em aistudio.google.com/apikey');
      console.log('  - sem internet ou atras de proxy -> teste abrir o site acima no navegador');
      console.log(`  - modelo inexistente             -> confira GEMINI_MODEL (esta "${modelo}")`);
      console.log('  - tempo esgotado                 -> aumente GEMINI_TIMEOUT_MS\n');
    }

    console.log('IMPORTANTE: mesmo com isto falhando, a cadencia funciona.');
    console.log('O motor deterministico assume e nada para.\n');
    process.exitCode = 1;
    return;
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
  process.exitCode = 1;
});
