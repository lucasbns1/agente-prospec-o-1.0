/**
 * Normalizacao de texto, nomes e endereco.
 *
 * PRINCIPIO INEGOCIAVEL DESTE ARQUIVO: se nao der para determinar um
 * valor com seguranca, o resultado e `null`. Nunca uma aproximacao,
 * nunca um palpite. Um bairro errado numa mensagem de prospeccao e pior
 * do que nenhum bairro.
 */

/** Colapsa espacos e remove os das pontas. `null` se sobrar vazio. */
export function limparEspacos(texto: string | null | undefined): string | null {
  if (texto == null) return null;
  const limpo = String(texto).replace(/\s+/g, ' ').trim();
  return limpo === '' ? null : limpo;
}

/**
 * Forma canonica para COMPARACAO: minusculo, sem acento, sem pontuacao.
 *
 * Usada na deduplicacao e no motor de regras. NUNCA use o resultado para
 * exibir ou enviar — "jose" nao e o nome da pessoa, "José" e.
 */
export function normalizarParaComparacao(texto: string | null | undefined): string {
  if (texto == null) return '';
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove apenas os acentos, preservando maiusculas e pontuacao. */
export function removerAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Palavras que ficam em minusculo no meio de um nome proprio em
 * portugues. Sem isso, "Clinica De Psicologia" fica com cara de
 * planilha, e o nome vai aparecer dentro de uma mensagem.
 */
const CONECTIVOS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'a', 'o', 'as', 'os', 'para', 'por', 'com',
]);

/**
 * Titulos profissionais e prefixos que NAO sao o nome da pessoa.
 * Usados para extrair o primeiro nome real de "Dra. Maria Silva".
 */
const TITULOS = new Set([
  'dr', 'dra', 'doutor', 'doutora', 'sr', 'sra', 'srta',
  'psicologa', 'psicologo', 'psi', 'dentista', 'advogado', 'advogada',
  'nutricionista', 'fisioterapeuta', 'terapeuta', 'medico', 'medica',
  'prof', 'professor', 'professora', 'coach', 'consultor', 'consultora',
  // Siglas de conselho profissional. Aparecem coladas no nome no Google
  // Maps ("Maria Silva CRP 06/12345") e nao sao o nome de ninguem.
  'crp', 'crm', 'cro', 'oab', 'crn', 'crefito', 'cref', 'coren', 'cra',
]);

/**
 * Marcadores de que o texto e uma EMPRESA, nao uma pessoa.
 * Quando um deles aparece, nao tentamos extrair primeiro nome.
 */
const MARCADORES_EMPRESA = new Set([
  'clinica', 'consultorio', 'instituto', 'centro', 'espaco', 'studio',
  'estudio', 'ltda', 'me', 'eireli', 'sa', 'empresa', 'grupo', 'rede',
  'associacao', 'cooperativa', 'servicos', 'solucoes', 'assessoria',
  'escritorio', 'laboratorio', 'hospital', 'unidade', 'filial',
]);

/**
 * Normaliza um nome para EXIBICAO.
 * Preserva acentos; ajusta apenas a caixa quando o texto vem todo em
 * maiusculas ou todo em minusculas (padrao comum em export de planilha).
 */
export function normalizarNome(bruto: string | null | undefined): string | null {
  const limpo = limparEspacos(bruto);
  if (limpo === null) return null;

  const todoMaiusculo = limpo === limpo.toUpperCase() && /[A-ZÀ-Ú]/.test(limpo);
  const todoMinusculo = limpo === limpo.toLowerCase();

  // Se ja veio com caixa mista, o autor escreveu de proposito. Nao mexer.
  if (!todoMaiusculo && !todoMinusculo) return limpo;

  return limpo
    .split(' ')
    .map((palavra, i) => {
      const semAcento = normalizarParaComparacao(palavra);
      if (i > 0 && CONECTIVOS.has(semAcento)) return palavra.toLowerCase();
      // Siglas curtas ficam como estao (ex: "JR", "MG")
      if (palavra.length <= 3 && todoMaiusculo && !CONECTIVOS.has(semAcento)) {
        return palavra;
      }
      return palavra.charAt(0).toUpperCase() + palavra.slice(1).toLowerCase();
    })
    .join(' ');
}

