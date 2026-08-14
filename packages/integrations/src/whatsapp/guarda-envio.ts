/**
 * A guarda de envio — a barreira que impede envio real POR CONSTRUCAO.
 *
 * ============================================================
 * POR QUE UMA VARIAVEL DE AMBIENTE NAO BASTA
 * ============================================================
 * `WHATSAPP_MODE=dry-run` protege enquanto alguem lembrar de conferir o
 * .env. Basta um `export WHATSAPP_MODE=live` num terminal, um docker-
 * compose com o valor errado, ou um teste que mexe em `process.env`
 * para a unica trava cair.
 *
 * Esta fase precisa de algo mais forte: uma trava que NAO depende de
 * configuracao. Enquanto `FASE_PERMITE_ENVIO_REAL` for `false`, nenhum
 * caminho do codigo consegue chamar o WhatsApp de verdade — nem que
 * todas as variaveis de ambiente digam o contrario.
 *
 * Ligar o envio real exige EDITAR ESTE ARQUIVO, o que significa: um
 * commit, com autor, data e revisao. Nao e algo que acontece por
 * acidente de configuracao.
 *
 * ============================================================
 * COMO LIBERAR (fase futura, com autorizacao explicita)
 * ============================================================
 *   1. mudar `FASE_PERMITE_ENVIO_REAL` para true;
 *   2. `WHATSAPP_MODE=live` no .env;
 *   3. `Campaign.dryRun = false` na campanha;
 *   4. `OutboundMessage.dryRun = false` na mensagem.
 *
 * As quatro precisam cair juntas. Tres nao bastam.
 */

/**
 * A trava da fase. NAO mudar sem autorizacao explicita do dono do
 * projeto.
 *
 * ============================================================
 * ABERTA — Fase 7, autorizada em 14/08/2026
 * ============================================================
 * Autorizacao dada em conversa, para o primeiro envio real: cinco leads
 * escolhidos a mao, chip dedicado, mensagens revisadas na previa.
 *
 * Esta constante sozinha NAO envia nada. Continuam valendo:
 *
 *   2. `WHATSAPP_MODE=live` no .env
 *   3. `Campaign.dryRun = false` na campanha
 *   4. `OutboundMessage.dryRun = false`, herdado da campanha no
 *      enfileiramento
 *
 * As quatro precisam estar abertas ao mesmo tempo. Tres nao bastam.
 *
 * PARA FECHAR DE NOVO: volte para `false` e reinicie o worker. E o freio
 * mais forte que existe — nao depende de banco nem de configuracao.
 */
export const FASE_PERMITE_ENVIO_REAL = true as boolean;

/** Descreve por que um envio foi simulado, para o log e para a tela. */
export type MotivoSimulacao =
  | 'FASE_BLOQUEIA'
  | 'MODO_GLOBAL'
  | 'CAMPANHA_DRY_RUN'
  | 'MENSAGEM_DRY_RUN';

export interface EntradaGuarda {
  /** `WHATSAPP_MODE` do ambiente. */
  modoGlobal: string | undefined;
  campanhaDryRun: boolean;
  mensagemDryRun: boolean;
}

export interface VeredictoGuarda {
  /** true = nada sai; registra a simulacao. */
  simular: boolean;
  /** Todas as barreiras levantadas, na ordem em que sao avaliadas. */
  motivos: MotivoSimulacao[];
  /** Frase pronta para o log e para a interface. */
  explicacao: string;
}

const TEXTO: Record<MotivoSimulacao, string> = {
  FASE_BLOQUEIA: 'a fase atual não permite envio real',
  MODO_GLOBAL: 'WHATSAPP_MODE não é "live"',
  CAMPANHA_DRY_RUN: 'a campanha está em dry-run',
  MENSAGEM_DRY_RUN: 'a mensagem foi marcada como dry-run',
};

/**
 * Decide se o envio e simulado e explica por que.
 *
 * Funcao pura, sem I/O: da para testar a regra mais critica do sistema
 * sem banco, sem fila e sem WhatsApp.
 *
 * Acumula TODOS os motivos em vez de parar no primeiro. Saber que tres
 * barreiras estao levantadas, e nao uma, e o que evita alguem baixar uma
 * so e achar que liberou o envio.
 */
export function avaliarGuardaEnvio(entrada: EntradaGuarda): VeredictoGuarda {
  const motivos: MotivoSimulacao[] = [];

  if (!FASE_PERMITE_ENVIO_REAL) motivos.push('FASE_BLOQUEIA');
  if (entrada.modoGlobal?.trim().toLowerCase() !== 'live') motivos.push('MODO_GLOBAL');
  if (entrada.campanhaDryRun) motivos.push('CAMPANHA_DRY_RUN');
  if (entrada.mensagemDryRun) motivos.push('MENSAGEM_DRY_RUN');

  return {
    simular: motivos.length > 0,
    motivos,
    explicacao:
      motivos.length === 0
        ? 'todas as barreiras estão baixas — o envio é real'
        : `Simulado porque ${motivos.map((m) => TEXTO[m]).join('; ')}.`,
  };
}

/**
 * Erro lancado quando algo tenta enviar de verdade com a fase travada.
 *
 * Falhar alto e melhor do que simular em silencio: simular em silencio
 * faria voce achar que enviou mensagens que nunca sairam.
 */
export class EnvioRealBloqueadoError extends Error {
  constructor(detalhe: string) {
    super(
      `Envio real bloqueado pela guarda de fase: ${detalhe}. ` +
        'Ligar o envio real exige editar FASE_PERMITE_ENVIO_REAL em ' +
        'packages/integrations/src/whatsapp/guarda-envio.ts, o que é um ' +
        'commit deliberado — não uma mudança de configuração.'
    );
    this.name = 'EnvioRealBloqueadoError';
  }
}

/**
 * Ultima verificacao, imediatamente antes de tocar a biblioteca.
 *
 * O adapter chama isto no caminho de envio real. Mesmo que toda a
 * logica anterior tenha decidido errado, aqui a chamada morre.
 */
export function exigirPermissaoDeEnvioReal(contexto: string): void {
  if (!FASE_PERMITE_ENVIO_REAL) {
    throw new EnvioRealBloqueadoError(contexto);
  }
}
