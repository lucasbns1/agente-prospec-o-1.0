/**
 * Configuracoes — leitura na Fase 1, edicao completa na Fase 9.
 *
 * Estas rotas existem desde ja porque sao a prova de que NADA esta
 * hardcoded: os dominios sociais e o dicionario do motor de regras sao
 * lidos do banco, e voce consegue confirmar isso pelo navegador antes
 * mesmo de existir tela de configuracao.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@prospector/database';
import { exigirAutenticacao } from '../plugins/auth.js';

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
}
