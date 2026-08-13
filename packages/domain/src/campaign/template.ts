/**
 * Renderizacao de mensagem personalizada (Fase E).
 *
 * Cada lead recebe SUA mensagem, montada com OS DADOS DELE. Nunca uma
 * copia com dados de outro.
 *
 * ============================================================
 * A REGRA CENTRAL: NUNCA INVENTAR
 * ============================================================
 * Se o nome da pessoa nao existe, o sistema NAO chuta um. Ele usa uma
 * saudacao sem nome. "Olá, [Nome]!" ou "Olá, Clínica!" seriam piores do
 * que "Olá!" — a primeira parece robo quebrado, a segunda parece que
 * voce nao sabe com quem esta falando.
 *
 * Variaveis OBRIGATORIAS ausentes bloqueiam o envio. Variaveis
 * OPCIONAIS ausentes ativam um fallback textual que reescreve o trecho.
 */

/** Variaveis aceitas nos templates de campanha. */
export const VARIAVEIS_CAMPANHA = [
  'nome',
  'primeiro_nome',
  'empresa',
  // Nomes explicitos, para o template dizer o que quer sem ambiguidade.
  // `nome_abordagem` so tem valor quando ha PESSOA declarada — nunca cai
  // para o nome do estabelecimento, senao a saudacao viraria
  // "Oi, Barbearia do Ze!".
  'nome_abordagem',
  'nome_estabelecimento',
  'cidade',
  'bairro',
  'estado',
  'categoria',
  'telefone',
  'avaliacao',
  'totalAvaliacoes',
  'site_preview_url',
] as const;

export type VariavelCampanha = (typeof VARIAVEIS_CAMPANHA)[number];

/**
 * Variaveis que, se referenciadas e ausentes, BLOQUEIAM o envio.
 *
 * `empresa` esta aqui porque uma mensagem que diz "vi a {{empresa}} no
 * Google" sem a empresa nao faz sentido nenhum. Ja `nome` NAO esta:
 * para ele existe fallback (ver `SAUDACAO_SEM_NOME`).
 */
export const VARIAVEIS_OBRIGATORIAS: readonly string[] = [
  'empresa',
  'telefone',
];

export interface ContextoLead {
  nome: string | null;
  primeiro_nome: string | null;
  empresa: string | null;
  /** Nome de PESSOA declarado. `null` quando ninguem declarou. */
  nome_contato: string | null;
  cidade: string | null;
  bairro: string | null;
  estado: string | null;
  categoria: string | null;
  telefone: string | null;
  avaliacao: number | null;
  totalAvaliacoes: number | null;
  site_preview_url: string | null;
}

export interface ResultadoRender {
  /** Texto final. `null` quando `ok === false`. */
  texto: string | null;
  ok: boolean;
  /** Variaveis referenciadas no template e seus valores aplicados. */
  variaveisUsadas: Record<string, string>;
  /** Referenciadas mas vazias, sem fallback disponivel. */
  faltando: string[];
  /** Escritas no template mas que nao existem no sistema. */
  desconhecidas: string[];
  /** Fallbacks aplicados, para voce conferir na previa. */
  fallbacksAplicados: string[];
  /** Preenchido quando ok === false. */
  motivoBloqueio: string | null;
}

const RE_VARIAVEL = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Extrai as variaveis referenciadas, sem renderizar. */
export function extrairVariaveis(template: string): string[] {
  const achadas = new Set<string>();
  for (const m of template.matchAll(RE_VARIAVEL)) {
    if (m[1]) achadas.add(m[1]);
  }
  return [...achadas];
}

/**
 * Trechos de saudacao reescritos quando nao ha nome.
 *
 * A chave e o padrao COM nome; o valor e a versao sem. A substituicao
 * acontece no template ANTES da troca de variaveis, para o texto sair
 * fluido em vez de com um buraco.
 */
