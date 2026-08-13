/**
 * Mapeamento flexivel de colunas.
 *
 * O Instant Data Scraper nomeia as colunas conforme o que encontra no
 * DOM do Google Maps — os nomes mudam entre idioma da interface, versao
 * da extensao e tipo de busca. Nunca assumir um cabecalho fixo.
 *
 * A estrategia: cada campo do lead tem uma lista de aliases conhecidos,
 * comparados de forma tolerante (sem acento, sem pontuacao, minusculo).
 * O que nao casar fica sem mapeamento e o usuario ajusta na tela de
 * preview — o mapeamento automatico e uma conveniencia, nao uma aposta.
 */

/** Campos do lead que podem ser preenchidos por uma coluna. */
export const CAMPOS_MAPEAVEIS = [
  'nome',
  // A UNICA origem valida de nome de PESSOA. O sistema nunca deduz um
  // nome de pessoa a partir de `nome` (o estabelecimento) — ver
  // `packages/domain/src/campaign/nome-abordagem.ts`.
  'responsavel',
  'categoria',
  'telefone',
  'email',
  'endereco',
  'bairro',
  'cidade',
  'estado',
  'cep',
  'website',
  'instagram',
  'facebook',
  'avaliacao',
  'totalAvaliacoes',
  'fonteUrl',
] as const;

export type CampoMapeavel = (typeof CAMPOS_MAPEAVEIS)[number];

/** Rotulos em portugues para a tela de mapeamento. */
export const ROTULO_CAMPO: Record<CampoMapeavel, string> = {
  nome: 'Nome',
  responsavel: 'Responsável / Proprietário',
  categoria: 'Categoria / Nicho',
  telefone: 'Telefone',
  email: 'E-mail',
  endereco: 'Endereço',
  bairro: 'Bairro',
  cidade: 'Cidade',
  estado: 'Estado',
  cep: 'CEP',
  website: 'Website',
  instagram: 'Instagram',
  facebook: 'Facebook',
  avaliacao: 'Avaliação',
  totalAvaliacoes: 'Nº de avaliações',
  fonteUrl: 'URL da fonte',
};

/**
 * Aliases conhecidos por campo, em ordem de confianca (mais especifico
 * primeiro). A comparacao e feita sobre o cabecalho normalizado.
 */
const ALIASES: Record<CampoMapeavel, string[]> = {
  nome: [
    'nome', 'name', 'title', 'titulo', 'nome da empresa', 'empresa',
    'business name', 'nome do negocio', 'estabelecimento', 'razao social',
    'nome fantasia', 'company', 'business', 'local',
  ],
  // Cabecalhos que declaram explicitamente uma PESSOA. Repare que
  // "contato" NAO esta aqui: ele aparece em `telefone` e costuma trazer
  // um numero, nao um nome. Na duvida, o campo fica sem mapeamento e
  // voce escolhe na tela — melhor do que saudar alguem pelo nome errado.
  responsavel: [
    'responsavel', 'proprietario', 'dono', 'dona', 'nome do responsavel',
    'nome do proprietario', 'nome do dono', 'titular', 'gestor',
    'owner', 'nome do contato', 'pessoa de contato', 'falar com',
    'nome contato', 'representante', 'socio', 'gerente',
  ],
  categoria: [
    'categoria', 'category', 'nicho', 'tipo', 'type', 'segmento',
    'ramo', 'atividade', 'categoria principal', 'primary category',
  ],
  telefone: [
    'telefone', 'phone', 'tel', 'celular', 'whatsapp', 'contato',
    'telefone comercial', 'phone number', 'numero', 'fone',
    'telefone 1', 'mobile',
  ],
  email: ['email', 'e mail', 'correio eletronico', 'mail'],
  endereco: [
    'endereco', 'address', 'localizacao', 'location', 'logradouro',
    'endereco completo', 'full address', 'rua', 'street address',
  ],
  bairro: ['bairro', 'neighborhood', 'neighbourhood', 'distrito', 'district'],
  cidade: ['cidade', 'city', 'municipio', 'town', 'localidade'],
  estado: ['estado', 'state', 'uf', 'provincia', 'region'],
  cep: ['cep', 'zip', 'zipcode', 'zip code', 'postal code', 'codigo postal'],
  website: [
    'website', 'site', 'url', 'web site', 'pagina', 'homepage',
    'website url', 'link', 'web', 'site url', 'endereco web',
  ],
  instagram: ['instagram', 'insta', 'ig', 'perfil instagram'],
  facebook: ['facebook', 'fb', 'perfil facebook', 'pagina facebook'],
  avaliacao: [
    'avaliacao', 'rating', 'nota', 'estrelas', 'stars', 'score',
    'avaliacao media', 'average rating', 'review rating',
  ],
  totalAvaliacoes: [
    'numero de avaliacoes', 'num de avaliacoes', 'qtd avaliacoes',
    'quantidade de avaliacoes', 'total de avaliacoes', 'reviews',
    'review count', 'reviews count', 'numero de comentarios',
    'total avaliacoes', 'n avaliacoes', 'avaliacoes',
  ],
  fonteUrl: [
    'url da fonte', 'source url', 'google maps url', 'maps url',
    'link do google', 'href', 'link maps', 'google url', 'profile url',
  ],
};

