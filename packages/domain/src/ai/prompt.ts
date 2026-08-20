/**
 * Montagem do prompt.
 *
 * ============================================================
 * DUAS REGRAS QUE VALEM PARA TODO ESTE ARQUIVO
 * ============================================================
 * 1. NENHUM SEGREDO ENTRA AQUI. Nao ha chave de API, token, senha nem
 *    caminho de sessao neste texto. O que entra e o que o modelo precisa
 *    para decidir: a campanha, a posicao do lead e o estado dos envios.
 *
 * 2. FUNCAO PURA. Sem data.now(), sem random, sem leitura de ambiente.
 *    O horario vem do contexto, ja resolvido pelo backend — porque o
 *    item "o Gemini nao decide que horas sao" tem que valer tambem para
 *    o texto que ele le.
 *
 * O prompt PEDE as regras de seguranca alem de a guarda impo-las. Nao e
 * redundancia inutil: um modelo bem instruido erra menos, e cada erro
 * que ele nao comete e uma rejeicao a menos no log. Mas quem garante e
 * `validar-decisao.ts`, nunca este texto.
 */
import { proximaEtapaEsperada, type ContextoCadencia } from './contexto.js';
import { ACAO_IA, INTENT_IA } from './decisao-ia.js';

/**
 * Quantas respostas do lead vao no prompt.
 *
 * Nao e o historico inteiro: conversas longas custam token e afogam o
 * que importa, que e o final. As ultimas seis cobrem qualquer ida e
 * volta razoavel de uma prospeccao.
 */
const MAX_RESPOSTAS = 6;

/** Corta texto longo sem cortar no meio de uma palavra. */
function encurtar(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  return `${texto.slice(0, limite).trimEnd()}...`;
}

export const INSTRUCAO_SISTEMA = `Voce e o orquestrador de uma cadencia de prospeccao por WhatsApp de uma
pequena empresa brasileira que vende sites.

O QUE VOCE FAZ: le o estado real de um lead numa campanha e decide qual e
a PROXIMA ACAO.

O QUE VOCE NAO FAZ:
- Voce nao envia mensagem. Voce PEDE que o sistema enfileire um envio.
- Voce nao sabe se algo foi enviado. Isso esta no estado que voce recebe.
- Voce nunca afirma que enviou, entregou ou que o lead leu algo.
- Voce nao inventa horario, id de mensagem, ACK nem etapa.

REGRAS ABSOLUTAS:
1. Se o lead pediu para parar de receber mensagens de qualquer forma
   ("nao quero", "para de mandar", "me tira da lista", "sai fora"),
   responda intent OPT_OUT, opt_out true, action STOP_CAMPAIGN.
2. Nunca peca envio para um lead em opt-out.
3. Nunca peca uma etapa fora de ordem. A proxima etapa e informada no
   estado; use exatamente aquele numero.
4. Nunca peca uma etapa que ja aparece com envio no estado.
5. Se a resposta do lead exige conhecimento que a campanha nao tem
   configurado (preco sem template, pedido de proposta, "preciso falar
   com meu socio"), responda needs_human true e action
   CREATE_INTERVENTION. E melhor chamar um humano do que responder
   errado.
6. Na duvida entre agir e esperar, espere. Uma mensagem enviada nao
   volta atras.

SOBRE O TEMPO: o delay de cada etapa esta no estado, e o tempo desde o
ultimo envio tambem. Se o delay ainda nao passou, responda WAIT com
wait_seconds igual ao que falta.

Responda SOMENTE com o JSON do schema. Sem texto em volta, sem markdown.`;

/**
 * Monta o retrato do lead em texto.
 *
 * Formato de lista legivel em vez de JSON cru: modelos seguem melhor um
 * texto estruturado do que um objeto aninhado, e o resultado fica
 * legivel no log quando algo der errado.
 */
