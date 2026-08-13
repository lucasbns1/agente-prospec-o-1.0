/**
 * Motor de classificacao de respostas.
 *
 * DETERMINISTICO. Sem IA, sem modelo, sem rede. A mesma entrada com o
 * mesmo dicionario produz sempre a mesma saida.
 *
 * O dicionario NAO vive aqui — vem da tabela `response_keywords`. Este
 * arquivo so define COMO os termos sao aplicados.
 *
 * ============================================================
 * A REGRA DE OURO (requisito 52)
 * ============================================================
 * Na duvida entre responder e nao responder, NAO RESPONDER vence.
 * Toda ambiguidade termina em DESCONHECIDO + intervencao humana.
 * Um lead esperando resposta e um problema; uma resposta errada
 * enviada automaticamente e um problema pior e irreversivel.
 */
import type { RespostaCategoria, MatchTipo } from '@prospector/shared';
import {
  normalizarResposta,
  MARCA_FRONTEIRA,
  type RespostaNormalizada,
} from './normalizar-resposta.js';
import { EMOJI_POSITIVO, EMOJI_NEGATIVO } from './normalizar-resposta.js';

/** Um termo do dicionario, ja normalizado. */
export interface TermoRegra {
  id: string;
  categoria: RespostaCategoria;
  termo: string;
  matchTipo: MatchTipo;
  peso: number;
  ativo: boolean;
  subtipo?: string | null;
  /** null = global; preenchido = so vale naquela etapa. */
  campaignStepId?: string | null;
}

export interface TermoCasado {
  termoId: string;
  termo: string;
  categoria: RespostaCategoria;
  matchTipo: MatchTipo;
  peso: number;
  subtipo: string | null;
  /** Posicao no texto canonico, para depuracao. */
  posicao: number;
  /** true quando o termo esta sob escopo de negacao. */
  negado: boolean;
}

/** Sinais auxiliares: registrados, mas NAO decidem a categoria sozinhos. */
export interface SinaisAuxiliares {
  pedidoHumano: boolean;
  pedidoAudio: boolean;
  pedidoSite: boolean;
  pedidoInstagram: boolean;
  pedidoPortfolio: boolean;
  pedidoLocalizacao: boolean;
  pedidoHorario: boolean;
  pedidoPrazo: boolean;
  mencionaConcorrente: boolean;
  suspeitaGolpe: boolean;
  reclamacao: boolean;
  objecao: boolean;
  contemUrl: boolean;
  telefonesMencionados: string[];
  emojis: string[];
}

export interface ResultadoClassificacao {
  /** A categoria vencedora, apos a precedencia. */
  categoria: RespostaCategoria;
  /** TODAS as categorias detectadas. Nunca descartadas (requisito 36). */
  categoriasDetectadas: RespostaCategoria[];
  /** Subtipo do termo de maior peso na categoria vencedora. */
  subtipo: string | null;
  termosCasados: TermoCasado[];
  textoNormalizado: string;
  textoCanonico: string;
  /** true quando nada casou com seguranca. */
  desconhecido: boolean;
  /** Por que esta categoria venceu — vai para o log e para o CRM. */
  motivo: string;
  sinais: SinaisAuxiliares;
  /** 0 a 100. Abaixo do minimo, vira DESCONHECIDO. */
  confianca: number;
}

export interface OpcoesClassificacao {
  termos: TermoRegra[];
  /** Ordem vinda de `settings['regras.precedencia']`. */
  precedencia: RespostaCategoria[];
  /** Etapa atual: termos dessa etapa vencem os globais. */
  campaignStepId?: string | null;
  /** Confianca minima para nao cair em DESCONHECIDO. Padrao 30. */
  confiancaMinima?: number;
}

export const PRECEDENCIA_PADRAO: RespostaCategoria[] = [
  'OPT_OUT',
  'NEGATIVO',
  'FALAR_DEPOIS',
  'PRECO',
  'DUVIDA',
  'POSITIVO',
  'INTERESSE',
  'DESCONHECIDO',
];

// -----------------------------------------------------------------------------
// NEGACAO
// -----------------------------------------------------------------------------

/**
 * Marcadores de negacao. O escopo vai do marcador ate a proxima
 * conjuncao adversativa ou o fim da frase.
 *
 * POR QUE ISSO IMPORTA: sem tratar negacao, "nao tenho interesse"
 * casaria com o termo "interesse" e o lead viraria INTERESSE — o
 * oposto exato do que ele disse.
 */
const MARCADORES_NEGACAO = new Set([
  'nao', 'nunca', 'jamais', 'nem', 'sem', 'tampouco',
]);

