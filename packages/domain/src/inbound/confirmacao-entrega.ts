/**
 * Confirmacao de entrega (message_ack).
 *
 * ============================================================
 * TRES COISAS DIFERENTES QUE E FACIL CONFUNDIR
 * ============================================================
 *   aceito pelo adapter  = a biblioteca aceitou a chamada
 *   entregue             = chegou no aparelho da pessoa
 *   lido                 = a pessoa abriu
 *
 * Tratar as tres como "enviado" e o erro classico: o painel diz que
 * falou com 50 pessoas quando 12 estao com o celular desligado e 3
 * bloquearam o numero. A diferenca entre ENVIADA e ENTREGUE e a
 * principal pista de que um numero esta sendo bloqueado.
 *
 * Funcao pura: traduz o codigo numerico do provedor e decide se a
 * transicao pode ser aplicada.
 */
import type { MessageStatus } from '@prospector/shared';

/**
 * Codigos do whatsapp-web.js.
 *
 * -1 ERROR | 0 PENDING | 1 SERVER | 2 DEVICE | 3 READ | 4 PLAYED
 */
export type CodigoAck = -1 | 0 | 1 | 2 | 3 | 4;

export type EstadoEntrega = 'FALHOU' | 'PENDENTE' | 'ENVIADA' | 'ENTREGUE' | 'LIDA';

const POR_CODIGO: Record<number, EstadoEntrega> = {
  [-1]: 'FALHOU',
  0: 'PENDENTE',
  // SERVER: o servidor do WhatsApp aceitou. Ainda NAO chegou no aparelho.
  1: 'ENVIADA',
  // DEVICE: chegou no aparelho.
  2: 'ENTREGUE',
  3: 'LIDA',
  // PLAYED (audio ouvido) conta como lida — nao ha estado mais adiante.
  4: 'LIDA',
};

/**
 * Ordem de progresso. Um estado so avanca; nunca retrocede.
 *
 * POR QUE ISSO IMPORTA: os acks chegam FORA DE ORDEM com frequencia. Se
 * um ack de "servidor recebeu" chegar depois do de "lida", aplicar o
 * ultimo que chegou faria a mensagem "desler". O historico do lead
 * passaria a mentir, e as metricas de leitura junto.
 */
const PROGRESSO: Record<EstadoEntrega, number> = {
  FALHOU: -1,
  PENDENTE: 0,
  ENVIADA: 1,
  ENTREGUE: 2,
  LIDA: 3,
};

export function traduzirAck(codigo: number): EstadoEntrega | null {
  return POR_CODIGO[codigo] ?? null;
}

export interface ResultadoAck {
  /** false quando o ack deve ser ignorado. */
  aplicar: boolean;
  novoEstado: EstadoEntrega | null;
  /** Status a gravar em `Message.status`. */
  statusMensagem: MessageStatus | null;
  motivo: string;
}

/**
 * Decide se o ack recebido deve ser aplicado.
 *
 * @param atual  estado ja registrado na mensagem
 * @param codigo codigo bruto do provedor
 */
export function avaliarAck(
  atual: EstadoEntrega | null,
  codigo: number
): ResultadoAck {
  const novo = traduzirAck(codigo);

  if (novo === null) {
    return {
      aplicar: false,
      novoEstado: null,
      statusMensagem: null,
      motivo: `Código de ack desconhecido: ${codigo}`,
    };
  }

  // FALHOU vence qualquer estado: uma mensagem que falhou depois de
  // entregue (numero bloqueou, por exemplo) precisa aparecer como falha.
  if (novo === 'FALHOU') {
    return {
      aplicar: atual !== 'FALHOU',
      novoEstado: 'FALHOU',
      statusMensagem: 'FALHOU',
      motivo: 'Provedor reportou falha',
    };
  }

  if (atual === 'FALHOU') {
    return {
      aplicar: false,
      novoEstado: null,
      statusMensagem: null,
      motivo: 'Mensagem já marcada como falha; ack posterior ignorado',
    };
  }

  const anterior = atual === null ? -Infinity : PROGRESSO[atual];

  if (PROGRESSO[novo] <= anterior) {
    return {
      aplicar: false,
      novoEstado: null,
      statusMensagem: null,
      motivo: `Ack fora de ordem: ${novo} não avança sobre ${atual}`,
    };
  }

  const statusPorEstado: Record<EstadoEntrega, MessageStatus> = {
    FALHOU: 'FALHOU',
    PENDENTE: 'PENDENTE',
    ENVIADA: 'ENVIADA',
    ENTREGUE: 'ENTREGUE',
    LIDA: 'LIDA',
  };

  return {
    aplicar: true,
    novoEstado: novo,
    statusMensagem: statusPorEstado[novo],
    motivo: `${atual ?? 'sem estado'} → ${novo}`,
  };
}

/** Estado atual a partir do que está gravado na mensagem. */
export function estadoDeStatus(status: string): EstadoEntrega | null {
  if (status === 'FALHOU') return 'FALHOU';
  if (status === 'PENDENTE') return 'PENDENTE';
  if (status === 'ENVIADA') return 'ENVIADA';
  if (status === 'ENTREGUE') return 'ENTREGUE';
  if (status === 'LIDA') return 'LIDA';
  // SIMULADA e CANCELADA nao participam do ciclo de entrega.
  return null;
}
