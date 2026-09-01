/**
 * A varredura que se repete.
 *
 * ============================================================
 * POR QUE UMA VEZ SO NAO BASTAVA
 * ============================================================
 * `recuperarMensagensPerdidas` sempre funcionou. O problema era
 * QUANDO ela rodava: uma unica vez, dez segundos depois de o WhatsApp
 * conectar, e nunca mais.
 *
 * O efeito em uso real: o worker cai numa sexta, ninguem percebe, e na
 * segunda as respostas do fim de semana estao fora da janela. Um lead
 * respondeu duas vezes no WhatsApp e o diagnostico mostrava
 * `RESPOSTAS DELE (0)` — a cadencia congelada esperando algo que o
 * sistema nunca soube que existia.
 *
 * ============================================================
 * ELA NAO E UM SEGUNDO PIPELINE
 * ============================================================
 * Este arquivo NAO processa mensagem. Ele so chama a funcao que ja
 * existe, no relogio. Toda mensagem recuperada passa exatamente pelo
 * mesmo `processarMensagemRecebida` das mensagens ao vivo — e e essa
 * identidade que torna o replay seguro, porque a idempotencia por
 * `provider_message_id` mora la.
 *
 * ============================================================
 * POR QUE UM INTERVALO CURTO E BARATO
 * ============================================================
 * A varredura descarta as conversas paradas pelo `timestamp` do chat
 * ANTES de buscar mensagem nenhuma. Numa base sem movimento, cinco
 * minutos custam quase nada; numa base com movimento, o custo e
 * proporcional ao que de fato mudou.
 */
import type { WhatsAppAdapter } from '@prospector/integrations';
import type { Logger } from 'pino';
import { prisma } from '@prospector/database';
import {
  recuperarMensagensPerdidas,
  type ResultadoRecuperacao,
} from './recuperar-perdidas.js';

/**
 * Uma varredura por vez.
 *
 * Ler as conversas leva segundos. Se o intervalo for menor que a
 * duracao de uma varredura, duas passariam a correr juntas sobre as
 * mesmas conversas — e os efeitos de uma resposta (avancar etapa,
 * cancelar fila, opt-out) sairiam fora de ordem.
 *
 * A idempotencia impediria mensagem duplicada, mas nao impediria dois
 * caminhos disputando o mesmo estado. E mais simples nao deixar
 * comecar.
 */
let emAndamento = false;

/**
 * Onde fica registrada a ultima falha de varredura.
 *
 * A tela le esta chave para diferenciar "ainda nao rodou" (worker acabou
 * de subir) de "roda e falha toda vez" (algo quebrou). As duas coisas
 * produzem a mesma ausencia de carimbo, e pedem acoes opostas.
 */
export const CHAVE_FALHA_NA_VARREDURA = 'canal.ultima_varredura_falha';

/** O resultado da ultima varredura, para quem quiser olhar sem esperar. */
let ultimo: ResultadoRecuperacao | null = null;

export function ultimaVarredura(): ResultadoRecuperacao | null {
  return ultimo;
}

/**
 * Roda uma varredura, se nao houver outra correndo.
 *
 * NUNCA lanca: e chamada de um timer e de uma rota, e em nenhum dos
 * dois uma falha pode derrubar quem chamou. Recuperacao e acessorio —
 * ela nao pode quebrar o que funciona sem ela.
 */
