/**
 * O que fazer quando a conexao cai, por codigo.
 *
 * ============================================================
 * TRES QUEDAS DIFERENTES, TRES REACOES OPOSTAS
 * ============================================================
 * O texto que o WhatsApp manda e quase sempre o mesmo ("Connection
 * Failure"). Quem distingue e o numero — e tratar os tres igual produz
 * estrago de tipos diferentes:
 *
 *   401 — a sessao foi encerrada (aparelho removido no celular, ou
 *         credencial expirada). Reconectar repete a recusa para sempre.
 *         O certo e DESCARTAR a credencial e pedir QR.
 *
 *   403 — a conta esta restrita pelo WhatsApp. Nem QR resolve. Insistir
 *         chama mais atencao ainda.
 *
 *   440 — `connectionReplaced`: outra sessao assumiu ESTE MESMO numero.
 *         A credencial continua valida — apaga-la seria jogar fora uma
 *         sessao boa. E reconectar e pior: a reconexao derruba a outra
 *         sessao, que reconecta e derruba esta, sem fim.
 *
 * O 440 era tratado como queda comum, e o pingue-pongue aconteceu em
 * uso real: conectava uma copia da ferramenta e a outra caia; conectava
 * a outra e a primeira caia. Parecia conflito entre as copias, e o que
 * havia era o mesmo numero em duas sessoes.
 */

export type ReacaoAQueda =
  /** Queda comum: tentar de novo com a mesma credencial. */
  | 'reconectar'
  /** Credencial morta: apagar e pedir QR. */
  | 'descartar-credencial'
  /** Outra sessao assumiu o numero: parar, SEM apagar nada. */
  | 'parar-sessao-assumida';

/** Codigos em que a credencial ja nao vale. */
const CREDENCIAL_MORTA = new Set([401, 403]);

/** `connectionReplaced`: a credencial vale, mas outro a esta usando. */
const SESSAO_ASSUMIDA = 440;

export function reacaoAQueda(codigo: number | null | undefined): ReacaoAQueda {
  if (codigo === SESSAO_ASSUMIDA) return 'parar-sessao-assumida';
  if (typeof codigo === 'number' && CREDENCIAL_MORTA.has(codigo)) {
    return 'descartar-credencial';
  }
  return 'reconectar';
}

/**
 * A frase que explica a queda para quem esta olhando a tela.
 *
 * Ela diz o que FAZER, e nao so o que aconteceu: "Connection Failure"
 * sozinho mandou a pessoa escanear QR tres vezes seguidas num caso em
 * que QR nao tinha nada a ver.
 */
export function explicacaoDaQueda(codigo: number | null | undefined): string | null {
  switch (reacaoAQueda(codigo)) {
    case 'parar-sessao-assumida':
      return (
        'Outra sessão assumiu este número. Isso acontece quando o mesmo ' +
        'WhatsApp é conectado em dois lugares — duas cópias da ferramenta, ' +
        'ou o WhatsApp Web aberto noutro canto. Use um número diferente em ' +
        'cada cópia.'
      );
    case 'descartar-credencial':
      return codigo === 403
        ? 'A conta está restrita pelo WhatsApp. Parear de novo não resolve.'
        : 'A sessão foi encerrada. Abrir nova sessão e ler o QR resolve.';
    default:
      return null;
  }
}