/** true quando o texto parece nome de empresa, nao de pessoa. */
export function pareceEmpresa(nome: string | null | undefined): boolean {
  const comp = normalizarParaComparacao(nome);
  if (comp === '') return false;
  return comp.split(' ').some((p) => MARCADORES_EMPRESA.has(p));
}

/**
 * Extrai o primeiro nome utilizavel, para {{primeiro_nome}}.
 *
 * Retorna `null` quando:
 *   - o texto parece nome de empresa;
 *   - so ha um titulo sem nome depois ("Dra.");
 *   - o candidato e curto demais para ser um nome.
 *
 * Preferir null a errar: "Boa tarde, falo com a psicologa Clinica?" e
 * pior do que bloquear o envio e pedir revisao.
 */
export function extrairPrimeiroNome(
  nomeCompleto: string | null | undefined
): string | null {
  const limpo = limparEspacos(nomeCompleto);
  if (limpo === null) return null;
  if (pareceEmpresa(limpo)) return null;

  // Corta em separadores comuns: "Maria Silva - Psicologa", "Ana | CRP..."
  const antesDoSeparador = limpo.split(/[-|–—•·,(]/)[0] ?? limpo;

  const palavras = antesDoSeparador
    .split(' ')
    .map((p) => p.replace(/\./g, '')) // "Dra." -> "Dra"
    .filter((p) => p.length > 0);

  for (const palavra of palavras) {
    const comp = normalizarParaComparacao(palavra);
    if (comp === '' || TITULOS.has(comp) || CONECTIVOS.has(comp)) continue;
    if (comp.length < 2) continue;
    // Descarta tokens que nao sao nome (CRP 12345, 2024, @perfil)
    if (/\d/.test(palavra) || palavra.startsWith('@')) continue;
    return normalizarNome(palavra);
  }

  return null;
}

/** Estados brasileiros validos. Qualquer outra coisa vira null. */
const UFS = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
  'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]);

const UF_POR_EXTENSO: Record<string, string> = {
  'sao paulo': 'SP', 'rio de janeiro': 'RJ', 'minas gerais': 'MG',
  'bahia': 'BA', 'parana': 'PR', 'rio grande do sul': 'RS',
  'pernambuco': 'PE', 'ceara': 'CE', 'para': 'PA', 'santa catarina': 'SC',
  'goias': 'GO', 'maranhao': 'MA', 'espirito santo': 'ES',
  'paraiba': 'PB', 'amazonas': 'AM', 'mato grosso': 'MT',
  'mato grosso do sul': 'MS', 'rio grande do norte': 'RN',
  'piaui': 'PI', 'alagoas': 'AL', 'distrito federal': 'DF',
  'sergipe': 'SE', 'rondonia': 'RO', 'tocantins': 'TO',
  'acre': 'AC', 'amapa': 'AP', 'roraima': 'RR',
};

/** Normaliza para a sigla de 2 letras. `null` se nao for um estado. */
export function normalizarEstado(bruto: string | null | undefined): string | null {
  const limpo = limparEspacos(bruto);
  if (limpo === null) return null;

  const upper = removerAcentos(limpo).toUpperCase();
  if (UFS.has(upper)) return upper;

  const porExtenso = UF_POR_EXTENSO[normalizarParaComparacao(limpo)];
  return porExtenso ?? null;
}

/** Nome de cidade normalizado para exibicao. */
export function normalizarCidade(bruto: string | null | undefined): string | null {
  const limpo = limparEspacos(bruto);
  if (limpo === null) return null;
  // Descarta valores que sao claramente outra coisa
  if (/^\d+$/.test(limpo)) return null;
  return normalizarNome(limpo);
}

/** Bairro. Mesma regra da cidade — e null quando nao houver. */
export function normalizarBairro(bruto: string | null | undefined): string | null {
  return normalizarCidade(bruto);
}

/** CEP em 8 digitos, formatado 00000-000. `null` se invalido. */
export function normalizarCep(bruto: string | null | undefined): string | null {
  if (bruto == null) return null;
  const digitos = String(bruto).replace(/\D/g, '');
  if (digitos.length !== 8) return null;
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
}

export interface EnderecoSeparado {
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
}

/**
 * Separa um endereco em partes.
 *
 * O formato do Google Maps costuma ser:
 *   "R. Ferreira Penteado, 123 - Cambui, Campinas - SP, 13010-041"
 *
 * SOBRE O BAIRRO: so e preenchido quando aparece na posicao inequivoca
 * "<numero> - <bairro>, <cidade>". Em qualquer outro formato fica NULL.
 * O export do Google Maps frequentemente omite o bairro, e chutar o
 * penultimo campo produziria "Campinas" como bairro de Campinas.
 */
export function separarEndereco(
  bruto: string | null | undefined
): EnderecoSeparado {
  const vazio: EnderecoSeparado = {
    logradouro: null, numero: null, bairro: null,
    cidade: null, estado: null, cep: null,
  };

  const limpo = limparEspacos(bruto);
  if (limpo === null) return vazio;

  const resultado: EnderecoSeparado = { ...vazio };

  // 1. CEP em qualquer posicao
  const mCep = limpo.match(/(\d{5})-?(\d{3})(?!\d)/);
  if (mCep) resultado.cep = `${mCep[1]}-${mCep[2]}`;

  // 2. Estado no padrao " - SP" ou ", SP"
  const mUf = limpo.match(/[-,]\s*([A-Za-z]{2})(?=\s*[,-]|\s*\d{5}|\s*$)/);
  if (mUf?.[1]) resultado.estado = normalizarEstado(mUf[1]);

  // 3. Quebra por virgulas
  const partes = limpo.split(',').map((p) => p.trim()).filter(Boolean);

  if (partes.length > 0) {
    // Primeiro segmento = logradouro (+ numero, quando presente)
    const primeiro = partes[0]!;
    const mNum = primeiro.match(/^(.*?),?\s*(\d+[A-Za-z]?)\s*$/);
    if (mNum?.[1] && mNum[2]) {
      resultado.logradouro = limparEspacos(mNum[1]);
      resultado.numero = mNum[2];
    } else {
      resultado.logradouro = limparEspacos(primeiro);
    }
  }

  // Numero e bairro no padrao "123 - Cambui" (segundo segmento)
  if (partes.length >= 2) {
    const segundo = partes[1]!;
    const mNumBairro = segundo.match(/^(\d+[A-Za-z]?)\s*-\s*(.+)$/);
    if (mNumBairro?.[1] && mNumBairro[2]) {
      resultado.numero ??= mNumBairro[1];
      resultado.bairro = normalizarBairro(mNumBairro[2]);
    } else if (/^\d+[A-Za-z]?$/.test(segundo)) {
      resultado.numero ??= segundo;
    }
  }

  // Cidade: segmento que contem " - UF"
  for (const parte of partes) {
    const mCidadeUf = parte.match(/^(.+?)\s*-\s*([A-Za-z]{2})\s*$/);
    if (mCidadeUf?.[1] && normalizarEstado(mCidadeUf[2])) {
      resultado.cidade = normalizarCidade(mCidadeUf[1]);
      resultado.estado ??= normalizarEstado(mCidadeUf[2]);
      break;
    }
  }

  return resultado;
}

/** Converte "4,8" ou "4.8" em number. `null` se nao for nota valida (0–5). */
export function normalizarAvaliacao(bruto: unknown): number | null {
  if (bruto == null || bruto === '') return null;
  const texto = String(bruto).trim().replace(',', '.');
  const n = Number.parseFloat(texto);
  if (!Number.isFinite(n) || n < 0 || n > 5) return null;
  return Math.round(n * 10) / 10;
}

/** Converte "1.234 avaliações" ou "(87)" em inteiro. `null` se invalido. */
export function normalizarContagem(bruto: unknown): number | null {
  if (bruto == null || bruto === '') return null;
  const digitos = String(bruto).replace(/\D/g, '');
  if (digitos === '') return null;
  const n = Number.parseInt(digitos, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