export async function varrerAgora(p: {
  adapter: WhatsAppAdapter;
  log: Logger;
  janelaHoras: number;
  /**
   * A janela da estreia — vale so enquanto o banco nao tem nenhuma
   * mensagem recebida. Ausente = o padrao de `recuperar-perdidas`.
   */
  janelaPrimeiraVezHoras?: number;
  /** De onde veio o pedido, para o log dizer quem mandou. */
  origem: 'conexao' | 'periodica' | 'manual';
}): Promise<ResultadoRecuperacao | { pulada: true; motivo: string }> {
  if (emAndamento) {
    return { pulada: true, motivo: 'Já há uma varredura em andamento' };
  }

  emAndamento = true;
  try {
    const r = await recuperarMensagensPerdidas(
      p.adapter,
      p.log,
      new Date(),
      p.janelaHoras,
      p.janelaPrimeiraVezHoras
    );
    ultimo = r;

    // Deu certo: a marca de falha sai. Sem isto, um problema resolvido
    // continuaria alarmando a tela para sempre.
    try {
      await prisma.setting.deleteMany({ where: { chave: CHAVE_FALHA_NA_VARREDURA } });
    } catch {
      // Idem: limpar a marca nao pode virar uma falha nova.
    }

    // Silencio quando nao ha nada: a varredura periodica roda o dia
    // inteiro, e uma linha de log a cada cinco minutos dizendo "nada
    // novo" afogaria as linhas que importam.
    if (r.lidas > 0) {
      p.log.info(
        { ...r, desde: r.desde.toISOString(), origem: p.origem },
        r.novas > 0
          ? 'Varredura recuperou mensagens que o worker nao tinha visto'
          : 'Varredura concluida — nada havia se perdido'
      );
    }

    return r;
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    p.log.error({ err, origem: p.origem }, 'Falha na varredura de mensagens perdidas');

    // ============================================================
    // A FALHA VAI PARA A TELA, E NAO SO PARA O LOG
    // ============================================================
    // Uma varredura que falha nao carimba "sincronizado" — isso ja
    // estava certo. Mas o efeito colateral era outro silencio: a faixa
    // do dashboard dizia "ainda nao rodou", que e o mesmo que ela diz
    // quando o worker acabou de subir.
    //
    // "Nao rodou ainda" e "roda e falha toda vez" pedem acoes
    // diferentes: a primeira e esperar, a segunda e ir olhar. Gravar o
    // motivo e o que permite a tela distinguir as duas.
    try {
      await prisma.setting.upsert({
        where: { chave: CHAVE_FALHA_NA_VARREDURA },
        update: { valor: `${new Date().toISOString()} — ${motivo}` },
        create: {
          chave: CHAVE_FALHA_NA_VARREDURA,
          valor: `${new Date().toISOString()} — ${motivo}`,
          descricao: 'Quando e por que a ultima varredura do WhatsApp falhou',
        },
      });
    } catch {
      // Nao conseguir registrar a falha nao pode virar uma segunda
      // falha. O log ja tem o essencial.
    }

    return { pulada: true, motivo };
  } finally {
    emAndamento = false;
  }
}

/**
 * Liga o relogio.
 *
 * Devolve a funcao que desliga — o worker a chama no encerramento, para
 * o processo nao ficar preso a um timer.
 */
export function iniciarVarreduraPeriodica(p: {
  adapter: WhatsAppAdapter;
  log: Logger;
  intervaloMinutos: number;
  janelaHoras: number;
  janelaPrimeiraVezHoras?: number;
}): () => void {
  // Zero desliga. Nao e o mesmo que um intervalo enorme: quem depura
  // quer a varredura de conexao sem o ruido da periodica.
  if (p.intervaloMinutos <= 0) {
    p.log.info(
      'Varredura periodica desligada (WHATSAPP_RECONCILIATION_INTERVAL_MINUTES=0)'
    );
    return () => {};
  }

  const ms = p.intervaloMinutos * 60_000;

  const timer = setInterval(() => {
    // Sem `await`: o timer nao pode ficar preso a uma varredura lenta.
    // O `emAndamento` ja impede a sobreposicao.
    void varrerAgora({
      adapter: p.adapter,
      log: p.log,
      janelaHoras: p.janelaHoras,
      janelaPrimeiraVezHoras: p.janelaPrimeiraVezHoras,
      origem: 'periodica',
    });
  }, ms);

  // Sem isto o processo nao encerraria sozinho enquanto o timer
  // estivesse armado.
  timer.unref?.();

  p.log.info(
    { intervaloMinutos: p.intervaloMinutos, janelaHoras: p.janelaHoras },
    'Varredura periodica do WhatsApp ligada'
  );

  return () => clearInterval(timer);
}
