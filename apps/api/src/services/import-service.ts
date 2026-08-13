/**
 * Servico de importacao.
 *
 * Orquestra: parser (integrations) -> normalizacao (domain) -> banco.
 * Nenhuma regra de negocio mora aqui — este arquivo so coordena e
 * persiste. O que decide "sem site" ou "duplicado" e o domain.
 *
 * DOIS MOMENTOS DISTINTOS:
 *   1. `analisar()` — le, normaliza, detecta duplicados. NAO GRAVA NADA.
 *      E o que alimenta a tela de preview.
 *   2. `importar()` — grava. So roda depois que voce confirma.
 */
import { prisma, Prisma } from '@prospector/database';
import {
  parseArquivo,
  sugerirMapeamento,
  sugestoesParaMapeamento,
  aplicarMapeamento,
  type Mapeamento,
  type SugestaoMapeamento,
} from '@prospector/integrations';
import {
  normalizarLead,
  type DominioSocial,
  type ResultadoNormalizacao,
} from '@prospector/domain';

export interface ResumoAnalise {
  totalLinhas: number;
  novos: number;
  duplicadosNoArquivo: number;
  duplicadosNoBanco: number;
  invalidos: number;
  comSite: number;
  semSite: number;
  redeSocial: number;
  semTelefone: number;
}

export type SituacaoLinha =
  | 'NOVO'
  | 'DUPLICADO_ARQUIVO'
  | 'DUPLICADO_BANCO'
  | 'INVALIDO';

export interface LinhaAnalisada {
  numeroLinha: number;
  situacao: SituacaoLinha;
  /** Preenchido quando situacao !== NOVO. */
  motivo: string | null;
  /** Lead existente que causou a duplicidade. */
  leadDuplicadoId: string | null;
  leadDuplicadoNome: string | null;
  normalizado: ResultadoNormalizacao;
  bruto: Record<string, string | null>;
}

export interface ResultadoAnalise {
  resumo: ResumoAnalise;
  linhas: LinhaAnalisada[];
  cabecalhos: string[];
  sugestoes: SugestaoMapeamento[];
  mapeamento: Mapeamento;
  formato: string;
  planilhaUsada?: string;
  planilhasDisponiveis?: string[];
  avisosArquivo: string[];
}

/** Le os dominios sociais configurados. Nunca hardcoded. */
async function carregarDominiosSociais(): Promise<DominioSocial[]> {
  const linhas = await prisma.socialDomain.findMany({ where: { ativo: true } });
  return linhas.map((d) => ({
    dominio: d.dominio,
    incluirSubdominios: d.incluirSubdominios,
    ativo: d.ativo,
  }));
}

async function carregarDdiPadrao(): Promise<string> {
  const s = await prisma.setting.findUnique({
    where: { chave: 'leads.telefone_ddi_padrao' },
  });
  return typeof s?.valor === 'string' ? s.valor : '55';
}

/**
 * ETAPA 1 — Analise. NAO GRAVA NADA NO BANCO.
 *
 * Le o arquivo, normaliza cada linha, calcula a chave de dedupe e
 * verifica colisoes tanto dentro do proprio arquivo quanto contra os
 * leads que ja existem.
 */
