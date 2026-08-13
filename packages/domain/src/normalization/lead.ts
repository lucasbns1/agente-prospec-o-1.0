/**
 * Normalizacao completa de uma linha de planilha em um lead.
 *
 * Funcao pura: recebe a linha crua + configuracao, devolve dados
 * normalizados, avisos e a chave de dedupe. Nao toca no banco.
 *
 * Se um campo nao puder ser determinado com seguranca, ele fica `null`
 * e um aviso e registrado. Nada e inventado, nada e deduzido.
 */
import {
  limparEspacos,
  normalizarNome,
  extrairPrimeiroNome,
  pareceEmpresa,
  normalizarCidade,
  normalizarBairro,
  normalizarEstado,
  normalizarCep,
  separarEndereco,
  normalizarAvaliacao,
  normalizarContagem,
} from './texto.js';
import { normalizarTelefone } from './telefone.js';
import {
  classificarWebsite,
  extrairPerfilSocial,
  type DominioSocial,
  type WebsiteStatus,
} from './website.js';
import { calcularChaveDedupe, type CriterioDedupe } from './dedupe.js';

/** Campos que o parser extrai da planilha, ja mapeados. */
export interface LinhaBruta {
  nome?: string | null;
  categoria?: string | null;
  telefone?: string | null;
  email?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  website?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  avaliacao?: string | null;
  totalAvaliacoes?: string | null;
  fonteUrl?: string | null;
}

export interface LeadNormalizado {
  nomeCompleto: string | null;
  primeiroNome: string | null;
  empresa: string | null;
  categoria: string | null;
  telefone: string | null;
  telefoneNormalizado: string | null;
  email: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  websiteUrl: string | null;
  websiteStatus: WebsiteStatus;
  instagramUrl: string | null;
  facebookUrl: string | null;
  avaliacao: number | null;
  totalAvaliacoes: number | null;
  fonteUrl: string | null;
  chaveDedupe: string | null;
  criterioDedupe: CriterioDedupe | null;
}

export interface AvisoNormalizacao {
  campo: string;
  mensagem: string;
  valorOriginal: string | null;
}

export interface ResultadoNormalizacao {
  dados: LeadNormalizado;
  /** Valores crus preservados, para gravar em `Lead.dadosBrutos`. */
  originais: {
    nome: string | null;
    telefone: string | null;
    endereco: string | null;
    website: string | null;
  };
  avisos: AvisoNormalizacao[];
  /** false = a linha nao vira lead. */
  valido: boolean;
  erros: string[];
  /** true quando o lead entra na lista de prospeccao. */
  semSiteProprio: boolean;
  /** true quando nao foi possivel obter telefone utilizavel. */
  semTelefone: boolean;
}

export interface OpcoesNormalizacao {
  dominiosSociais: DominioSocial[];
  ddiPadrao?: string;
  /**
   * Se true, linhas sem telefone sao marcadas invalidas.
   * Padrao false: o lead ainda serve para o CRM mesmo sem telefone —
   * quem decide se ele entra em campanha e voce, no filtro.
   */
  exigirTelefone?: boolean;
}

