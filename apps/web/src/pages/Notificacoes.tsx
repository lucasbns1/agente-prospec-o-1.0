/**
 * Notificacoes — o historico do que o sistema quis te contar.
 *
 * A lista vem ordenada por PRIORIDADE, nao por data: uma intervencao
 * necessaria de ontem importa mais que uma importacao concluida agora.
 * Essa ordem e decidida no servidor, numa coluna indexada.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Check, Loader2, CheckCheck, X, Trash2 } from 'lucide-react';
import { get, post, del } from '@/lib/api';
import {
  Button, Card, CardContent, Badge,
} from '@/components/ui/primitives';
import { formatarDataHora, cn } from '@/lib/utils';
import { LeadDetalhe } from '@/components/LeadDetalhe';

interface Notificacao {
  id: string;
  tipo: string;
  nivel: string;
  titulo: string;
  mensagem: string;
  link: string | null;
  lida: boolean;
  createdAt: string;
  leadId: string | null;
  lead: { id: string; nomeCompleto: string | null; temperatura: string } | null;
}

function varianteNivel(nivel: string): 'alerta' | 'morno' | 'sucesso' | 'info' {
  if (nivel === 'ERRO') return 'alerta';
  if (nivel === 'ALERTA') return 'morno';
  if (nivel === 'SUCESSO') return 'sucesso';
  return 'info';
}

function humanizar(v: string): string {
  return v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
}

export function Notificacoes() {
  const queryClient = useQueryClient();
  const [apenasNaoLidas, setApenasNaoLidas] = useState(false);
  const [leadAberto, setLeadAberto] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['notificacoes', apenasNaoLidas],
    queryFn: () =>
      get<{ notificacoes: Notificacao[]; naoLidas: number }>(
        `/api/notifications?limite=100${apenasNaoLidas ? '&apenasNaoLidas=true' : ''}`
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
    mutationFn: () => post<{ marcadas: number }>('/api/notifications/read-all'),
    onSuccess: invalidar,
  });

  // Apagar e diferente de marcar como lida. "Lida" e "eu vi"; apagar e
  // "isto nao me serve". Sem esta acao, a unica saida era marcar como
  // lida e conviver com a lista crescendo para sempre.
  //
  // Apagar NAO destrava o lead: se ele aguarda intervencao, continua
  // aguardando. Quem retoma a cadencia e o botao de liberar, na tela
  // dele — um "apagar" que tambem retomasse mandaria mensagem para um
  // cliente seu como efeito colateral de limpar a caixa de avisos.
  const apagar = useMutation({
    mutationFn: (id: string) => del(`/api/notifications/${id}`),
    onSuccess: invalidar,
  });

  const apagarLidas = useMutation({
    mutationFn: () => del<{ apagadas: number }>('/api/notifications/lidas'),
    onSuccess: invalidar,
  });

  const notificacoes = data?.notificacoes ?? [];
  const naoLidas = data?.naoLidas ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Notificações</h1>
          <p className="text-sm text-[var(--color-texto-suave)]">
            Ordenadas por urgência, não por data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secundario"
            size="sm"
            aria-pressed={apenasNaoLidas}
            onClick={() => setApenasNaoLidas((v) => !v)}
          >
            {apenasNaoLidas ? 'Mostrando não lidas' : 'Mostrando todas'}
          </Button>
          <Button
            size="sm"
            disabled={naoLidas === 0 || marcarTodas.isPending}
            onClick={() => marcarTodas.mutate()}
          >
            {marcarTodas.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
            )}
            Marcar todas como lidas
          </Button>
          <Button
            variant="secundario"
            size="sm"
            disabled={apagarLidas.isPending}
            onClick={() => apagarLidas.mutate()}
            title="Some com o que você já leu. Não toca no que está por ler."
          >
            {apagarLidas.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            )}
            Apagar as lidas
          </Button>
        </div>
      </div>

      {naoLidas > 0 && (
        <p className="text-sm text-[var(--color-texto-suave)]">
          <strong>{naoLidas}</strong> não lida(s).
        </p>
      )}

      {isLoading && (
        <Card>
          <CardContent className="flex items-center gap-2 py-10 text-sm text-[var(--color-texto-suave)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Carregando…
          </CardContent>
        </Card>
      )}

      {!isLoading && notificacoes.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <BellOff
              className="h-8 w-8 text-[var(--color-texto-fraco)]"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">
              {apenasNaoLidas ? 'Nada não lido' : 'Nenhuma notificação'}
            </p>
            <p className="text-sm text-[var(--color-texto-suave)]">
              O sistema avisa aqui quando um lead fica quente, quando não
              entende uma resposta e quando um envio falha.
            </p>
          </CardContent>
        </Card>
      )}

      {notificacoes.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-[var(--color-borda)]">
              {notificacoes.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    'flex items-start gap-3 px-5 py-4',
                    n.lida && 'opacity-60'
                  )}
                >
                  <Bell
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-texto-fraco)]"
                    aria-hidden="true"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{n.titulo}</p>
                      <Badge variant={varianteNivel(n.nivel)}>
                        {humanizar(n.tipo)}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-[var(--color-texto-suave)]">
                      {n.mensagem}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-[var(--color-texto-fraco)]">
                      <span>{formatarDataHora(n.createdAt)}</span>
                      {n.leadId && (
                        <button
                          type="button"
                          className="underline hover:text-[var(--color-texto)]"
                          onClick={() => setLeadAberto(n.leadId!)}
                        >
                          {n.lead?.nomeCompleto ?? 'abrir lead'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {!n.lida && (
                      <Button
                        variant="fantasma"
                        size="icone"
                        aria-label={`Marcar "${n.titulo}" como lida`}
                        disabled={marcarLida.isPending}
                        onClick={() => marcarLida.mutate(n.id)}
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                    <Button
                      variant="fantasma"
                      size="icone"
                      aria-label={`Apagar "${n.titulo}"`}
                      title="Apagar esta notificação"
                      disabled={apagar.isPending}
                      onClick={() => apagar.mutate(n.id)}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {leadAberto && (
        <LeadDetalhe leadId={leadAberto} onFechar={() => setLeadAberto(null)} />
      )}
    </div>
  );
}