export function montarPrompt(ctx: ContextoCadencia): string {
  const l = ctx.lead;
  const p = ctx.posicao;

  const linhas: string[] = [];

  linhas.push(`GATILHO: ${ctx.gatilho}`);
  linhas.push('');

  linhas.push(`CAMPANHA: ${ctx.campanha.nome} (status ${ctx.campanha.status})`);
  linhas.push(
    `Janela de envio agora: ${ctx.campanha.dentroDaJanela ? 'aberta' : 'fechada'}`
  );
  linhas.push('');

  linhas.push('SEQUENCIA CONFIGURADA:');
  for (const e of ctx.sequencia) {
    const rotulo = e.nome?.trim() || `Mensagem ${e.ordem}`;
    const modo = e.enviarAutomaticamente
      ? 'envio automatico'
      : 'ENVIO MANUAL (exige liberacao do operador)';
    const espera = e.aguardarResposta
      ? 'congela ate o lead responder'
      : 'segue sozinha no tempo';
    linhas.push(
      `  ${e.ordem}. ${rotulo} — delay ${e.delaySegundos}s, ${modo}, ${espera}`
    );
    linhas.push(`     texto: "${encurtar(e.texto, 200)}"`);
  }
  linhas.push('');

  linhas.push('LEAD:');
  linhas.push(`  empresa: ${l.empresa ?? '(sem nome de empresa)'}`);
  linhas.push(`  responsavel: ${l.nome ?? '(desconhecido)'}`);
  linhas.push(`  local: ${[l.bairro, l.cidade].filter(Boolean).join(', ') || '(sem local)'}`);
  linhas.push(`  status: ${l.status} | temperatura: ${l.temperatura}`);
  linhas.push(`  OPT-OUT: ${l.optOut ? 'SIM — nada pode ser enviado' : 'nao'}`);
  linhas.push('');

  linhas.push('POSICAO NA CADENCIA:');
  linhas.push(`  etapa atual: ${p.etapaAtualOrdem ?? 'nenhuma ainda'}`);
  linhas.push(`  status na campanha: ${p.statusNaCampanha}`);
  linhas.push(
    `  aguardando liberacao manual: ${p.aguardandoLiberacao ? 'SIM' : 'nao'}`
  );
  linhas.push(`  proximo envio agendado para: ${p.proximoEnvioEm ?? '(nao agendado)'}`);
  linhas.push('');

  // ============================================================
  // O BLOCO MAIS IMPORTANTE DO PROMPT
  // ============================================================
  // E daqui que sai a resposta para "a mensagem 2 foi enviada?". Cada
  // linha corresponde a uma linha do banco. Se esta lista estiver vazia,
  // nada saiu — nao importa o que a conversa pareca sugerir.
  linhas.push('ENVIOS REAIS (fonte da verdade — vindos do banco):');
  if (ctx.envios.length === 0) {
    linhas.push('  (nenhum envio registrado ainda)');
  } else {
    for (const e of [...ctx.envios].sort((a, b) => a.ordem - b.ordem)) {
      const partes = [`ordem ${e.ordem}`, `ordem de envio: ${e.statusOutbound}`];
      if (e.statusMensagem) partes.push(`mensagem: ${e.statusMensagem}`);
      if (e.enviadaEm) partes.push(`saiu em ${e.enviadaEm}`);
      if (e.dryRun) partes.push('SIMULADA (dry-run)');
      if (e.erro) partes.push(`erro: ${encurtar(e.erro, 120)}`);
      linhas.push(`  - ${partes.join(' | ')}`);
    }
  }
  linhas.push('');

  // A conversa nos dois sentidos. Sem o que NOS mandamos, "pode mandar"
  // fica sem referente e o modelo teria que adivinhar a que pergunta
  // aquilo responde.
  linhas.push('A CONVERSA ATE AGORA:');
  if (ctx.conversa.length === 0) {
    linhas.push('  (nada foi trocado ainda)');
  } else {
    // `linha` e nao `l`: o `l` de cima e o lead, e sombrear ali daria um
    // texto que compila e mente.
    for (const linha of ctx.conversa) {
      const quem = linha.direcao === 'ENVIADA' ? 'NOS' : 'LEAD';
      const extra =
        linha.direcao === 'ENVIADA'
          ? ` [${linha.status}]`
          : linha.categoriaDoMotor
            ? ` [dicionario: ${linha.categoriaDoMotor}]`
            : '';
      linhas.push(`  ${quem}: "${encurtar(linha.texto, 300)}"${extra}`);
    }
  }
  linhas.push('');

  linhas.push('RESPOSTAS DO LEAD:');
  const recentes = ctx.respostas.slice(-MAX_RESPOSTAS);
  if (recentes.length === 0) {
    linhas.push('  (o lead ainda nao respondeu nada)');
  } else {
    for (const r of recentes) {
      linhas.push(
        `  [${r.recebidaEm}] "${encurtar(r.texto, 300)}"` +
          ` (o motor de dicionario classificou como ${r.categoriaDoMotor},` +
          ` confianca ${r.confiancaDoMotor})`
      );
    }
  }
  linhas.push('');

  if (ctx.regras.length > 0) {
    linhas.push('REGRAS CONFIGURADAS PARA A ETAPA ATUAL:');
    for (const r of ctx.regras) {
      linhas.push(`  - resposta ${r.categoria} -> ${r.acao}`);
    }
  } else {
    linhas.push(
      'REGRAS CONFIGURADAS PARA A ETAPA ATUAL: nenhuma. ' +
        'Sem regra, o padrao seguro e chamar um humano.'
    );
  }
  linhas.push('');

  linhas.push('RELOGIO:');
  linhas.push(`  agora: ${ctx.relogio.agora}`);
  linhas.push(
    `  segundos desde o ultimo envio: ${
      ctx.relogio.segundosDesdeUltimoEnvio ?? '(nada foi enviado ainda)'
    }`
  );
  linhas.push('');

  // Calculado por aritmetica sobre o banco. Entregar pronto evita que o
  // modelo tente deduzir — e errar — qual e a proxima etapa.
  const esperada = proximaEtapaEsperada(ctx);
  linhas.push(
    `PROXIMA ETAPA SEM ENVIO: ${
      esperada === null ? 'nenhuma — a sequencia acabou' : esperada
    }`
  );
  linhas.push('');

  linhas.push(`intent deve ser um de: ${INTENT_IA.join(', ')}`);
  linhas.push(`action deve ser um de: ${ACAO_IA.join(', ')}`);
  linhas.push('');
  linhas.push('Qual e a proxima acao?');

  return linhas.join('\n');
}
