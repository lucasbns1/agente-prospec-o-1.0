/**
 * O contexto fabricado que o `pnpm ia:testar` manda para o Gemini.
 *
 * ============================================================
 * POR QUE ISTO SAIU DE DENTRO DO SCRIPT
 * ============================================================
 * Enquanto morava dentro de `testar-gemini.ts`, este objeto nao era
 * verificado por nada: `tsx` apaga os tipos sem conferi-los, e nenhum
 * teste importava o script. Quando o `ContextoCadencia` ganhou o campo
 * `tarefasPendentes`, o fixture ficou para tras — e `montarPrompt`
 * quebrou com "Cannot read properties of undefined (reading 'length')"
 * ANTES de qualquer chamada de rede. O usuario leu aquilo como "a chave
 * nao funciona"; a chave nunca chegou a ser usada.
 *
 * Num arquivo proprio, um teste da suite monta o prompt com ele. Se o
 * contexto ganhar outro campo obrigatorio e este fixture nao acompanhar,
 * quem descobre e o `pnpm test`, e nao voce no terminal achando que o
 * problema e a sua chave.
 */
import type { ContextoCadencia } from '../packages/domain/src/index.js';

/**
 * Um lead fabricado: mensagem 1 entregue, lead respondeu "claro, pode
 * mandar", mensagem 2 ainda sem envio.
 *
 * A resposta certa e obvia para um humano — SEND_STEP na etapa 2 — e e
 * justamente por isso que serve de teste: se o modelo devolver outra
 * coisa, o problema nao e a chave.
 */
export function contextoDeTeste(agora: Date = new Date()): ContextoCadencia {
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
    // Vazio de proposito: o cenario e um lead que o operador ainda nao
    // tocou. Mas o campo EXISTE — e a ausencia dele que causou a falha
    // que este arquivo documenta.
    tarefasPendentes: [],
    regras: [{ categoria: 'POSITIVO', acao: 'AVANCAR' }],
    relogio: {
      agora: agora.toISOString(),
      segundosDesdeUltimoEnvio: 300,
    },
  };
}