/**
 * Encerram o escopo da negacao: conjuncoes adversativas e a marca de
 * fronteira de oracao (virgula, ponto).
 */
const FIM_DE_ESCOPO = new Set([
  'mas', 'porem', 'contudo', 'todavia', 'entretanto', 'so', 'apenas',
  MARCA_FRONTEIRA,
]);

/**
 * Alcance maximo da negacao, em tokens.
 *
 * Mesmo sem virgula nem conjuncao, uma negacao nao se estende
 * indefinidamente: em "nao tenho interesse me chama amanha", o "nao"
 * nao nega o "me chama amanha". Quatro tokens cobrem as construcoes
 * negativas usuais do portugues ("nao tenho interesse nenhum") sem
 * atravessar a frase inteira.
 */
const ALCANCE_NEGACAO = 4;

/**
 * Devolve, para cada token, se ele esta sob negacao.
 *
 * Exemplo: "nao quero agora mas pode me chamar depois"
 *          [T,  T,     T,    F,  F,   F,  F,     F]
 */
export function mapearNegacao(tokens: string[]): boolean[] {
  const mapa: boolean[] = new Array(tokens.length).fill(false);
  let restante = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;

    if (FIM_DE_ESCOPO.has(t)) {
      restante = 0;
      continue;
    }
    if (MARCADORES_NEGACAO.has(t)) {
      restante = ALCANCE_NEGACAO;
      mapa[i] = true;
      continue;
    }
    if (restante > 0) {
      mapa[i] = true;
      restante--;
    }
  }

  return mapa;
}

// -----------------------------------------------------------------------------
// MATCHING
// -----------------------------------------------------------------------------

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Testa um termo contra o texto canonico.
 * Devolve a posicao do casamento, ou -1.
 *
 * CONTEM e PALAVRA respeitam limites de palavra de proposito: sem isso,
 * o termo "nao" casaria dentro de "naoticia" e o termo "sim" dentro de
 * "simples" — falsos positivos classicos deste tipo de motor.
 */
export function testarTermo(
  canonico: string,
  termo: string,
  matchTipo: MatchTipo
): number {
  if (termo === '') return -1;

  switch (matchTipo) {
    case 'EXATO':
      return canonico === termo ? 0 : -1;

    case 'INICIA_COM':
      return canonico.startsWith(termo) ? 0 : -1;

    case 'PALAVRA':
    case 'CONTEM': {
      // Ambos exigem fronteira de palavra. A diferenca e semantica
      // (PALAVRA = termo de 1 palavra), nao de implementacao.
      const re = new RegExp(`(?:^|\\s)${escaparRegex(termo)}(?:\\s|$)`);
      const m = re.exec(canonico);
      return m ? m.index : -1;
    }

    case 'REGEX':
      try {
        const m = new RegExp(termo).exec(canonico);
        return m ? m.index : -1;
      } catch {
        // Regex invalida cadastrada no painel nao pode derrubar o motor.
        return -1;
      }

    default:
      return -1;
  }
}

/** Em qual token comeca uma posicao de caractere. */
function tokenDaPosicao(canonico: string, posicao: number): number {
  if (posicao <= 0) return 0;
  return canonico.slice(0, posicao).split(' ').filter((t) => t !== '').length;
}

// -----------------------------------------------------------------------------
// SINAIS AUXILIARES
// -----------------------------------------------------------------------------

