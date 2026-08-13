/**
 * Classificacao de website — determina se o lead TEM SITE PROPRIO.
 *
 * Esta e a regra de negocio mais importante do sistema: e ela que define
 * quem entra na sua lista de prospeccao.
 *
 * NAO USA IA. NAO ACESSA A INTERNET. A decisao sai apenas da URL.
 *
 * A lista de dominios sociais NAO esta neste arquivo. Ela vem da tabela
 * `social_domains` e e passada como parametro. Se voce cadastrar
 * `linktr.ee` no painel amanha, este codigo passa a trata-lo como rede
 * social sem nenhuma alteracao.
 *
 * REGRA DE SEGURANCA: um dominio DESCONHECIDO nunca vira rede social
 * automaticamente. Ele e site proprio. Errar para o lado de "tem site"
 * apenas deixa um lead de fora; errar para o outro lado faria voce
 * abordar alguem que ja tem site dizendo que ele nao tem.
 */

export type WebsiteStatus =
  | 'NAO_INFORMADO'
  | 'REDE_SOCIAL'
  | 'SITE_PROPRIO'
  | 'INVALIDO'
  | 'NAO_VERIFICADO';

/** Um dominio configurado como "nao e site proprio". */
export interface DominioSocial {
  dominio: string;
  incluirSubdominios: boolean;
  ativo: boolean;
}

export interface ResultadoWebsite {
  status: WebsiteStatus;
  /** URL normalizada com protocolo. `null` se nao houver. */
  urlNormalizada: string | null;
  /** Host sem "www.", em minusculo. Ex: "instagram.com" */
  dominio: string | null;
  /** Qual entrada de `social_domains` casou. `null` se nenhuma. */
  dominioSocial: string | null;
  /** true quando o lead entra na lista de prospeccao. */
  semSiteProprio: boolean;
  detalhe: string;
}

/**
 * Valores que aparecem em planilha significando "nao tem".
 * Comparados apos lowercase e trim.
 */
const VALORES_VAZIOS = new Set([
  '', '-', '--', 'n/a', 'na', 'nao', 'não', 'none', 'null', 'undefined',
  'sem site', 'nao possui', 'não possui', 'nenhum', 'x', '#n/a', 'nd',
]);

/** Extrai o host de uma URL, tolerando entradas sem protocolo. */
function extrairDominio(bruto: string): string | null {
  let candidato = bruto.trim();

  // O Instant Data Scraper as vezes exporta em markdown:
  // "[www.site.com.br](https://www.site.com.br)"
  const markdown = candidato.match(/\]\(([^)]+)\)\s*$/);
  if (markdown?.[1]) candidato = markdown[1].trim();

  // Sem protocolo o construtor URL falha. Assumimos https — isso NAO e
  // inventar dado: o protocolo nao participa da decisao, so do parse.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidato)) {
    candidato = `https://${candidato}`;
  }

  try {
    const url = new URL(candidato);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    // Precisa ter ao menos um ponto e um TLD alfabetico
    if (!host.includes('.')) return null;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return null;

    return host;
  } catch {
    return null;
  }
}

/** Reconstroi a URL completa e normalizada. */
function normalizarUrl(bruto: string): string | null {
  let candidato = bruto.trim();
  const markdown = candidato.match(/\]\(([^)]+)\)\s*$/);
  if (markdown?.[1]) candidato = markdown[1].trim();

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidato)) {
    candidato = `https://${candidato}`;
  }
  try {
    const url = new URL(candidato);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Remove barra final redundante
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * true quando `host` e o dominio social, ou um subdominio dele quando a
 * configuracao permitir.
 *
 * O casamento e por LABEL, nao por sufixo de string: "meuinstagram.com"
 * NAO casa com "instagram.com". Um `endsWith` simples classificaria
 * errado o site proprio de alguem.
 */
export function casaDominio(host: string, social: DominioSocial): boolean {
  const alvo = social.dominio.toLowerCase().replace(/^www\./, '');
  const h = host.toLowerCase().replace(/^www\./, '');

  if (h === alvo) return true;
  if (!social.incluirSubdominios) return false;
  return h.endsWith(`.${alvo}`);
}

/**
 * Classifica o website de um lead.
 *
 * @param bruto  valor cru da planilha
 * @param dominiosSociais lista vinda de `social_domains`
 */
export function classificarWebsite(
  bruto: string | null | undefined,
  dominiosSociais: DominioSocial[]
): ResultadoWebsite {
  // --- 1. Ausente ---
  if (bruto == null) {
    return {
      status: 'NAO_INFORMADO',
      urlNormalizada: null, dominio: null, dominioSocial: null,
      semSiteProprio: true,
      detalhe: 'Campo de website ausente',
    };
  }

  const texto = String(bruto).trim();

  if (VALORES_VAZIOS.has(texto.toLowerCase())) {
    return {
      status: 'NAO_INFORMADO',
      urlNormalizada: null, dominio: null, dominioSocial: null,
      semSiteProprio: true,
      detalhe: texto === '' ? 'Campo de website vazio' : `Valor "${texto}" significa sem site`,
    };
  }

  // --- 2. Parse ---
  const dominio = extrairDominio(texto);
  if (dominio === null) {
    return {
      status: 'INVALIDO',
      urlNormalizada: null, dominio: null, dominioSocial: null,
      // Nao conseguimos confirmar um site proprio -> entra na prospeccao.
      semSiteProprio: true,
      detalhe: `Nao foi possivel interpretar "${texto}" como URL`,
    };
  }

  const urlNormalizada = normalizarUrl(texto);

  // --- 3. Rede social? ---
  for (const social of dominiosSociais) {
    if (!social.ativo) continue;
    if (casaDominio(dominio, social)) {
      return {
        status: 'REDE_SOCIAL',
        urlNormalizada,
        dominio,
        dominioSocial: social.dominio,
        semSiteProprio: true,
        detalhe: `${social.dominio} esta configurado como rede social, nao conta como site proprio`,
      };
    }
  }

  // --- 4. Site proprio ---
  return {
    status: 'SITE_PROPRIO',
    urlNormalizada,
    dominio,
    dominioSocial: null,
    semSiteProprio: false,
    detalhe: `Dominio proprio: ${dominio}`,
  };
}

/**
 * Regra do funil do CRM: SEM SITE inclui REDE_SOCIAL.
 * Unica funcao que a UI e as consultas devem usar para essa pergunta.
 */
export function temSiteProprio(status: WebsiteStatus): boolean {
  return status === 'SITE_PROPRIO';
}

/** Extrai a URL de perfil quando o website aponta para uma rede especifica. */
export function extrairPerfilSocial(
  bruto: string | null | undefined,
  rede: 'instagram' | 'facebook'
): string | null {
  if (bruto == null) return null;
  const dominio = extrairDominio(String(bruto));
  if (dominio === null) return null;

  const alvos =
    rede === 'instagram'
      ? ['instagram.com']
      : ['facebook.com', 'fb.com'];

  const casa = alvos.some((a) => dominio === a || dominio.endsWith(`.${a}`));
  return casa ? normalizarUrl(String(bruto)) : null;
}
