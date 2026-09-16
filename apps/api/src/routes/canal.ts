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
import { z } from 'zod';
import { prisma } from '@prospector/database';
import {
  CANAL_COMANDO,
  CHAVE_ESTADO_CANAL,
  CHAVE_QR_CANAL,
  CHAVE_SETTING_NUMERO_ATIVO,
  CHAVE_SETTING_TELEFONES,
  ESTADO_CANAL_DESCONHECIDO,
  estadoEstaVelho,
  numeroAtivoDeSetting,
  NUMEROS_WHATSAPP,
  type ComandoCanal,
  type EstadoCanal,
  type NumeroWhatsApp,
} from '@prospector/shared';
import { renderizarQrComoImagem, resolverCanal } from '@prospector/integrations';
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

/**
 * Qual numero esta ativo, e o telefone que cada um mostrou ao autenticar.
 *
 * O telefone NAO e configurado a mao: ele e gravado pelo worker quando a
 * sessao autentica. Rotular o botao com um numero digitado por alguem
 * seria uma promessa que a tela nao pode cumprir — se o QR for lido com
 * o celular errado, o rotulo continuaria dizendo o numero certo e voce
 * so descobriria pela conversa do cliente.
 */
async function lerNumeros(): Promise<{
  ativo: NumeroWhatsApp;
  telefones: Record<string, string | null>;
}> {
  const [ativo, telefones] = await Promise.all([
    prisma.setting.findUnique({ where: { chave: CHAVE_SETTING_NUMERO_ATIVO } }),
    prisma.setting.findUnique({ where: { chave: CHAVE_SETTING_TELEFONES } }),
  ]);

  const mapa: Record<string, string | null> = {};
  const bruto = telefones?.valor;
  for (const n of NUMEROS_WHATSAPP) {
    const v =
      bruto && typeof bruto === 'object' && !Array.isArray(bruto)
        ? (bruto as Record<string, unknown>)[n]
        : null;
    mapa[n] = typeof v === 'string' && v !== '' ? v : null;
  }

  return { ativo: numeroAtivoDeSetting(ativo?.valor), telefones: mapa };
}

export async function rotasCanal(app: FastifyInstance): Promise<void> {
  /** Os dois numeros, para a tela desenhar os botoes. */
  app.get('/api/canal/numeros', { preHandler: exigirAutenticacao }, async () => {
    const { ativo, telefones } = await lerNumeros();
    const estado = await lerEstado();

    return {
      ativo,
      numeros: NUMEROS_WHATSAPP.map((n) => ({
        numero: n,
        telefone: telefones[n] ?? null,
        ativo: n === ativo,
        // So o ativo pode estar conectado — e nem ele sempre esta.
        conectado: n === ativo && estado.conectado,
      })),
    };
  });

  /**
   * Trocar o numero ativo.
   *
   * ============================================================
   * A API NAO TROCA: ELA PEDE
   * ============================================================
   * Quem segura a sessao e o worker. A API grava a escolha e publica um
   * comando; o worker desconecta um numero e conecta o outro. Se a API
   * abrisse a conexao, seriam duas sessoes disputando a mesma conta — e
   * o WhatsApp derruba as duas.
   *
   * ============================================================
   * POR QUE AS CAMPANHAS SAO PAUSADAS
   * ============================================================
   * A cadencia e uma CONVERSA. Quem recebeu "Encontrei sua barbearia no
   * Google" do numero 1 e recebe o follow-up do numero 2 nao ve
   * continuidade nenhuma: ve um desconhecido cobrando resposta de uma
   * conversa que nunca teve.
   *
   * Pausar e a escolha conservadora e reversivel: nada e perdido, e
   * voce reativa quando quiser. O contrario — seguir enviando — nao tem
   * volta depois que a mensagem sai.
   */
  app.post('/api/canal/numero', { preHandler: exigirAutenticacao }, async (request) => {
    const { numero } = z
      .object({ numero: z.enum(['1', '2']) })
      .parse(request.body);

    const { ativo } = await lerNumeros();

    if (numero === ativo) {
      return { numero, trocou: false, campanhasPausadas: 0, detalhe: 'Já era o número ativo' };
    }

    // A escolha e gravada ANTES do comando. Se o worker reiniciar no meio
    // da troca, ele acorda no numero novo — e nao no antigo, o que seria
    // mandar mensagem pelo numero que voce acabou de abandonar.
    await prisma.setting.upsert({
      where: { chave: CHAVE_SETTING_NUMERO_ATIVO },
      create: {
        chave: CHAVE_SETTING_NUMERO_ATIVO,
        valor: numero,
        categoria: 'whatsapp',
        sistema: true,
        descricao: 'Qual dos dois números de WhatsApp está conectado',
      },
      update: { valor: numero },
    });

    const pausadas = await prisma.campaign.updateMany({
      where: { status: 'ATIVA' },
      data: { status: 'PAUSADA' },
    });

    const comando: ComandoCanal = { tipo: 'trocar-numero', numero };
    await getLeitor().publish(CANAL_COMANDO, JSON.stringify(comando));

    request.log.warn(
      { numero, campanhasPausadas: pausadas.count },
      'Troca de número de WhatsApp pedida pela tela'
    );

    return {
      numero,
      trocou: true,
      campanhasPausadas: pausadas.count,
      detalhe:
        'O worker vai desconectar e conectar no outro número. Se ele ainda não ' +
        'conhece esse número, a tela vai pedir o QR.',
    };
  });

  /** Retrato completo, para a tela de configuração do canal. */
  app.get('/api/canal/status', { preHandler: exigirAutenticacao }, async () => {
    const estado = await lerEstado();

    const canal = process.env.WHATSAPP_CANAL ?? 'simulado';

    // DUAS coisas diferentes podem impedir o envio no nivel do SISTEMA, e
    // confundi-las custou uma noite de depuracao: a trava de fase, que
    // vive no codigo, e o canal simulado, que e um adapter falso se
    // declarando "conectado".
    //
    // A faixa do topo precisa dizer QUAL das duas — mandar a pessoa
    // procurar no lugar errado e pior do que nao avisar nada.
    // `resolverCanal` em vez de comparar a string na mao.
    //
    // A comparacao direta com 'whatsapp-web' era uma bomba-relogio: no
    // dia em que um segundo canal REAL apareceu (`baileys`), ela passou a
    // declarar simulado um WhatsApp de verdade conectado — e, como
    // `dryRun` sai dela, isso bloquearia o envio real sem nenhum aviso
    // que apontasse para a causa. A tela dizia "Conectado" e "CANAL
    // SIMULADO" ao mesmo tempo.
    //
    // Quem sabe quais canais existem e a factory. Perguntar a ela faz o
    // proximo canal novo funcionar sem ninguem lembrar de vir aqui.
    const motivo = !estado.envioRealPermitidoNaFase
      ? ('FASE_TRAVADA' as const)
      : resolverCanal(canal) === 'simulado'
        ? ('CANAL_SIMULADO' as const)
        : null;

    return {
      ...estado,
      canal,
      motivoSimulacao: motivo,
      dryRun: motivo !== null,
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
      },
      estado_atualizado_em: estado.atualizadoEm,
      saudavel: estado.conectado,
    };
  });
}
