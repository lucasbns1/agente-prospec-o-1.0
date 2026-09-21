/**
 * Enquanto a credencial esta sendo trocada, queda nao e queda.
 *
 * ============================================================
 * O DEFEITO QUE ISTO CONSERTA
 * ============================================================
 * Numa sessao invalidada (401) o provedor apaga a credencial e agenda
 * uma reconexao que RELE o disco — e e essa releitura que faz o
 * WhatsApp pedir QR, porque o socket novo nasce sem credencial.
 *
 * So que, para apagar com seguranca, ele encerra o socket antigo. Esse
 * encerramento dispara um `connection.update` de fechamento, e o
 * tratamento de queda agenda a PROPRIA reconexao — uma que nao rele
 * nada e reusa o estado que ainda esta em memoria: a credencial morta.
 *
 * As duas reconexoes sao agendadas para daqui a um segundo. Quem chegar
 * primeiro decide o destino:
 *
 *   - a nossa: socket sem credencial -> QR na tela;
 *   - a da queda: socket COM a credencial morta -> `logging in...`
 *     com o numero antigo -> 401 -> apaga -> queda -> repete.
 *
 * No log real a segunda ganhava sempre:
 *
 *     Credencial invalida removida   arquivos: 899
 *     "node":{"username":"55119...","msg":"logging in..."}
 *
 * Apagou novecentos arquivos e entrou logando com a conta de novo. O
 * ciclo nunca chegava ao QR, e nenhum botao da tela alcancava isso.
 *
 * ============================================================
 * A REGRA
 * ============================================================
 * Entre "decidi trocar a credencial" e "a conexao nova ja esta de pe",
 * toda queda e ESPERADA — e ignorada. A unica reconexao que vale nesse
 * intervalo e a que nos mesmos agendamos.
 */

export interface ControleDeReinicio {
  /** Comeca a troca. Daqui em diante, queda nao dispara reconexao. */
  comecar(): void;
  /** Terminou — com QR na tela ou com erro. Quedas voltam a valer. */
  terminar(): void;
  /**
   * O tratamento de queda deve agir?
   *
   * `false` enquanto a troca estiver em andamento: agir ali e reconectar
   * com a credencial que estamos justamente descartando.
   */
  devoTratarQueda(): boolean;
  readonly reiniciando: boolean;
}

export function criarControleDeReinicio(): ControleDeReinicio {
  let reiniciando = false;

  return {
    get reiniciando() {
      return reiniciando;
    },
    comecar() {
      reiniciando = true;
    },
    terminar() {
      reiniciando = false;
    },
    devoTratarQueda() {
      return !reiniciando;
    },
  };
}
