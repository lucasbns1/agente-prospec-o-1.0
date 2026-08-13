/**
 * Rotas de importacao.
 *
 * DOIS PASSOS SEPARADOS DE PROPOSITO:
 *   POST /api/imports/analisar  -> le e devolve a previa. NAO GRAVA.
 *   POST /api/imports/confirmar -> grava, so depois da sua confirmacao.
 *
 * O arquivo nao e persistido em disco entre os dois passos: a previa
 * devolve os dados ja analisados, e a confirmacao reenvia o arquivo.
 * Motivo: evita gerenciar arquivos temporarios, path traversal e
 * limpeza de lixo — problemas reais que nao valem a pena por um ganho
 * de alguns milissegundos num sistema local.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@prospector/database';
import { ErroParse, detectarFormato } from '@prospector/integrations';
import { exigirAutenticacao } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';
import { eventsBus } from '../lib/events-bus.js';
import {
  analisarArquivo,
  executarImportacao,
  type ResultadoAnalise,
} from '../services/import-service.js';

/** 25 MB. Um export do Instant Data Scraper raramente passa de 2 MB. */
const TAMANHO_MAXIMO = 25 * 1024 * 1024;

const mapeamentoSchema = z.record(z.string(), z.string()).optional();

/**
 * Valida o nome do arquivo.
 * Rejeita separadores de caminho e `..` — o nome so e usado como rotulo,
 * mas nao pode virar caminho se algum dia for gravado em disco.
 */
function validarNomeArquivo(nome: string): string {
  const limpo = nome.trim();
  if (limpo === '') throw new AppError('Nome de arquivo vazio', 400, 'ARQUIVO_INVALIDO');
  if (/[/\\]|\.\./.test(limpo)) {
    throw new AppError('Nome de arquivo inválido', 400, 'ARQUIVO_INVALIDO');
  }
  if (detectarFormato(limpo) === null) {
    throw new AppError(
      'Formato não suportado. Envie um arquivo .csv ou .xlsx.',
      400,
      'FORMATO_INVALIDO'
    );
  }
  return limpo;
}

/**
 * Extrai arquivo + campos do multipart.
 * `request.file()` vem da augmentacao de tipo do @fastify/multipart.
 */
async function lerUpload(request: FastifyRequest) {
  const dados = await request.file({ limits: { fileSize: TAMANHO_MAXIMO } });

  if (!dados) {
    throw new AppError('Nenhum arquivo enviado', 400, 'ARQUIVO_AUSENTE');
  }

  const nomeArquivo = validarNomeArquivo(dados.filename);

  let buffer: Buffer;
  try {
    buffer = await dados.toBuffer();
  } catch {
    throw new AppError(
      `Arquivo maior que o limite de ${TAMANHO_MAXIMO / 1024 / 1024} MB`,
      413,
      'ARQUIVO_GRANDE'
    );
  }

  if (buffer.length === 0) {
    throw new AppError('O arquivo enviado está vazio', 400, 'ARQUIVO_VAZIO');
  }

  return { buffer, nomeArquivo, fields: dados.fields };
}

/**
 * Le um campo de texto do multipart.
 *
 * O @fastify/multipart tipa `fields` como `Multipart | Multipart[]`
 * porque o mesmo nome pode aparecer varias vezes. Aqui so aceitamos o
 * caso simples: um campo, um valor de texto.
 */
function campoTexto(
  fields: Record<string, unknown>,
  nome: string
): string | undefined {
  const campo = fields[nome];
  if (campo == null || Array.isArray(campo)) return undefined;
  const valor = (campo as { value?: unknown }).value;
  return typeof valor === 'string' ? valor : undefined;
}