export function normalizarLead(
  linha: LinhaBruta,
  opcoes: OpcoesNormalizacao
): ResultadoNormalizacao {
  const avisos: AvisoNormalizacao[] = [];
  const erros: string[] = [];
  const ddiPadrao = opcoes.ddiPadrao ?? '55';

  // --- Nome ---
  const nomeCompleto = normalizarNome(linha.nome);
  if (nomeCompleto === null) {
    erros.push('Linha sem nome — impossivel identificar o lead');
  }

  const ehEmpresa = pareceEmpresa(nomeCompleto);
  const primeiroNome = extrairPrimeiroNome(nomeCompleto);

  if (nomeCompleto !== null && primeiroNome === null) {
    avisos.push({
      campo: 'primeiroNome',
      mensagem: ehEmpresa
        ? 'Nome parece ser de empresa — {{primeiro_nome}} ficara vazio e bloqueara o envio'
        : 'Nao foi possivel extrair um primeiro nome confiavel',
      valorOriginal: nomeCompleto,
    });
  }

  // --- Telefone ---
  const tel = normalizarTelefone(linha.telefone, ddiPadrao);
  if (tel.e164 === null) {
    const temAlgo = limparEspacos(linha.telefone) !== null;
    if (temAlgo) {
      avisos.push({
        campo: 'telefone',
        mensagem: tel.motivoInvalido ?? 'telefone invalido',
        valorOriginal: limparEspacos(linha.telefone),
      });
    }
    if (opcoes.exigirTelefone) {
      erros.push(tel.motivoInvalido ?? 'Lead sem telefone utilizavel');
    }
  }

  // --- Endereco ---
  const enderecoBruto = limparEspacos(linha.endereco);
  const partes = separarEndereco(enderecoBruto);

  // Colunas dedicadas tem prioridade sobre o que foi extraido do texto.
  const bairro = normalizarBairro(linha.bairro) ?? partes.bairro;
  const cidade = normalizarCidade(linha.cidade) ?? partes.cidade;
  const estado = normalizarEstado(linha.estado) ?? partes.estado;
  const cep = normalizarCep(linha.cep) ?? partes.cep;

  if (bairro === null && enderecoBruto !== null) {
    avisos.push({
      campo: 'bairro',
      mensagem: 'Bairro nao identificavel com seguranca — ficara vazio (nunca deduzido)',
      valorOriginal: enderecoBruto,
    });
  }

  // --- Website ---
  const website = classificarWebsite(linha.website, opcoes.dominiosSociais);

  // Instagram/Facebook podem vir em coluna propria OU no campo website.
  const instagramUrl =
    extrairPerfilSocial(linha.instagram, 'instagram') ??
    extrairPerfilSocial(linha.website, 'instagram');
  const facebookUrl =
    extrairPerfilSocial(linha.facebook, 'facebook') ??
    extrairPerfilSocial(linha.website, 'facebook');

  if (website.status === 'INVALIDO') {
    avisos.push({
      campo: 'website',
      mensagem: website.detalhe,
      valorOriginal: limparEspacos(linha.website),
    });
  }

  // --- Avaliacao ---
  const avaliacao = normalizarAvaliacao(linha.avaliacao);
  const totalAvaliacoes = normalizarContagem(linha.totalAvaliacoes);

  // --- Dedupe ---
  const dedupe = calcularChaveDedupe({
    telefoneNormalizado: tel.e164,
    nomeCompleto,
    enderecoOriginal: enderecoBruto,
    logradouro: partes.logradouro,
    numero: partes.numero,
    cidade,
  });

  if (dedupe.chave === null && nomeCompleto !== null) {
    avisos.push({
      campo: 'chaveDedupe',
      mensagem:
        'Sem telefone, endereco ou cidade — este lead nao tem protecao contra duplicidade',
      valorOriginal: nomeCompleto,
    });
  }

  const dados: LeadNormalizado = {
    nomeCompleto,
    primeiroNome,
    empresa: ehEmpresa ? nomeCompleto : null,
    categoria: limparEspacos(linha.categoria),
    telefone: limparEspacos(linha.telefone),
    telefoneNormalizado: tel.e164,
    email: limparEspacos(linha.email)?.toLowerCase() ?? null,
    logradouro: partes.logradouro,
    numero: partes.numero,
    bairro,
    cidade,
    estado,
    cep,
    websiteUrl: website.urlNormalizada,
    websiteStatus: website.status,
    instagramUrl,
    facebookUrl,
    avaliacao,
    totalAvaliacoes,
    fonteUrl: limparEspacos(linha.fonteUrl),
    chaveDedupe: dedupe.chave,
    criterioDedupe: dedupe.criterio,
  };

  return {
    dados,
    originais: {
      nome: limparEspacos(linha.nome),
      telefone: limparEspacos(linha.telefone),
      endereco: enderecoBruto,
      website: limparEspacos(linha.website),
    },
    avisos,
    valido: erros.length === 0,
    erros,
    semSiteProprio: website.semSiteProprio,
    semTelefone: tel.e164 === null,
  };
}