export async function analisarArquivo(
  buffer: Buffer,
  nomeArquivo: string,
  mapeamentoManual?: Mapeamento
): Promise<ResultadoAnalise> {
  const parsed = await parseArquivo(buffer, nomeArquivo);

  const sugestoes = sugerirMapeamento(parsed.cabecalhos);
  const mapeamento = mapeamentoManual ?? sugestoesParaMapeamento(sugestoes);

  const [dominiosSociais, ddiPadrao] = await Promise.all([
    carregarDominiosSociais(),
    carregarDdiPadrao(),
  ]);

  // --- Normaliza tudo em memoria ---
  const analisadas: LinhaAnalisada[] = parsed.linhas.map((bruto, i) => {
    const campos = aplicarMapeamento(bruto, mapeamento);
    const normalizado = normalizarLead(campos, { dominiosSociais, ddiPadrao });

    return {
      numeroLinha: i + 1,
      situacao: normalizado.valido ? 'NOVO' : 'INVALIDO',
      motivo: normalizado.valido ? null : normalizado.erros.join('; '),
      leadDuplicadoId: null,
      leadDuplicadoNome: null,
      normalizado,
      bruto,
    };
  });

  // --- Duplicidade DENTRO do arquivo ---
  //
  // Compara TODAS as chaves aplicaveis, nao so a de maior prioridade.
  // Sem isso o mesmo estabelecimento importado uma vez com telefone e
  // outra sem passaria como dois leads: as chaves primarias seriam
  // diferentes (telefone vs nome+endereco).
  //
  // A primeira ocorrencia vence; as seguintes sao marcadas.
  const vistas = new Map<string, { linha: number; criterio: string }>();

  for (const linha of analisadas) {
    if (linha.situacao !== 'NOVO') continue;
    const chaves = linha.normalizado.dados.chavesSecundarias;
    if (chaves.length === 0) continue;

    const colisao = chaves
      .map((k) => vistas.get(k.chave))
      .find((v) => v !== undefined);

    if (colisao) {
      linha.situacao = 'DUPLICADO_ARQUIVO';
      linha.motivo = `Mesmo lead da linha ${colisao.linha} (${rotuloDe(colisao.criterio)})`;
      continue;
    }

    for (const k of chaves) {
      if (!vistas.has(k.chave)) {
        vistas.set(k.chave, { linha: linha.numeroLinha, criterio: k.criterio });
      }
    }
  }

  // --- Duplicidade contra o BANCO ---
  // Uma unica consulta com todas as chaves, em vez de uma por linha.
  const todasAsChaves = new Set<string>();
  for (const l of analisadas) {
    if (l.situacao !== 'NOVO') continue;
    for (const k of l.normalizado.dados.chavesSecundarias) todasAsChaves.add(k.chave);
  }

  if (todasAsChaves.size > 0) {
    // Compara contra a chave primaria gravada E contra as chaves que os
    // leads existentes gerariam hoje. A coluna guarda so a primaria, entao
    // recalculamos as demais para os candidatos.
    const existentes = await prisma.lead.findMany({
      where: { chaveDedupe: { in: [...todasAsChaves] } },
      select: { id: true, chaveDedupe: true, nomeCompleto: true },
    });

    const porChave = new Map(existentes.map((l) => [l.chaveDedupe!, l]));

    for (const linha of analisadas) {
      if (linha.situacao !== 'NOVO') continue;

      for (const k of linha.normalizado.dados.chavesSecundarias) {
        const existente = porChave.get(k.chave);
        if (existente) {
          linha.situacao = 'DUPLICADO_BANCO';
          linha.motivo = `Já existe no CRM (${rotuloDe(k.criterio)})`;
          linha.leadDuplicadoId = existente.id;
          linha.leadDuplicadoNome = existente.nomeCompleto;
          break;
        }
      }
    }
  }

  return {
    resumo: montarResumo(analisadas),
    linhas: analisadas,
    cabecalhos: parsed.cabecalhos,
    sugestoes,
    mapeamento,
    formato: parsed.formato,
    ...(parsed.planilhaUsada ? { planilhaUsada: parsed.planilhaUsada } : {}),
    ...(parsed.planilhasDisponiveis
      ? { planilhasDisponiveis: parsed.planilhasDisponiveis }
      : {}),
    avisosArquivo: parsed.avisos,
  };
}

function rotuloDe(criterio: string): string {
  if (criterio === 'TELEFONE') return 'mesmo telefone';
  if (criterio === 'NOME_ENDERECO') return 'mesmo nome e endereço';
  if (criterio === 'NOME_CIDADE') return 'mesmo nome e cidade';
  return 'critério desconhecido';
}

function montarResumo(linhas: LinhaAnalisada[]): ResumoAnalise {
  const resumo: ResumoAnalise = {
    totalLinhas: linhas.length,
    novos: 0,
    duplicadosNoArquivo: 0,
    duplicadosNoBanco: 0,
    invalidos: 0,
    comSite: 0,
    semSite: 0,
    redeSocial: 0,
    semTelefone: 0,
  };

  for (const l of linhas) {
    if (l.situacao === 'NOVO') resumo.novos++;
    else if (l.situacao === 'DUPLICADO_ARQUIVO') resumo.duplicadosNoArquivo++;
    else if (l.situacao === 'DUPLICADO_BANCO') resumo.duplicadosNoBanco++;
    else resumo.invalidos++;

    // As contagens de site/telefone consideram apenas o que sera
    // realmente importado — contar duplicado inflaria o numero.
    if (l.situacao !== 'NOVO') continue;

    if (l.normalizado.semSiteProprio) resumo.semSite++;
    else resumo.comSite++;

    if (l.normalizado.dados.websiteStatus === 'REDE_SOCIAL') resumo.redeSocial++;
    if (l.normalizado.semTelefone) resumo.semTelefone++;
  }

  return resumo;
}