/** Enxuga a analise para a resposta HTTP. */
function serializarAnalise(analise: ResultadoAnalise, limitePreview = 200) {
  return {
    resumo: analise.resumo,
    cabecalhos: analise.cabecalhos,
    sugestoes: analise.sugestoes,
    mapeamento: analise.mapeamento,
    formato: analise.formato,
    planilhaUsada: analise.planilhaUsada ?? null,
    planilhasDisponiveis: analise.planilhasDisponiveis ?? null,
    avisosArquivo: analise.avisosArquivo,
    truncado: analise.linhas.length > limitePreview,
    linhas: analise.linhas.slice(0, limitePreview).map((l) => ({
      numeroLinha: l.numeroLinha,
      situacao: l.situacao,
      motivo: l.motivo,
      leadDuplicadoId: l.leadDuplicadoId,
      leadDuplicadoNome: l.leadDuplicadoNome,
      nome: l.normalizado.dados.nomeCompleto,
      primeiroNome: l.normalizado.dados.primeiroNome,
      telefone: l.normalizado.dados.telefone,
      telefoneNormalizado: l.normalizado.dados.telefoneNormalizado,
      endereco: l.normalizado.originais.endereco,
      bairro: l.normalizado.dados.bairro,
      cidade: l.normalizado.dados.cidade,
      estado: l.normalizado.dados.estado,
      categoria: l.normalizado.dados.categoria,
      website: l.normalizado.dados.websiteUrl,
      websiteStatus: l.normalizado.dados.websiteStatus,
      semSiteProprio: l.normalizado.semSiteProprio,
      semTelefone: l.normalizado.semTelefone,
      avaliacao: l.normalizado.dados.avaliacao,
      totalAvaliacoes: l.normalizado.dados.totalAvaliacoes,
      avisos: l.normalizado.avisos,
    })),
  };
}

export async function rotasImports(app: FastifyInstance): Promise<void> {
  /**
   * PREVIA — nao grava nada.
   */
  app.post(
    '/api/imports/analisar',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { buffer, nomeArquivo, fields } = await lerUpload(request);

      let mapeamento;
      const bruto = campoTexto(fields, 'mapeamento');
      if (bruto) {
        try {
          mapeamento = mapeamentoSchema.parse(JSON.parse(bruto));
        } catch {
          throw new AppError('Mapeamento de colunas inválido', 400, 'MAPEAMENTO_INVALIDO');
        }
      }

      try {
        const analise = await analisarArquivo(buffer, nomeArquivo, mapeamento);
        request.log.info(
          { arquivo: nomeArquivo, ...analise.resumo },
          'Arquivo analisado (nenhum dado gravado)'
        );
        return serializarAnalise(analise);
      } catch (err) {
        if (err instanceof ErroParse) {
          throw new AppError(err.message, 422, 'ERRO_LEITURA_ARQUIVO');
        }
        throw err;
      }
    }
  );

  /**
   * CONFIRMACAO — grava.
   */
  app.post(
    '/api/imports/confirmar',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { buffer, nomeArquivo, fields } = await lerUpload(request);

      let mapeamento;
      const brutoMap = campoTexto(fields, 'mapeamento');
      if (brutoMap) {
        try {
          mapeamento = mapeamentoSchema.parse(JSON.parse(brutoMap));
        } catch {
          throw new AppError('Mapeamento de colunas inválido', 400, 'MAPEAMENTO_INVALIDO');
        }
      }

      const somenteSemSite = campoTexto(fields, 'somenteSemSite') === 'true';

      try {
        // Reanalisa: o estado do banco pode ter mudado desde a previa.
        const analise = await analisarArquivo(buffer, nomeArquivo, mapeamento);

        const resultado = await executarImportacao(analise, {
          nomeArquivo,
          formato: analise.formato,
          userId: request.usuario?.id ?? null,
          somenteSemSite,
        });

        request.log.info(
          { importId: resultado.importId, ...resultado.resumo },
          'Importação concluída'
        );

        eventsBus.publicar('importacao.concluida', {
          importId: resultado.importId,
          importados: resultado.resumo.importados,
        });
        eventsBus.publicar('dashboard.atualizar');

        return resultado;
      } catch (err) {
        if (err instanceof ErroParse) {
          throw new AppError(err.message, 422, 'ERRO_LEITURA_ARQUIVO');
        }
        throw err;
      }
    }
  );

  /** Historico de importacoes. */
  app.get(
    '/api/imports',
    { preHandler: exigirAutenticacao },
    async () => {
      const imports = await prisma.import.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true, nomeArquivo: true, formato: true, status: true,
          totalLinhas: true, totalImportados: true, totalDuplicados: true,
          totalInvalidos: true, totalIgnorados: true,
          iniciadoEm: true, concluidoEm: true, createdAt: true,
        },
      });
      return { imports };
    }
  );

  /** Detalhe de uma importacao, com as linhas problematicas. */
  app.get<{ Params: { id: string } }>(
    '/api/imports/:id',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

      const registro = await prisma.import.findUnique({
        where: { id },
        include: {
          rows: {
            where: { status: { in: ['DUPLICADO', 'INVALIDO', 'IGNORADO'] } },
            orderBy: { numeroLinha: 'asc' },
            take: 500,
          },
        },
      });

      if (!registro) {
        throw new AppError('Importação não encontrada', 404, 'NAO_ENCONTRADO');
      }
      return { import: registro };
    }
  );
}