const SAUDACAO_SEM_NOME: Array<[RegExp, string]> = [
  [/\bol[aá],?\s*\{\{\s*(primeiro_nome|nome_abordagem|nome)\s*\}\}\s*!/gi, 'Olá!'],
  [/\bol[aá],?\s*\{\{\s*(primeiro_nome|nome_abordagem|nome)\s*\}\}\s*,/gi, 'Olá,'],
  [/\bol[aá],?\s*\{\{\s*(primeiro_nome|nome_abordagem|nome)\s*\}\}/gi, 'Olá'],
  [/\boi,?\s*\{\{\s*(primeiro_nome|nome_abordagem|nome)\s*\}\}\s*!/gi, 'Oi!'],
  [/\boi,?\s*\{\{\s*(primeiro_nome|nome_abordagem|nome)\s*\}\}/gi, 'Oi'],
  [/\bbom dia,?\s*\{\{\s*(primeiro_nome|nome_abordagem|nome)\s*\}\}/gi, 'Bom dia'],
  [/\bboa tarde,?\s*\{\{\s*(primeiro_nome|nome_abordagem|nome)\s*\}\}/gi, 'Boa tarde'],
  [/\bboa noite,?\s*\{\{\s*(primeiro_nome|nome_abordagem|nome)\s*\}\}/gi, 'Boa noite'],
  [/\bfalo com (a|o)\s*\{\{\s*(primeiro_nome|nome_abordagem|nome)\s*\}\}\s*\?/gi, 'falo com o responsável?'],
];

/**
 * Trechos que dependem de cidade e somem quando ela nao existe.
 *
 * As virgulas dos DOIS lados sao consumidas: em "Vi a {{empresa}}, em
 * {{cidade}}, no Google", tirar so o miolo deixaria "Vi a Empresa, no
 * Google" — com uma virgula solta que denuncia o texto montado.
 */
const TRECHO_SEM_CIDADE: Array<[RegExp, string]> = [
  [/,\s*em\s*\{\{\s*cidade\s*\}\}\s*,/gi, ''],
  [/,?\s*em\s*\{\{\s*cidade\s*\}\}/gi, ''],
  [/,\s*de\s*\{\{\s*cidade\s*\}\}\s*,/gi, ''],
  [/\s*de\s*\{\{\s*cidade\s*\}\}/gi, ''],
];

function valorDe(contexto: ContextoLead, variavel: string): string | null {
  switch (variavel) {
    case 'nome':
      // SO o primeiro nome da PESSOA. Nunca cai para o nome da empresa.
      //
      // Sem essa restricao, "Olá, {{nome}}! Vi a {{empresa}}" viraria
      // "Olá, Clínica Bem Viver! Vi a Clínica Bem Viver" — que soa como
      // robo quebrado e repete o nome duas vezes na mesma frase.
      // Quando nao ha pessoa, o fallback de saudacao reescreve o trecho
      // para "Olá!" e a mensagem continua natural.
      return contexto.primeiro_nome;
    case 'primeiro_nome':
      return contexto.primeiro_nome;
    case 'nome_abordagem':
      // Deliberadamente SEM fallback para o estabelecimento. Se cair
      // para ele, "Oi, {{nome_abordagem}}!" vira "Oi, Barbearia do Ze!".
      // Sem pessoa declarada, o fallback de saudacao reescreve a frase.
      return contexto.nome_contato ?? contexto.primeiro_nome;
    case 'nome_estabelecimento':
      return contexto.empresa ?? contexto.nome;
    case 'empresa':
      return contexto.empresa ?? contexto.nome;
    case 'cidade':
      return contexto.cidade;
    case 'bairro':
      return contexto.bairro;
    case 'estado':
      return contexto.estado;
    case 'categoria':
      return contexto.categoria;
    case 'telefone':
      return contexto.telefone;
    case 'avaliacao':
      return contexto.avaliacao === null ? null : String(contexto.avaliacao);
    case 'totalAvaliacoes':
      return contexto.totalAvaliacoes === null ? null : String(contexto.totalAvaliacoes);
    case 'site_preview_url':
      return contexto.site_preview_url;
    default:
      return null;
  }
}

/** Limpa espacos duplos e pontuacao orfa deixados pelos fallbacks. */
function limparTexto(texto: string): string {
  return texto
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?;])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface OpcoesRender {
  /** Tamanho maximo. Padrao 4000 (limite pratico do WhatsApp). */
  tamanhoMaximo?: number;
  /** Variaveis que bloqueiam quando ausentes. */
  obrigatorias?: readonly string[];
}