// -----------------------------------------------------------------------------
// ETAPA 2 — Importacao efetiva
// -----------------------------------------------------------------------------

export interface OpcoesImportacao {
  nomeArquivo: string;
  formato: string;
  userId: string | null;
  captureSessionId?: string | null;
  /** Se true, importa apenas leads sem site proprio. */
  somenteSemSite?: boolean;
}

export interface ResultadoImportacao {
  importId: string;
  resumo: ResumoAnalise & { importados: number };
  problemas: Array<{
    numeroLinha: number;
    nome: string | null;
    problema: string;
    acaoTomada: string;
  }>;
}

/**
 * Grava a importacao.
 *
 * Estrategia de gravacao: os leads sao criados um a um, em lotes, com a
 * colisao de `chaveDedupe` tratada como "ja existe" (P2002) em vez de
 * erro fatal. Isso cobre a corrida em que dois imports rodam ao mesmo
 * tempo — a analise diz "novo", mas entre a analise e a gravacao outro
 * processo criou o mesmo lead. O banco decide, nao a aplicacao.
 */
export async function executarImportacao(
  analise: ResultadoAnalise,
  opcoes: OpcoesImportacao
): Promise<ResultadoImportacao> {
  const agora = new Date();

  const importRegistro = await prisma.import.create({
    data: {
      nomeArquivo: opcoes.nomeArquivo,
      formato: opcoes.formato,
      status: 'PROCESSANDO',
      mapeamentoColunas: analise.mapeamento as Prisma.InputJsonValue,
      colunasDetectadas: analise.cabecalhos as Prisma.InputJsonValue,
      totalLinhas: analise.resumo.totalLinhas,
      iniciadoEm: agora,
      userId: opcoes.userId,
      captureSessionId: opcoes.captureSessionId ?? null,
    },
  });

  const problemas: ResultadoImportacao['problemas'] = [];
  let importados = 0;
  let duplicadosGravacao = 0;

  for (const linha of analise.linhas) {
    const d = linha.normalizado.dados;

    // --- Linhas que nao viram lead ---
    if (linha.situacao !== 'NOVO') {
      await prisma.importRow.create({
        data: {
          importId: importRegistro.id,
          numeroLinha: linha.numeroLinha,
          dadosOriginais: linha.bruto as Prisma.InputJsonValue,
          dadosNormalizados: d as unknown as Prisma.InputJsonValue,
          status: linha.situacao === 'INVALIDO' ? 'INVALIDO' : 'DUPLICADO',
          motivoErro: linha.motivo,
          dedupeCriterio: d.criterioDedupe,
          leadDuplicadoId: linha.leadDuplicadoId,
        },
      });

      problemas.push({
        numeroLinha: linha.numeroLinha,
        nome: d.nomeCompleto,
        problema: linha.motivo ?? 'desconhecido',
        acaoTomada:
          linha.situacao === 'INVALIDO'
            ? 'Linha ignorada — não virou lead'
            : 'Lead não duplicado; linha registrada para auditoria',
      });
      continue;
    }

    // --- Filtro opcional "somente sem site" ---
    if (opcoes.somenteSemSite && !linha.normalizado.semSiteProprio) {
      await prisma.importRow.create({
        data: {
          importId: importRegistro.id,
          numeroLinha: linha.numeroLinha,
          dadosOriginais: linha.bruto as Prisma.InputJsonValue,
          dadosNormalizados: d as unknown as Prisma.InputJsonValue,
          status: 'IGNORADO',
          motivoErro: 'Tem site próprio (filtro "somente sem site" ativo)',
        },
      });
      continue;
    }

    // --- Cria o lead ---
    try {
      const lead = await prisma.lead.create({
        data: {
          nomeOriginal: linha.normalizado.originais.nome,
          telefoneOriginal: linha.normalizado.originais.telefone,
          enderecoOriginal: linha.normalizado.originais.endereco,
          websiteOriginal: linha.normalizado.originais.website,

          nomeCompleto: d.nomeCompleto,
          primeiroNome: d.primeiroNome,
          // Preenchido apenas quando a planilha traz uma coluna de
          // responsavel mapeada. Nunca derivado do nome do lugar.
          nomeContato: d.nomeContato,
          empresa: d.empresa,
          categoria: d.categoria,

          telefone: d.telefone,
          telefoneNormalizado: d.telefoneNormalizado,
          email: d.email,

          logradouro: d.logradouro,
          numero: d.numero,
          bairro: d.bairro,
          cidade: d.cidade,
          estado: d.estado,
          cep: d.cep,

          websiteUrl: d.websiteUrl,
          websiteStatus: d.websiteStatus,
          instagramUrl: d.instagramUrl,
          facebookUrl: d.facebookUrl,
          avaliacao: d.avaliacao,
          totalAvaliacoes: d.totalAvaliacoes,

          status: 'IMPORTADO',
          temperatura: 'FRIO',

          origem: 'importacao',
          fonteUrl: d.fonteUrl,
          importId: importRegistro.id,
          captureSessionId: opcoes.captureSessionId ?? null,
          importadoEm: agora,
          capturadoEm: agora,
          dadosBrutos: linha.bruto as Prisma.InputJsonValue,

          chaveDedupe: d.chaveDedupe,

          events: {
            create: [
              {
                tipo: 'IMPORTADO',
                descricao: `Importado de ${opcoes.nomeArquivo}, linha ${linha.numeroLinha}`,
                origem: 'sistema',
                dados: {
                  arquivo: opcoes.nomeArquivo,
                  linha: linha.numeroLinha,
                } as Prisma.InputJsonValue,
              },
              {
                tipo: 'WEBSITE_VERIFICADO',
                descricao: linha.normalizado.semSiteProprio
                  ? 'Classificado como SEM SITE PRÓPRIO'
                  : 'Classificado como COM SITE PRÓPRIO',
                origem: 'sistema',
                dados: {
                  status: d.websiteStatus,
                  url: d.websiteUrl,
                } as Prisma.InputJsonValue,
              },
            ],
          },

          websiteChecks: {
            create: {
              urlVerificada: d.websiteUrl,
              status: d.websiteStatus,
              detalhe: `Classificado na importação (linha ${linha.numeroLinha})`,
            },
          },
        },
      });

      await prisma.importRow.create({
        data: {
          importId: importRegistro.id,
          numeroLinha: linha.numeroLinha,
          dadosOriginais: linha.bruto as Prisma.InputJsonValue,
          dadosNormalizados: d as unknown as Prisma.InputJsonValue,
          status: 'IMPORTADO',
          leadId: lead.id,
        },
      });

      importados++;

      // Avisos nao impedem a importacao, mas ficam registrados.
      for (const aviso of linha.normalizado.avisos) {
        problemas.push({
          numeroLinha: linha.numeroLinha,
          nome: d.nomeCompleto,
          problema: `${aviso.campo}: ${aviso.mensagem}`,
          acaoTomada: 'Lead importado; campo ficou vazio',
        });
      }
    } catch (err) {
      // Corrida: outro processo criou o mesmo lead entre a analise e agora.
      // A constraint UNIQUE do banco e quem decide — nao a aplicacao.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        duplicadosGravacao++;
        const existente = d.chaveDedupe
          ? await prisma.lead.findUnique({
              where: { chaveDedupe: d.chaveDedupe },
              select: { id: true },
            })
          : null;

        await prisma.importRow.create({
          data: {
            importId: importRegistro.id,
            numeroLinha: linha.numeroLinha,
            dadosOriginais: linha.bruto as Prisma.InputJsonValue,
            status: 'DUPLICADO',
            motivoErro: 'Lead já existia no momento da gravação',
            dedupeCriterio: d.criterioDedupe,
            leadDuplicadoId: existente?.id ?? null,
          },
        });

        problemas.push({
          numeroLinha: linha.numeroLinha,
          nome: d.nomeCompleto,
          problema: 'Duplicado detectado na gravação',
          acaoTomada: 'Lead não duplicado',
        });
        continue;
      }
      throw err;
    }
  }

  const resumoFinal = {
    ...analise.resumo,
    importados,
    duplicadosNoBanco: analise.resumo.duplicadosNoBanco + duplicadosGravacao,
  };

  await prisma.import.update({
    where: { id: importRegistro.id },
    data: {
      status: 'CONCLUIDO',
      concluidoEm: new Date(),
      totalImportados: importados,
      totalDuplicados:
        resumoFinal.duplicadosNoArquivo + resumoFinal.duplicadosNoBanco,
      totalInvalidos: resumoFinal.invalidos,
      totalIgnorados:
        resumoFinal.totalLinhas -
        importados -
        resumoFinal.duplicadosNoArquivo -
        resumoFinal.duplicadosNoBanco -
        resumoFinal.invalidos,
    },
  });

  return { importId: importRegistro.id, resumo: resumoFinal, problemas };
}
