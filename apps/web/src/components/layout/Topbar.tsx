import { Bell, LogOut, FlaskConical } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
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

        <Button variant="fantasma" size="icone" aria-label="Notificações">
          <Bell className="h-4 w-4" aria-hidden="true" />
        </Button>

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