export function renderizarMensagem(
  template: string,
  contexto: ContextoLead,
  opcoes: OpcoesRender = {}
): ResultadoRender {
  const tamanhoMaximo = opcoes.tamanhoMaximo ?? 4000;
  const obrigatorias = opcoes.obrigatorias ?? VARIAVEIS_OBRIGATORIAS;

  const vazio = (motivo: string): ResultadoRender => ({
    texto: null, ok: false, variaveisUsadas: {}, faltando: [],
    desconhecidas: [], fallbacksAplicados: [], motivoBloqueio: motivo,
  });

  if (!template || template.trim() === '') {
    return vazio('Template vazio');
  }

  const referenciadas = extrairVariaveis(template);

  // --- Variaveis inexistentes no sistema ---
  const desconhecidas = referenciadas.filter(
    (v) => !(VARIAVEIS_CAMPANHA as readonly string[]).includes(v)
  );
  if (desconhecidas.length > 0) {
    return {
      ...vazio(`Variavel desconhecida no template: ${desconhecidas.join(', ')}`),
      desconhecidas,
    };
  }

  // --- Obrigatorias ausentes bloqueiam ---
  const faltandoObrigatorias = referenciadas.filter(
    (v) => obrigatorias.includes(v) && !valorDe(contexto, v)
  );
  if (faltandoObrigatorias.length > 0) {
    return {
      ...vazio(
        `Variavel obrigatoria sem valor: ${faltandoObrigatorias.join(', ')}`
      ),
      faltando: faltandoObrigatorias,
    };
  }

  // --- Fallbacks textuais ---
  let texto = template;
  const fallbacksAplicados: string[] = [];

  // So conta o nome da PESSOA — o mesmo criterio que `valorDe('nome')`.
  // Se olhasse tambem `contexto.nome` (que para lead de empresa carrega a
  // razao social), o fallback nao dispararia e `{{nome}}` deixaria um
  // buraco no texto, bloqueando o envio de todo lead sem pessoa.
  // So conta nome de PESSOA declarado. `empresa` nunca entra aqui: se
  // entrasse, "Oi, {{nome_abordagem}}!" viraria "Oi, Barbearia do Ze!"
  // em vez de "Oi!".
  const temNome = Boolean(contexto.nome_contato ?? contexto.primeiro_nome);
  if (!temNome) {
    for (const [padrao, troca] of SAUDACAO_SEM_NOME) {
      if (padrao.test(texto)) {
        texto = texto.replace(padrao, troca);
        fallbacksAplicados.push('saudacao sem nome');
      }
      padrao.lastIndex = 0;
    }
  }

  if (!contexto.cidade) {
    for (const [padrao, troca] of TRECHO_SEM_CIDADE) {
      if (padrao.test(texto)) {
        texto = texto.replace(padrao, troca);
        fallbacksAplicados.push('trecho de cidade removido');
      }
      padrao.lastIndex = 0;
    }
  }

  // --- Substituicao ---
  const variaveisUsadas: Record<string, string> = {};
  const faltando: string[] = [];

  texto = texto.replace(RE_VARIAVEL, (_m, nomeVar: string) => {
    const valor = valorDe(contexto, nomeVar);
    if (valor === null || valor === '') {
      faltando.push(nomeVar);
      return '';
    }
    variaveisUsadas[nomeVar] = valor;
    return valor;
  });

  // Se sobrou variavel opcional sem valor e sem fallback, o texto ficou
  // com um buraco. Melhor bloquear do que enviar frase truncada.
  const semFallback = [...new Set(faltando)];
  if (semFallback.length > 0) {
    return {
      texto: null, ok: false, variaveisUsadas,
      faltando: semFallback, desconhecidas: [],
      fallbacksAplicados,
      motivoBloqueio: `Variavel sem valor e sem fallback: ${semFallback.join(', ')}`,
    };
  }

  const final = limparTexto(texto);

  if (final === '') {
    return { ...vazio('Mensagem ficou vazia apos a renderizacao'), fallbacksAplicados };
  }
  if (final.length > tamanhoMaximo) {
    return {
      ...vazio(`Mensagem com ${final.length} caracteres, maximo ${tamanhoMaximo}`),
      variaveisUsadas, fallbacksAplicados,
    };
  }

  return {
    texto: final,
    ok: true,
    variaveisUsadas,
    faltando: [],
    desconhecidas: [],
    fallbacksAplicados: [...new Set(fallbacksAplicados)],
    motivoBloqueio: null,
  };
}
