/**
 * Estado do canal — o que a tela de configuracao mostra.
 *
 * ============================================================
 * A API NAO ABRE CONEXAO
 * ============================================================
 * Quem segura a sessao do WhatsApp e o worker. Se a API tambem
 * conectasse, seriam duas sessoes disputando o mesmo numero — e o
 * WhatsApp derruba as duas. Aqui so LEMOS o retrato que o worker
 * publica no Redis.
 *
 * ============================================================
 * O QR NAO PASSA POR SSE
 * ============================================================
 * Um evento SSE chega a todas as abas abertas. O QR da acesso a conta e
 * vale poucos segundos: ele fica numa chave com TTL curto, servida por
 * uma rota autenticada, e some assim que a sessao autentica.
 */
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import {
  CHAVE_ESTADO_CANAL,
  CHAVE_QR_CANAL,
  ESTADO_CANAL_DESCONHECIDO,
  estadoEstaVelho,
  type EstadoCanal,
} from '@prospector/shared';
import { resolverModo, renderizarQrComoImagem } from '@prospector/integrations';
import { exigirAutenticacao } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';

let leitor: Redis | null = null;

function getLeitor(): Redis {
  if (!leitor) {
    leitor = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
      // A tela nao pode travar esperando um Redis que caiu.
      lazyConnect: false,
    });
    leitor.on('error', () => {
      // Silencioso de proposito: o erro vira "estado desconhecido" na
      // resposta, que e mais util do que derrubar a rota.
    });
  }
  return leitor;
}

async function lerEstado(): Promise<EstadoCanal> {
  try {
    const bruto = await getLeitor().get(CHAVE_ESTADO_CANAL);
    if (!bruto) return ESTADO_CANAL_DESCONHECIDO;

    const estado = JSON.parse(bruto) as EstadoCanal;

    // Retrato velho = worker parado. Dizer "conectado" aqui seria a
    // mentira mais cara do sistema: voce so descobriria quando a
    // mensagem nao chegasse.
    if (estadoEstaVelho(estado)) {
      return {
        ...estado,
        status: 'DESCONECTADO',
        conectado: false,
        autenticado: false,
        temQr: false,
        detalhe:
          'O worker parou de publicar estado — a conexão não está confirmada. Ele está rodando?',
      };
    }

    return estado;
  } catch {
    return ESTADO_CANAL_DESCONHECIDO;
  }
}

export async function rotasCanal(app: FastifyInstance): Promise<void> {
  /** Retrato completo, para a tela de configuração do canal. */
  app.get('/api/canal/status', { preHandler: exigirAutenticacao }, async () => {
    const estado = await lerEstado();
    const modo = resolverModo(process.env.WHATSAPP_MODE);

    return {
      ...estado,
      modo,
      dryRun: modo === 'dry-run' || !estado.envioRealPermitidoNaFase,
      canal: process.env.WHATSAPP_CANAL ?? 'simulado',
    };
  });

  /**
   * O QR, servido separadamente — já como imagem.
   *
   * Devolve 404 quando não há QR — o que também acontece quando a sessão
   * já autenticou. "Não há QR" e "ainda não gerou" são a mesma resposta
   * de propósito: a tela só precisa saber se tem algo a mostrar.
   *
   * O que sai daqui é a FIGURA, não o texto. O `whatsapp-web.js` entrega
   * uma string, e mostrar essa string na tela não conecta ninguém: não se
   * escaneia texto com a câmera. O texto cru deliberadamente não é mais
   * devolvido — ele é uma credencial, e uma credencial que a tela não usa
   * não tem por que trafegar.
   */
  app.get('/api/canal/qr', { preHandler: exigirAutenticacao }, async (request) => {
    try {
      const qr = await getLeitor().get(CHAVE_QR_CANAL);
      if (!qr) {
        throw new AppError(
          'Nenhum QR Code disponível agora',
          404,
          'SEM_QR'
        );
      }
      // O QR nunca vai para o log — ele é uma credencial de acesso.
      request.log.info('QR Code entregue à tela de configuração');
      return {
        imagem: await renderizarQrComoImagem(qr),
        expiraEmSegundos: await getLeitor().ttl(CHAVE_QR_CANAL),
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('Não foi possível ler o QR Code', 503, 'CANAL_INDISPONIVEL');
    }
  });

  /**
   * Saúde do canal (item 17).
   *
   * Separada do status porque tem outro público: o status é para a tela,
   * a saúde é para diagnóstico — e responde a pergunta "dá para confiar
   * no que a tela está dizendo?".
   */
  app.get('/api/canal/saude', { preHandler: exigirAutenticacao }, async () => {
    const estado = await lerEstado();
    const agora = Date.now();
    const ultimoEvento = estado.ultimoEventoEm
      ? new Date(estado.ultimoEventoEm).getTime()
      : null;

    return {
      channel: {
        provider: estado.provider,
        status: estado.status,
        authenticated: estado.autenticado,
        connected: estado.conectado,
        last_event_at: estado.ultimoEventoEm,
        session_age_seconds: estado.sessaoDesde
          ? Math.round((agora - new Date(estado.sessaoDesde).getTime()) / 1000)
          : null,
        seconds_since_last_event: ultimoEvento
          ? Math.round((agora - ultimoEvento) / 1000)
          : null,
        reconnect_attempts: estado.tentativasReconexao,
      },
      envio: {
        real_permitido_na_fase: estado.envioRealPermitidoNaFase,
        modo: resolverModo(process.env.WHATSAPP_MODE),
      },
      estado_atualizado_em: estado.atualizadoEm,
      saudavel: estado.conectado,
    };
  });
}