const PADROES_AUXILIARES: Array<[keyof SinaisAuxiliares, string[]]> = [
  ['pedidoHumano', [
    'falar com alguem', 'falar com uma pessoa', 'tem alguem ai',
    'falar com vendedor', 'falar com atendente', 'falar com responsavel',
    'falar com o dono', 'falar com proprietario', 'falar com gerente',
    'me passa para alguem', 'me liga', 'pode me ligar', 'quero ligacao',
    'prefiro ligacao', 'me chama no telefone',
  ]],
  ['pedidoAudio', [
    'manda audio', 'me manda audio', 'pode mandar audio', 'explica por audio',
    'fala por audio', 'prefiro audio', 'manda em audio', 'audio',
  ]],
  ['pedidoSite', [
    'manda seu site', 'qual site', 'tem site', 'site de voces',
    'me passa o site', 'manda o link', 'tem link',
    'qual o endereco do site', 'qual o site',
  ]],
  ['pedidoInstagram', [
    'qual instagram', 'manda instagram', 'tem instagram',
    'instagram de voces', 'perfil do instagram', 'qual o instagram',
    'me passa o arroba', 'qual arroba',
  ]],
  ['pedidoPortfolio', [
    'tem portfolio', 'manda portfolio', 'me mostra trabalhos',
    'tem exemplos', 'quero ver exemplos', 'tem fotos', 'me mostra fotos',
    'quero ver trabalhos', 'tem case', 'ver seus trabalhos',
  ]],
  ['pedidoLocalizacao', [
    'onde voces ficam', 'onde fica', 'qual endereco', 'voces atendem onde',
    'atende minha cidade', 'atendem na minha cidade', 'atende aqui',
    'atende perto', 'qual regiao', 'qual cidade', 'voces sao de onde',
    'onde ficam', 'fica onde', 'atende minha regiao', 'atendem em',
  ]],
  ['pedidoHorario', [
    'qual horario', 'que horas', 'quando posso falar', 'atendem sabado',
    'atende domingo', 'atende a noite', 'atende de manha',
    'qual horario de atendimento',
  ]],
  ['pedidoPrazo', [
    'quando comeca', 'quando pode comecar', 'quando voces conseguem',
    'qual prazo', 'quanto tempo', 'quanto demora', 'demora quanto',
    'qual o prazo', 'em quanto tempo',
  ]],
  ['mencionaConcorrente', [
    'ja estou vendo com outra empresa', 'ja falei com outra',
    'estou cotando com outros', 'estou comparando', 'ja tenho orcamento',
    'recebi orcamento', 'estou pesquisando', 'estou vendo precos',
    'estou comparando precos', 'ja tenho fornecedor', 'ja tenho empresa',
  ]],
  ['suspeitaGolpe', [
    'isso e golpe', 'e golpe', 'voces sao quem', 'como conseguiram meu numero',
    'de onde pegaram meu contato', 'quem passou meu numero', 'isso e spam',
    'por que voces tem meu numero', 'como conseguiu meu numero',
    'quem e voce', 'de onde voce conseguiu',
  ]],
  ['reclamacao', [
    'ja falei que nao', 'voces nao param', 'ja pedi para parar',
    'que insistencia', 'quantas vezes vou ter que falar',
    'nao aguento mais mensagem', 'voces continuam mandando',
    'parem de me chamar', 'ja disse que nao', 'para de insistir',
  ]],
  ['objecao', [
    'esta caro', 'muito caro', 'achei caro', 'nao cabe no orcamento',
    'sem orcamento', 'nao tenho orcamento', 'nao posso gastar',
    'nao posso pagar', 'nao tenho dinheiro', 'nao posso investir',
    'nao e prioridade', 'nao tenho tempo', 'nao tenho equipe',
    'nao tenho estrutura', 'nao sei se preciso', 'nao sei se funciona',
    'tenho que pensar', 'preciso pensar', 'vou pensar',
    'preciso falar com meu socio', 'preciso falar com meu marido',
    'preciso falar com minha esposa', 'preciso falar com meu chefe',
    'preciso consultar meu gerente',
  ]],
];

function detectarSinais(r: RespostaNormalizada): SinaisAuxiliares {
  const sinais: SinaisAuxiliares = {
    pedidoHumano: false, pedidoAudio: false, pedidoSite: false,
    pedidoInstagram: false, pedidoPortfolio: false, pedidoLocalizacao: false,
    pedidoHorario: false, pedidoPrazo: false, mencionaConcorrente: false,
    suspeitaGolpe: false, reclamacao: false, objecao: false,
    contemUrl: r.contemUrl,
    telefonesMencionados: r.telefonesMencionados,
    emojis: r.emojis,
  };

  for (const [chave, padroes] of PADROES_AUXILIARES) {
    for (const p of padroes) {
      if (testarTermo(r.canonico, p, 'CONTEM') >= 0) {
        (sinais[chave] as boolean) = true;
        break;
      }
    }
  }

  return sinais;
}

// -----------------------------------------------------------------------------
// CLASSIFICACAO
// -----------------------------------------------------------------------------

const DESCONHECIDO = (
  r: RespostaNormalizada,
  motivo: string,
  sinais: SinaisAuxiliares,
  detectadas: RespostaCategoria[] = [],
  termos: TermoCasado[] = []
): ResultadoClassificacao => ({
  categoria: 'DESCONHECIDO',
  categoriasDetectadas: detectadas,
  subtipo: null,
  termosCasados: termos,
  textoNormalizado: r.normalizado,
  textoCanonico: r.canonico,
  desconhecido: true,
  motivo,
  sinais,
  confianca: 0,
});

