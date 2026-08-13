import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, LogOut, FlaskConical, CheckCheck } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { Button, Badge } from '@/components/ui/primitives';
import { useLogout, type Usuario } from '@/hooks/useAuth';
import type { StatusConexaoSSE } from '@/hooks/useEvents';

interface StatusWhatsApp {
  status: string;
  modo: string;
  dryRun: boolean;
  detalhe: string;
}

/** 🟢 conectado | 🟡 conectando | 🔴 desconectado — requisito 23. */
function IndicadorWhatsApp({ status }: { status: string }) {
  const mapa: Record<string, { cor: string; rotulo: string }> = {
    CONECTADO: { cor: 'bg-[var(--color-sucesso)]', rotulo: 'WhatsApp conectado' },
    CONECTANDO: { cor: 'bg-[var(--color-morno)]', rotulo: 'Conectando' },
    AGUARDANDO_QR: { cor: 'bg-[var(--color-morno)]', rotulo: 'Aguardando QR Code' },
    DESCONECTADO: { cor: 'bg-[var(--color-alerta)]', rotulo: 'WhatsApp desconectado' },
    ERRO: { cor: 'bg-[var(--color-alerta)]', rotulo: 'Erro no WhatsApp' },
  };
  const item = mapa[status] ?? mapa.DESCONECTADO!;

  return (
    <div
      className="flex items-center gap-2 text-xs text-[var(--color-texto-suave)]"
      role="status"
      aria-live="polite"
    >
      <span className={`h-2 w-2 rounded-full ${item.cor}`} aria-hidden="true" />
      {item.rotulo}
    </div>
  );
}

interface Notificacao {
  id: string;
  tipo: string;
  nivel: string;
  titulo: string;
  mensagem: string;
  link: string | null;
  lida: boolean;
  createdAt: string;
}

/**
 * Sino de notificacoes.
 *
 * A lista ja vem ordenada por PRIORIDADE do servidor — uma intervencao
 * necessaria aparece antes de uma importacao concluida, mesmo que a
 * importacao seja mais recente.
 */
function SinoNotificacoes() {
  const [aberto, setAberto] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['notificacoes'],
    queryFn: () =>
      get<{ notificacoes: Notificacao[]; naoLidas: number }>(
        '/api/notifications?limite=20'
      ),
  });

  const invalidar = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['notificacoes'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const marcarLida = useMutation({
    mutationFn: (id: string) => post(`/api/notifications/${id}/read`),
    onSuccess: invalidar,
  });

  const marcarTodas = useMutation({
    mutationFn: () => post('/api/notifications/read-all'),
    onSuccess: invalidar,
  });

  const naoLidas = data?.naoLidas ?? 0;

  return (
    <div className="relative">
      <Button
        variant="fantasma"
        size="icone"
        aria-label={`Notificações${naoLidas > 0 ? ` (${naoLidas} não lidas)` : ''}`}
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {naoLidas > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-alerta)] px-1 text-[10px] font-semibold text-white">
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </Button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-xl border border-[var(--color-borda)] bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-[var(--color-borda)] px-4 py-2 text-sm font-medium">
              Notificações
              {naoLidas > 0 && (
                <Button
                  variant="fantasma"
                  size="sm"
                  aria-label="Marcar todas como lidas"
                  disabled={marcarTodas.isPending}
                  onClick={() => marcarTodas.mutate()}
                >
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {(data?.notificacoes.length ?? 0) === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-[var(--color-texto-suave)]">
                  Nenhuma notificação.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--color-borda)]">
                  {data?.notificacoes.map((n) => (
                    <li
                      key={n.id}
                      className={`px-4 py-2.5 ${n.lida ? 'opacity-60' : ''}`}
                    >
                      {/* Clicar marca como lida. Antes o sino so exibia:
                          o contador nunca zerava e a lista virava um mural
                          que ninguem conseguia limpar. */}
                      <button
                        type="button"
                        className="w-full text-left"
                        disabled={n.lida || marcarLida.isPending}
                        onClick={() => marcarLida.mutate(n.id)}
                      >
                        <div className="text-sm font-medium">{n.titulo}</div>
                        <div className="text-xs text-[var(--color-texto-suave)]">
                          {n.mensagem}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Link
              to="/notificacoes"
              onClick={() => setAberto(false)}
              className="block border-t border-[var(--color-borda)] px-4 py-2.5 text-center text-xs text-[var(--color-texto-suave)] hover:bg-[var(--color-fundo)] hover:text-[var(--color-texto)]"
            >
              Ver todas
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export function Topbar({
  usuario,
  statusSSE,
}: {
  usuario: Usuario;
  statusSSE: StatusConexaoSSE;
}) {
  const logout = useLogout();

  const { data: whatsapp } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => get<StatusWhatsApp>('/api/whatsapp/status'),
    refetchInterval: 30_000,
  });

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-borda)] bg-white px-5">
      <div className="flex items-center gap-4">
        <IndicadorWhatsApp status={whatsapp?.status ?? 'DESCONECTADO'} />

        {/* A faixa de dry-run fica sempre visivel enquanto o modo estiver
            ativo. E a diferenca entre "testei o fluxo" e "mandei mensagem
            para 76 pessoas sem querer". */}
        {whatsapp?.dryRun && (
          <Badge variant="info" title={whatsapp.detalhe}>
            <FlaskConical className="h-3 w-3" aria-hidden="true" />
            MODO SIMULAÇÃO — nada é enviado
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span
          className="text-[11px] text-[var(--color-texto-fraco)]"
          title="Conexão de tempo real com o servidor"
        >
          {statusSSE === 'conectado' ? 'tempo real ativo' : 'reconectando…'}
        </span>

        <SinoNotificacoes />

        <div className="mx-1 flex items-center gap-2 border-l border-[var(--color-borda)] pl-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-fundo)] text-[11px] font-semibold text-[var(--color-texto-suave)]">
            {usuario.nome.charAt(0).toUpperCase()}
          </div>
          <span className="hidden text-sm text-[var(--color-texto-suave)] sm:inline">
            {usuario.nome}
          </span>
        </div>

        <Button
          variant="fantasma"
          size="icone"
          aria-label="Sair"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}
