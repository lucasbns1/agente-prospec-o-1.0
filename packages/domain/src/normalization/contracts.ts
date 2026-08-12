/**
 * CONTRATOS DE NORMALIZACAO — implementacao na FASE 3.
 *
 * PRINCIPIO INEGOCIAVEL: se nao for possivel determinar um valor com
 * seguranca, o resultado e `null`. O sistema nunca deduz, nunca completa,
 * nunca inventa. Um bairro errado numa mensagem e pior do que nenhum
 * bairro — por isso {{bairro}} vazio bloqueia o envio em vez de sair em
 * branco.
 */
import type { WebsiteStatus } from '@prospector/shared';

/** Um lead pode ter todos os campos nulos exceto o que veio no arquivo. */
export interface LeadNormalizado {
  nomeCompleto: string | null;
  primeiroNome: string | null;
  empresa: string | null;
  categoria: string | null;
  telefone: string | null;
  /** E.164 sem o "+". Ex: "5519999998888". */
  telefoneNormalizado: string | null;
  email: string | null;
  logradouro: string | null;
  numero: string | null;
  /** NULL sempre que a origem nao trouxer o bairro explicitamente. */
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  websiteUrl: string | null;
  websiteStatus: WebsiteStatus;
  instagramUrl: string | null;
  facebookUrl: string | null;
}

/** Aviso nao-fatal: o valor foi aceito, mas merece revisao humana. */
export interface AvisoNormalizacao {
  campo: string;
  mensagem: string;
  valorOriginal: string | null;
}

export interface ResultadoNormalizacao {
  dados: LeadNormalizado;
  avisos: AvisoNormalizacao[];
  /** false = a linha nao vira lead (ex: sem telefone utilizavel). */
  valido: boolean;
  erros: string[];
}

// -----------------------------------------------------------------------------
// Assinaturas
// -----------------------------------------------------------------------------

/**
 * Texto -> minusculo, sem acento, sem pontuacao, espacos colapsados.
 * Usado tanto na comparacao de nomes quanto no motor de regras.
 */
export type NormalizarTexto = (texto: string) => string;

/**
 * Telefone brasileiro -> E.164.
 * Retorna null quando o numero nao tem digitos suficientes para ser
 * discado com seguranca. Nunca "conserta" um numero curto.
 */
export type NormalizarTelefone = (
  bruto: string | null | undefined,
  ddiPadrao?: string
) => string | null;

/** Extrai o primeiro nome utilizavel. Null se o nome for so a empresa. */
export type ExtrairPrimeiroNome = (nomeCompleto: string | null) => string | null;

/**
 * Classifica o website.
 *
 * @param dominiosSociais lista vinda da tabela `social_domains`. Um dominio
 *        fora desta lista NUNCA e tratado como rede social — mesmo que
 *        pareca. Nada e inferido.
 */
export type ClassificarWebsite = (
  url: string | null | undefined,
  dominiosSociais: string[]
) => { status: WebsiteStatus; dominio: string | null; dominioSocial: string | null };

/** true apenas quando status === SITE_PROPRIO. */
export type TemSiteProprio = (status: WebsiteStatus) => boolean;

/**
 * Quebra um endereco em partes.
 * Campos nao identificados com seguranca voltam null — em especial o
 * bairro, que raramente vem separado no export do Google Maps.
 */
export type SepararEndereco = (enderecoBruto: string | null) => {
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
};

export type NormalizarLead = (
  bruto: Record<string, unknown>,
  opcoes: { dominiosSociais: string[]; ddiPadrao: string }
) => ResultadoNormalizacao;
