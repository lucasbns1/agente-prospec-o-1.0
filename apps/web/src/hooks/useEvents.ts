/**
 * Consumo do canal SSE.
 *
 * Uma unica conexao EventSource para o app inteiro. Ao receber um evento,
 * invalidamos as queries afetadas e o TanStack Query recarrega sozinho —
 * e assim que o Dashboard "se move" quando chega uma resposta, sem
 * polling e sem WebSocket.
 *
 * O EventSource ja reconecta sozinho quando a conexao cai; nao precisamos
 * implementar retry manual.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AppEvent, EventType } from '@prospector/shared';

/** Quais queries recarregar para cada tipo de evento. */
const INVALIDACOES: Partial<Record<EventType, string[][]>> = {
  'lead.criado': [['dashboard'], ['leads']],
  'lead.atualizado': [['dashboard'], ['leads']],
  'lead.temperatura_alterada': [['dashboard'], ['leads']],
  'lead.status_alterado': [['dashboard'], ['leads']],
  'mensagem.enviada': [['dashboard'], ['conversas']],
  'mensagem.simulada': [['dashboard'], ['conversas']],
  'mensagem.recebida': [['dashboard'], ['conversas'], ['leads']],
  'mensagem.falhou': [['dashboard'], ['conversas']],
  'campanha.iniciada': [['dashboard'], ['campanhas']],
  'campanha.pausada': [['dashboard'], ['campanhas']],
  'campanha.concluida': [['dashboard'], ['campanhas']],
  'tarefa.criada': [['dashboard'], ['tarefas']],
  'tarefa.concluida': [['dashboard'], ['tarefas']],
  'notificacao.criada': [['notificacoes'], ['dashboard']],
  'importacao.concluida': [['dashboard'], ['leads'], ['importacoes']],
  'whatsapp.status': [['whatsapp-status'], ['dashboard']],
  'dashboard.atualizar': [['dashboard']],
};

export type StatusConexaoSSE = 'conectando' | 'conectado' | 'desconectado';

export function useEvents(habilitado: boolean): {
  status: StatusConexaoSSE;
  ultimoEvento: AppEvent | null;
} {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusConexaoSSE>('conectando');
  const [ultimoEvento, setUltimoEvento] = useState<AppEvent | null>(null);
  const fonteRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!habilitado) {
      fonteRef.current?.close();
      fonteRef.current = null;
      setStatus('desconectado');
      return;
    }

    const fonte = new EventSource('/api/events', { withCredentials: true });
    fonteRef.current = fonte;

    fonte.onopen = () => setStatus('conectado');
    fonte.onerror = () => setStatus('desconectado');

    const tratar = (e: MessageEvent<string>): void => {
      try {
        const evento = JSON.parse(e.data) as AppEvent;
        setUltimoEvento(evento);
        setStatus('conectado');

        for (const chave of INVALIDACOES[evento.tipo] ?? []) {
          void queryClient.invalidateQueries({ queryKey: chave });
        }
      } catch {
        // Evento malformado: ignorar em silencio seria errado, mas
        // derrubar a conexao por causa dele seria pior.
        console.warn('[SSE] evento invalido recebido');
      }
    };

    // O servidor nomeia cada evento; precisamos registrar um listener por
    // tipo, alem do `onmessage` genérico.
    for (const tipo of Object.keys(INVALIDACOES) as EventType[]) {
      fonte.addEventListener(tipo, tratar as EventListener);
    }
    fonte.addEventListener('heartbeat', tratar as EventListener);
    fonte.onmessage = tratar;

    return () => {
      fonte.close();
      fonteRef.current = null;
    };
  }, [habilitado, queryClient]);

  return { status, ultimoEvento };
}
