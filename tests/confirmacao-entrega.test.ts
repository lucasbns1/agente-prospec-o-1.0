/**
 * Confirmacao de entrega (message_ack).
 *
 * ============================================================
 * O QUE ESTES TESTES PROTEGEM
 * ============================================================
 * "aceito pelo adapter", "entregue" e "lido" sao coisas diferentes.
 * Trata-las como a mesma coisa faz o painel dizer que voce falou com 50
 * pessoas quando 12 estao com o celular desligado e 3 bloquearam o
 * numero.
 *
 * E os acks chegam FORA DE ORDEM e REPETIDOS — nao como excecao, mas
 * como comportamento normal do provedor.
 */
import { describe, expect, it } from 'vitest';
import {
  traduzirAck,
  avaliarAck,
  estadoDeStatus,
  type EstadoEntrega,
} from '../packages/domain/src/inbound/confirmacao-entrega.js';

describe('traduzirAck — os códigos do provedor', () => {
  it('mapeia os cinco estados', () => {
    expect(traduzirAck(-1)).toBe('FALHOU');
    expect(traduzirAck(0)).toBe('PENDENTE');
    expect(traduzirAck(1)).toBe('ENVIADA');
    expect(traduzirAck(2)).toBe('ENTREGUE');
    expect(traduzirAck(3)).toBe('LIDA');
  });

  it('áudio ouvido conta como lida — não há estado além', () => {
    expect(traduzirAck(4)).toBe('LIDA');
  });

  it('código desconhecido devolve null em vez de chutar', () => {
    expect(traduzirAck(99)).toBeNull();
    expect(traduzirAck(7)).toBeNull();
  });

  /**
   * O ack 1 (SERVER) significa que o servidor do WhatsApp aceitou — NAO
   * que chegou no aparelho. Confundir os dois e o erro que faz o painel
   * dizer "entregue" para quem esta com o celular desligado.
   */
  it('SERVER é ENVIADA, não ENTREGUE', () => {
    expect(traduzirAck(1)).toBe('ENVIADA');
    expect(traduzirAck(1)).not.toBe('ENTREGUE');
  });
});

describe('avaliarAck — progresso', () => {
  it('avança de sem-estado para ENVIADA', () => {
    const r = avaliarAck(null, 1);
    expect(r.aplicar).toBe(true);
    expect(r.novoEstado).toBe('ENVIADA');
    expect(r.statusMensagem).toBe('ENVIADA');
  });

  it('avança ENVIADA → ENTREGUE → LIDA', () => {
    expect(avaliarAck('ENVIADA', 2).novoEstado).toBe('ENTREGUE');
    expect(avaliarAck('ENTREGUE', 3).novoEstado).toBe('LIDA');
  });

  it('pula estados sem reclamar — o intermediário pode nunca chegar', () => {
    const r = avaliarAck('ENVIADA', 3);
    expect(r.aplicar).toBe(true);
    expect(r.novoEstado).toBe('LIDA');
  });
});

describe('avaliarAck — fora de ordem', () => {
  /**
   * O caso que quebra o historico: o ack de "servidor recebeu" chega
   * DEPOIS do de "lida". Aplicar o ultimo que chegou faria a mensagem
   * "desler", e as metricas de leitura mentiriam junto.
   */
  it('não retrocede de LIDA para ENVIADA', () => {
    const r = avaliarAck('LIDA', 1);
    expect(r.aplicar).toBe(false);
    expect(r.motivo).toMatch(/fora de ordem/);
  });

  it('não retrocede de ENTREGUE para ENVIADA', () => {
    expect(avaliarAck('ENTREGUE', 1).aplicar).toBe(false);
  });

  it('não retrocede de LIDA para ENTREGUE', () => {
    expect(avaliarAck('LIDA', 2).aplicar).toBe(false);
  });

  it('qualquer ordem de chegada leva ao mesmo estado final', () => {
    const ordens: number[][] = [
      [1, 2, 3],
      [3, 1, 2],
      [2, 3, 1],
      [3, 2, 1],
    ];

    for (const ordem of ordens) {
      let estado: EstadoEntrega | null = null;
      for (const ack of ordem) {
        const r = avaliarAck(estado, ack);
        if (r.aplicar) estado = r.novoEstado;
      }
      // O estado final e sempre o mais avancado que chegou, nao o
      // ultimo a chegar.
      expect(estado, `ordem ${ordem.join(',')}`).toBe('LIDA');
    }
  });
});

describe('avaliarAck — duplicados', () => {
  it('o mesmo ack duas vezes não é aplicado de novo', () => {
    const primeiro = avaliarAck('ENVIADA', 2);
    expect(primeiro.aplicar).toBe(true);

    const repetido = avaliarAck('ENTREGUE', 2);
    expect(repetido.aplicar).toBe(false);
  });

  it('dez entregas do mesmo ack produzem uma transição', () => {
    let estado: EstadoEntrega | null = 'ENVIADA';
    let aplicados = 0;

    for (let i = 0; i < 10; i++) {
      const r = avaliarAck(estado, 3);
      if (r.aplicar) {
        aplicados += 1;
        estado = r.novoEstado;
      }
    }

    expect(aplicados).toBe(1);
    expect(estado).toBe('LIDA');
  });
});

describe('avaliarAck — falha', () => {
  /**
   * FALHOU vence qualquer estado: uma mensagem entregue que depois falha
   * (o numero bloqueou, por exemplo) precisa aparecer como falha.
   */
  it('falha depois de entregue é aplicada', () => {
    const r = avaliarAck('ENTREGUE', -1);
    expect(r.aplicar).toBe(true);
    expect(r.novoEstado).toBe('FALHOU');
  });

  it('falha depois de lida também', () => {
    expect(avaliarAck('LIDA', -1).aplicar).toBe(true);
  });

  it('depois de falha, acks posteriores são ignorados', () => {
    const r = avaliarAck('FALHOU', 3);
    expect(r.aplicar).toBe(false);
    expect(r.motivo).toMatch(/falha/i);
  });

  it('a mesma falha duas vezes não é reaplicada', () => {
    expect(avaliarAck('FALHOU', -1).aplicar).toBe(false);
  });
});

describe('avaliarAck — entrada inválida', () => {
  it('código desconhecido não altera nada', () => {
    const r = avaliarAck('ENVIADA', 42);
    expect(r.aplicar).toBe(false);
    expect(r.motivo).toMatch(/desconhecido/);
  });
});

describe('estadoDeStatus', () => {
  it('traduz os status que participam da entrega', () => {
    expect(estadoDeStatus('ENVIADA')).toBe('ENVIADA');
    expect(estadoDeStatus('ENTREGUE')).toBe('ENTREGUE');
    expect(estadoDeStatus('LIDA')).toBe('LIDA');
    expect(estadoDeStatus('FALHOU')).toBe('FALHOU');
  });

  it('SIMULADA e CANCELADA ficam fora do ciclo de entrega', () => {
    // Uma simulacao nunca chegou a lugar nenhum: nao ha o que confirmar.
    expect(estadoDeStatus('SIMULADA')).toBeNull();
    expect(estadoDeStatus('CANCELADA')).toBeNull();
  });
});