export function classificarResposta(
  texto: string | null | undefined,
  opcoes: OpcoesClassificacao
): ResultadoClassificacao {
  const r = normalizarResposta(texto);
  const sinais = detectarSinais(r);
  const confiancaMinima = opcoes.confiancaMinima ?? 30;

  // --- Mensagem sem conteudo utilizavel ---
  if (r.vazio) {
    return DESCONHECIDO(r, 'Mensagem vazia ou sem texto', sinais);
  }

  // --- Emoji isolado ---
  // Requisito 25/26: emoji sozinho NAO vira POSITIVO automaticamente.
  if (r.somenteEmoji) {
    const positivo = r.emojis.some((e) => EMOJI_POSITIVO.includes(e));
    const negativo = r.emojis.some((e) => EMOJI_NEGATIVO.includes(e));

    if (negativo && !positivo) {
      return {
        categoria: 'NEGATIVO',
        categoriasDetectadas: ['NEGATIVO'],
        subtipo: 'emoji_negativo',
        termosCasados: [],
        textoNormalizado: r.normalizado,
        textoCanonico: r.canonico,
        desconhecido: false,
        motivo: `Emoji de recusa isolado (${r.emojis.join(' ')})`,
        sinais,
        confianca: 55,
      };
    }
    if (positivo && !negativo) {
      return {
        categoria: 'POSITIVO',
        categoriasDetectadas: ['POSITIVO'],
        subtipo: 'emoji_positivo',
        termosCasados: [],
        textoNormalizado: r.normalizado,
        textoCanonico: r.canonico,
        desconhecido: false,
        motivo: `Emoji de confirmacao isolado (${r.emojis.join(' ')})`,
        sinais,
        confianca: 50,
      };
    }
    // 😂 ❤️ 🙏 🔥 e companhia: ambiguos demais para agir.
    return DESCONHECIDO(
      r,
      `Emoji ambiguo isolado (${r.emojis.join(' ')}) — nao da para inferir intencao`,
      sinais
    );
  }

  // --- So risada ---
  if (r.somenteRisada) {
    return DESCONHECIDO(r, 'Apenas risada — sem intencao identificavel', sinais);
  }

  // --- Casamento dos termos ---
  //
  // O mapa de negacao roda sobre `tokens`, que inclui as marcas de
  // fronteira. As posicoes dos termos, porem, sao calculadas sobre
  // `canonico`, que nao as tem. Projetamos um no outro para os indices
  // baterem — sem isso a negacao seria aplicada ao token errado.
  const negacaoComMarcas = mapearNegacao(r.tokens);
  const negacao = r.tokens
    .map((t, i) => ({ t, neg: negacaoComMarcas[i]! }))
    .filter(({ t }) => t !== MARCA_FRONTEIRA)
    .map(({ neg }) => neg);
  const aplicaveis = opcoes.termos.filter(
    (t) =>
      t.ativo &&
      (t.campaignStepId == null || t.campaignStepId === opcoes.campaignStepId)
  );

  const casados: TermoCasado[] = [];

  for (const t of aplicaveis) {
    const pos = testarTermo(r.canonico, t.termo, t.matchTipo);
    if (pos < 0) continue;

    const idxToken = tokenDaPosicao(r.canonico, pos);
    // Um termo que JA CONTEM a negacao ("nao quero", "sem interesse",
    // "nem") nao pode ser marcado como negado: a negacao e parte do
    // proprio termo, nao algo aplicado sobre ele. Sem esta excecao,
    // "sem interesse" seria descartado e a recusa passaria batida.
    const primeiraPalavra = t.termo.split(' ')[0] ?? '';
    const termoJaNega = MARCADORES_NEGACAO.has(primeiraPalavra);
    const negado = !termoJaNega && (negacao[idxToken] ?? false);

    casados.push({
      termoId: t.id,
      termo: t.termo,
      categoria: t.categoria,
      matchTipo: t.matchTipo,
      peso: t.peso,
      subtipo: t.subtipo ?? null,
      posicao: pos,
      negado,
    });
  }

  // Termos negados nao contam para a categoria — mas ficam registrados.
  const validos = casados.filter((c) => !c.negado);

  if (validos.length === 0) {
    const motivo =
      casados.length > 0
        ? 'Todos os termos encontrados estavam sob negacao'
        : 'Nenhum termo do dicionario casou com a resposta';
    return DESCONHECIDO(r, motivo, sinais, [], casados);
  }

  // --- Agrupa por categoria ---
  const porCategoria = new Map<RespostaCategoria, TermoCasado[]>();
  for (const c of validos) {
    const lista = porCategoria.get(c.categoria) ?? [];
    lista.push(c);
    porCategoria.set(c.categoria, lista);
  }

  const detectadas = [...porCategoria.keys()];

  // --- Escopo de etapa vence o global ---
  // Se algum termo especifico da etapa casou, so as categorias dele
  // participam da decisao.
  const idsDaEtapa = new Set(
    aplicaveis.filter((t) => t.campaignStepId != null).map((t) => t.id)
  );
  const temEspecifico = validos.some((c) => idsDaEtapa.has(c.termoId));
  const candidatas = temEspecifico
    ? [...new Set(validos.filter((c) => idsDaEtapa.has(c.termoId)).map((c) => c.categoria))]
    : detectadas;

  // --- Precedencia decide ---
  const ordem = opcoes.precedencia.length > 0 ? opcoes.precedencia : PRECEDENCIA_PADRAO;
  let vencedora: RespostaCategoria | null = null;
  for (const cat of ordem) {
    if (cat === 'DESCONHECIDO') continue;
    if (candidatas.includes(cat)) {
      vencedora = cat;
      break;
    }
  }

  // --- Excecao contextual: recusa AGORA + retomada DEPOIS ---
  //
  // Requisito 27. "nao quero agora, mas pode me chamar depois" tem
  // NEGATIVO e FALAR_DEPOIS. A precedencia crua escolheria NEGATIVO e
  // encerraria a sequencia — mas o lead disse explicitamente que quer
  // ser procurado de novo. Encerrar seria perder o lead por ler a
  // frase pela metade.
  //
  // A excecao e estreita de proposito:
  //   - so vale entre NEGATIVO e FALAR_DEPOIS;
  //   - exige que a retomada venha DEPOIS da recusa no texto;
  //   - NUNCA se aplica a OPT_OUT, que permanece inviolavel.
  let excecaoRetomada = false;
  if (
    vencedora === 'NEGATIVO' &&
    candidatas.includes('FALAR_DEPOIS') &&
    !candidatas.includes('OPT_OUT')
  ) {
    const posNegativo = Math.min(
      ...validos.filter((c) => c.categoria === 'NEGATIVO').map((c) => c.posicao)
    );
    const posDepois = Math.max(
      ...validos.filter((c) => c.categoria === 'FALAR_DEPOIS').map((c) => c.posicao)
    );
    if (posDepois > posNegativo) {
      vencedora = 'FALAR_DEPOIS';
      excecaoRetomada = true;
    }
  }

  // Categoria detectada que nao esta na lista de precedencia: cai no
  // primeiro candidato, mas com confianca reduzida.
  if (vencedora === null) vencedora = candidatas[0] ?? 'DESCONHECIDO';

  const termosDaVencedora = porCategoria.get(vencedora) ?? [];
  const maisForte = termosDaVencedora.reduce(
    (a, b) => (b.peso > a.peso ? b : a),
    termosDaVencedora[0]!
  );

  // --- Confianca ---
  // Comeca no peso do termo mais forte e e ajustada por contexto.
  let confianca = Math.min(100, Math.max(maisForte.peso, 10));

  // Varias categorias em disputa = mais chance de leitura errada.
  if (candidatas.length >= 3) confianca -= 10;

  // Texto longo com um unico termo fraco: o termo pode ser incidental.
  if (r.totalPalavras > 25 && maisForte.peso < 50) confianca -= 15;

  // Sinais que pedem cuidado humano derrubam a confianca de proposito.
  if (sinais.suspeitaGolpe) confianca -= 40;
  if (sinais.pedidoHumano) confianca -= 20;

  if (confianca < confiancaMinima) {
    return DESCONHECIDO(
      r,
      `Confianca ${confianca} abaixo do minimo ${confiancaMinima} — melhor um humano olhar`,
      sinais,
      detectadas,
      casados
    );
  }

  const outras = detectadas.filter((c) => c !== vencedora);
  let motivo: string;
  if (excecaoRetomada) {
    motivo =
      `Recusa seguida de pedido de retomada: "${maisForte.termo}" -> FALAR_DEPOIS ` +
      `em vez de NEGATIVO; tambem detectado: ${outras.join(', ')}`;
  } else if (outras.length > 0) {
    motivo =
      `"${maisForte.termo}" -> ${vencedora}; tambem detectado: ${outras.join(', ')}; ` +
      `precedencia escolheu ${vencedora}`;
  } else {
    motivo = `"${maisForte.termo}" -> ${vencedora}`;
  }

  return {
    categoria: vencedora,
    categoriasDetectadas: detectadas,
    subtipo: maisForte.subtipo,
    termosCasados: casados,
    textoNormalizado: r.normalizado,
    textoCanonico: r.canonico,
    desconhecido: false,
    motivo,
    sinais,
    confianca,
  };
}