/** Normaliza um cabecalho para comparacao tolerante. */
export function normalizarCabecalho(cabecalho: string): string {
  return cabecalho
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SugestaoMapeamento {
  /** Cabecalho como aparece no arquivo. */
  coluna: string;
  campo: CampoMapeavel | null;
  /** 'exato' | 'parcial' | null */
  confianca: 'exato' | 'parcial' | null;
}

/**
 * Sugere um mapeamento coluna -> campo.
 *
 * Duas passadas de proposito: primeiro todos os casamentos exatos,
 * depois os parciais. Sem isso, uma coluna "Avaliações" processada
 * antes de "Número de avaliações" poderia roubar o campo errado.
 *
 * Um campo nunca recebe duas colunas — a primeira vence.
 */
export function sugerirMapeamento(cabecalhos: string[]): SugestaoMapeamento[] {
  const resultado: SugestaoMapeamento[] = cabecalhos.map((coluna) => ({
    coluna,
    campo: null,
    confianca: null,
  }));

  const camposUsados = new Set<CampoMapeavel>();
  const normalizados = cabecalhos.map(normalizarCabecalho);

  // --- Passada 1: casamento exato ---
  for (let i = 0; i < cabecalhos.length; i++) {
    const norm = normalizados[i]!;
    if (norm === '') continue;

    for (const campo of CAMPOS_MAPEAVEIS) {
      if (camposUsados.has(campo)) continue;
      if (ALIASES[campo].includes(norm)) {
        resultado[i]!.campo = campo;
        resultado[i]!.confianca = 'exato';
        camposUsados.add(campo);
        break;
      }
    }
  }

  // --- Passada 2: casamento parcial ---
  for (let i = 0; i < cabecalhos.length; i++) {
    if (resultado[i]!.campo !== null) continue;
    const norm = normalizados[i]!;
    if (norm === '') continue;

    let melhor: { campo: CampoMapeavel; tamanho: number } | null = null;

    for (const campo of CAMPOS_MAPEAVEIS) {
      if (camposUsados.has(campo)) continue;
      for (const alias of ALIASES[campo]) {
        // Exige que o alias apareca como sequencia de palavras inteiras,
        // para "site" nao casar com "website visitors".
        const padrao = new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
        if (padrao.test(norm)) {
          // Alias mais longo = mais especifico = melhor.
          if (melhor === null || alias.length > melhor.tamanho) {
            melhor = { campo, tamanho: alias.length };
          }
        }
      }
    }

    if (melhor) {
      resultado[i]!.campo = melhor.campo;
      resultado[i]!.confianca = 'parcial';
      camposUsados.add(melhor.campo);
    }
  }

  return resultado;
}

export type Mapeamento = Partial<Record<CampoMapeavel, string>>;

/** Converte as sugestoes em `{ campo: nomeDaColuna }`. */
export function sugestoesParaMapeamento(sugestoes: SugestaoMapeamento[]): Mapeamento {
  const mapa: Mapeamento = {};
  for (const s of sugestoes) {
    if (s.campo && !mapa[s.campo]) mapa[s.campo] = s.coluna;
  }
  return mapa;
}

/**
 * Aplica o mapeamento a uma linha crua.
 * Colunas ausentes viram `null` — nunca string vazia, nunca placeholder.
 */
export function aplicarMapeamento(
  linha: Record<string, unknown>,
  mapeamento: Mapeamento
): Record<CampoMapeavel, string | null> {
  const saida = {} as Record<CampoMapeavel, string | null>;

  for (const campo of CAMPOS_MAPEAVEIS) {
    const coluna = mapeamento[campo];
    if (!coluna) {
      saida[campo] = null;
      continue;
    }
    const valor = linha[coluna];
    if (valor == null) {
      saida[campo] = null;
      continue;
    }
    const texto = String(valor).trim();
    saida[campo] = texto === '' ? null : texto;
  }

  return saida;
}
