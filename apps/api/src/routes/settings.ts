/**
 * Configuracoes — leitura na Fase 1, edicao completa na Fase 9.
 *
 * Estas rotas existem desde ja porque sao a prova de que NADA esta
 * hardcoded: os dominios sociais e o dicionario do motor de regras sao
 * lidos do banco, e voce consegue confirmar isso pelo navegador antes
 * mesmo de existir tela de configuracao.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@prospector/database';
import { exigirAutenticacao } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';

/**
 * DDI: 1 a 3 digitos, sem "+".
 *
 * Aceitar "+351" gravaria o "+" no banco e a normalizacao produziria
 * "+351912345678" — que nao e E.164 sem "+" e nao casaria com nenhum
 * telefone ja gravado. O lead viraria um contato desconhecido nas
 * respostas.
 */
const ddiSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}$/, 'O DDI e so o numero do pais, sem "+". Ex: 55, 351, 1');

export async function rotasSettings(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', { preHandler: exigirAutenticacao }, async () => {
    const settings = await prisma.setting.findMany({
      orderBy: [{ categoria: 'asc' }, { chave: 'asc' }],
    });
    return { settings };
  });

  app.get(
    '/api/settings/social-domains',
    { preHandler: exigirAutenticacao },
    async () => {
      const dominios = await prisma.socialDomain.findMany({
        orderBy: { dominio: 'asc' },
      });
      return { dominios };
    }
  );

  app.get(
    '/api/settings/keywords',
    { preHandler: exigirAutenticacao },
    async () => {
      const keywords = await prisma.responseKeyword.findMany({
        where: { campaignStepId: null },
        orderBy: [{ categoria: 'asc' }, { peso: 'desc' }, { termo: 'asc' }],
      });

      // Agrupado por categoria — e assim que a tela de configuracoes vai
      // renderizar o dicionario.
      const porCategoria = keywords.reduce<Record<string, typeof keywords>>(
        (acc, k) => {
          (acc[k.categoria] ??= []).push(k);
          return acc;
        },
        {}
      );

      return { total: keywords.length, porCategoria };
    }
  );

  /**
   * Troca o DDI assumido na importacao.
   *
   * ============================================================
   * POR QUE SO ESTA CONFIGURACAO E EDITAVEL POR ROTA
   * ============================================================
   * Uma rota generica de "salvar qualquer setting" aceitaria qualquer
   * JSON em qualquer chave — inclusive `regras.precedencia`, que manda
   * na ordem de desempate do motor de classificacao. Um valor mal
   * formado ali nao da erro visivel: ele muda silenciosamente como TODA
   * resposta e classificada.
   *
   * O DDI e diferente: e uma escolha operacional sua, muda de lista
   * para lista, e o formato tem uma regra que a rota consegue conferir.
   *
   * ============================================================
   * NAO REPROCESSA O QUE JA FOI IMPORTADO
   * ============================================================
   * Trocar o DDI muda apenas as PROXIMAS importacoes. Reescrever os
   * telefones ja gravados mudaria o destino de mensagens que talvez ja
   * tenham saido — e a conversa no WhatsApp continuaria no numero
   * antigo, que nao bateria mais com o do CRM.
   *
   * O jeito certo de mudar uma lista ja importada e reimportar.
   */
  app.put<{ Body: { valor: string } }>(
    '/api/settings/ddi-padrao',
    { preHandler: exigirAutenticacao },
    async (request) => {
      const parsed = ddiSchema.safeParse(request.body?.valor);
      if (!parsed.success) {
        throw new AppError(
          parsed.error.issues[0]?.message ?? 'DDI invalido',
          422,
          'DDI_INVALIDO'
        );
      }

      const setting = await prisma.setting.upsert({
        where: { chave: 'leads.telefone_ddi_padrao' },
        update: { valor: parsed.data },
        create: {
          chave: 'leads.telefone_ddi_padrao',
          valor: parsed.data,
          descricao:
            'DDI assumido quando o telefone importado nao traz codigo de pais.',
          categoria: 'leads',
        },
      });

      request.log.info({ ddi: parsed.data }, 'DDI padrao alterado');
      return {
        setting,
        aviso:
          'Vale para as PRÓXIMAS importações. Os leads já importados mantêm ' +
          'o telefone como está — reescrevê-los mudaria o destino de ' +
          'mensagens que talvez já tenham saído.',
      };
    }
  );
}
