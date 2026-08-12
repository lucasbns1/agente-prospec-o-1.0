/**
 * Barramento de eventos em memoria + transporte SSE.
 *
 * Como o sistema e monousuario e roda em uma unica maquina, um
 * EventEmitter em memoria resolve o problema inteiro: a API publica, os
 * clientes SSE conectados recebem. Sem broker, sem dependencia extra.
 *
 * O worker roda em OUTRO processo e por isso nao consegue publicar aqui
 * diretamente. A ponte entre worker e API e feita via Redis pub/sub
 * (`subscribeWorkerEvents` abaixo) — o Redis ja esta no projeto por causa
 * do BullMQ, entao isso nao adiciona nenhuma dependencia nova.
 */
import { EventEmitter } from 'node:events';
import type { AppEvent, EventType } from '@prospector/shared';

/** Canal Redis usado pelo worker para empurrar eventos para a API. */
export const CANAL_EVENTOS = 'prospector:eventos';

class EventsBus extends EventEmitter {
  publicar<T>(tipo: EventType, dados?: T): void {
    const evento: AppEvent<T> = {
      tipo,
      em: new Date().toISOString(),
      ...(dados !== undefined ? { dados } : {}),
    };
    this.emit('evento', evento);
  }

  inscrever(handler: (evento: AppEvent) => void): () => void {
    this.on('evento', handler);
    return () => this.off('evento', handler);
  }
}

export const eventsBus = new EventsBus();

// Cada conexao SSE registra um listener. O limite padrao de 10 do
// EventEmitter dispararia um aviso falso de vazamento com poucas abas
// abertas.
eventsBus.setMaxListeners(50);

/** Serializa um evento no formato exigido pelo protocolo SSE. */
export function formatarSSE(evento: AppEvent): string {
  return `event: ${evento.tipo}\ndata: ${JSON.stringify(evento)}\n\n`;
}
