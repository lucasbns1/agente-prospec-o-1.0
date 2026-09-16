/**
 * A trava que impede a credencial morta de renascer.
 *
 * ============================================================
 * O DEFEITO QUE ISTO CONSERTA
 * ============================================================
 * Numa sessao invalidada (401) o sistema apaga a credencial para que o
 * WhatsApp volte a pedir QR. O log de uso real mostrou os dois passos
 * acontecendo e o resultado errado:
 *
 *   Credencial invalida removida   arquivos: 1448
 *   ...
 *   "node":{"username":"5511968662120",...},"msg":"logging in..."
 *
 * Apagou 1448 arquivos e, em seguida, entrou logando com a MESMA conta
 * em vez de pedir codigo. Quem apaga a credencial e ve um login nao
 * apagou credencial nenhuma: ela estava de volta no disco.
 *
 * Quem a trouxe de volta foi o socket ANTIGO. Ele continua vivo durante
 * o encerramento e ainda emite `creds.update`; o ouvinte desse evento
 * chama `saveCreds`, que grava em disco o estado que esta em MEMORIA —
 * a credencial morta. A remocao acontece, e um evento atrasado desfaz.
 *
 * O ciclo fechava: credencial invalida no disco -> login -> 401 ->
 * apaga -> socket antigo regrava -> login -> 401. Cinco vezes, e
 * "Falhou". Reiniciar nao resolvia, porque o arquivo estava la de novo.
 *
 * ============================================================
 * A REGRA
 * ============================================================
 * Entre "decidi apagar" e "a credencial nova foi lida do zero", NINGUEM
 * grava credencial. A trava e fechada antes de apagar e so reabre com a
 * funcao de gravar NOVA em maos — a do estado recem-carregado.
 *
 * Reabrir com a funcao antiga seria o mesmo defeito com mais passos:
 * `saveCreds` carrega consigo o estado que leu, e o antigo carrega o
 * que ja nao vale.
 */

export type Gravador = () => Promise<void>;

export interface GuardaCredencial {
  /**
   * Grava, se estiver liberada. Devolve o que aconteceu — o chamador
   * costuma querer registrar quando um evento atrasado foi barrado.
   */
  gravar(): Promise<'gravou' | 'bloqueado' | 'falhou'>;
  /** Fecha a trava. Chamado ANTES de apagar os arquivos. */
  travar(): void;
  /** Reabre, obrigatoriamente com o gravador do estado novo. */
  liberar(gravadorNovo: Gravador): void;
  readonly travada: boolean;
}

export function criarGuardaCredencial(gravador: Gravador): GuardaCredencial {
  let atual = gravador;
  let travada = false;

  return {
    get travada() {
      return travada;
    },

    travar() {
      travada = true;
    },

    liberar(gravadorNovo: Gravador) {
      atual = gravadorNovo;
      travada = false;
    },

    async gravar() {
      if (travada) return 'bloqueado';
      try {
        await atual();
        return 'gravou';
      } catch {
        // Falhar ao gravar credencial nao pode derrubar a conexao: o
        // Baileys emite `creds.update` com frequencia, e a proxima
        // emissao grava de novo.
        return 'falhou';
      }
    },
  };
}
