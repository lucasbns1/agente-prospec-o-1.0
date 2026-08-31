/**
 * Eventos internos do canal.
 *
 * ============================================================
 * POR QUE TRADUZIR OS EVENTOS DA BIBLIOTECA
 * ============================================================
 * O `whatsapp-web.js` emite `qr`, `authenticated`, `ready`,
 * `auth_failure`, `disconnected`, `message`, `message_ack`. Se o resto do
 * sistema escutasse esses nomes direto, trocar de biblioteca (ou
 * sobreviver a uma versao que renomeia um evento) viraria uma caca a
 * strings espalhadas pelo worker, pela API e pelo frontend.
 *
 * O adapter traduz para os nomes daqui, e so ele conhece o vocabulario
 * da biblioteca. E o mesmo motivo pelo qual `whatsapp-web.js` so pode
 * ser importado dentro de `whatsapp-web-adapter.ts`.
 */
import type { WhatsAppStatus } from '@prospector/shared';

export type TipoEventoCanal =
  | 'canal.status'
  | 'canal.qr'
  | 'canal.pronto'
  | 'canal.autenticado'
  | 'canal.falha_autenticacao'
  | 'canal.desconectado'
  | 'canal.mensagem_recebida'
  | 'canal.confirmacao_entrega';

/** Mensagem recebida, ja traduzida para o vocabulario do sistema. */
export interface MensagemEntrada {
  /** ID no provedor. E a chave de idempotencia do recebimento. */
  providerMessageId: string;
  chatId: string;
  /** E.164 sem "+", ex: "5519999998888". */
  telefone: string;
  texto: string;
  nomeContato: string | null;
  recebidaEm: Date;
  /** true quando a mensagem foi enviada por nos (eco do proprio envio). */
  deMim: boolean;
  /** Tipo bruto do provedor: "chat", "image", "audio"... */
  tipo: string;
  /** true para midia — o texto pode estar vazio ou ser so a legenda. */
  temMidia: boolean;
  /**
   * A mensagem veio da VARREDURA e ja e passado.
   *
   * ============================================================
   * POR QUE ISTO EXISTE
   * ============================================================
   * A varredura recupera tambem mensagens SUAS, digitadas no celular.
   * Ao vivo, uma mensagem sua PAUSA a automacao daquele lead — voce
   * entrou na conversa, o robo sai.
   *
   * Aplicar isso a uma mensagem de tres dias atras pausaria HOJE uma
   * conversa por causa de algo que ja aconteceu, e o lead ficaria
   * travado esperando uma decisao que voce tomou na sexta-feira.
   *
   * Com esta marca, a mensagem entra no historico e no contexto da IA —
   * que e o valor dela — sem mexer no presente.
   *
   * O caminho ao vivo NUNCA passa isto: quem marca e so a varredura, e
   * so para o que e mais velho que a folga.
   */
  historica?: boolean;
}

export interface EventoCanal {
  tipo: TipoEventoCanal;
  em: Date;
  status?: WhatsAppStatus;
  /** Data URL do QR. Nunca persistido. */
  qr?: string;
  telefone?: string;
  motivo?: string;
  mensagem?: MensagemEntrada;
  /** Para confirmacao de entrega. */
  providerMessageId?: string;
  ack?: number;
}

export type OuvinteCanal = (evento: EventoCanal) => void | Promise<void>;

/**
 * Barramento minimo, sincrono, em memoria.
 *
 * Nao usa EventEmitter do Node de proposito: aqui interessa que uma
 * falha em um ouvinte NAO derrube os outros nem o adapter. O
 * EventEmitter propaga a excecao e, num handler `error` ausente, derruba
 * o processo — o que num worker que segura a sessao do WhatsApp
 * significaria perder a conexao por causa de um bug de logging.
 */
export class BarramentoCanal {
  private ouvintes: OuvinteCanal[] = [];

  constructor(
    private readonly aoFalhar: (erro: unknown, evento: EventoCanal) => void = () => {}
  ) {}

  ouvir(ouvinte: OuvinteCanal): () => void {
    this.ouvintes.push(ouvinte);
    return () => {
      this.ouvintes = this.ouvintes.filter((o) => o !== ouvinte);
    };
  }

  async publicar(evento: EventoCanal): Promise<void> {
    for (const ouvinte of this.ouvintes) {
      try {
        await ouvinte(evento);
      } catch (erro) {
        this.aoFalhar(erro, evento);
      }
    }
  }

  get totalOuvintes(): number {
    return this.ouvintes.length;
  }
}
