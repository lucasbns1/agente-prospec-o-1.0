/**
 * Estado das campanhas — a lista, com as acoes de cada uma.
 *
 * Diferente de /campanhas, que e onde a campanha e CRIADA e CONFIGURADA.
 * Esta tela e para acompanhar: quantas estao rodando, quantos leads
 * esperando voce, e o atalho para o quadro.
 */
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  KanbanSquare, Loader2, Play, Pause, Settings2, Eye, Rocket,
  AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { get, post, ApiError } from '@/lib/api';
import {
  Button, Card, CardContent, Badge,
} from '@/components/ui/primitives';
import { MenuAcoes } from '@/components/campanha/MenuAcoes';
import { formatarNumero, formatarDataHora } from '@/lib/utils';
import { varianteStatus, rotuloStatusCampanha } from '@/pages/Campanhas';

interface CampanhaLinha {
  id: string;
  nome: string;
  descricao: string | null;
  status: string;
  dryRun: boolean;
  totalEtapas: number;
  totalNaFila: number;
  agendadas: number;
  simuladas: number;
  enviadas: number;
  respostas: number;
  createdAt: string;
}

export function EstadoCampanhas() {
  const navegar = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['campanhas'],
    queryFn: () => get<{ campanhas: CampanhaLinha[] }>('/api/campaigns'),
  });

  const mudarStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      post(`/api/campaigns/${id}/status`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campanhas'] });
    },
  });

  const campanhas = data?.campanhas ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Estado das campanhas
        </h1>
        <p className="mt-0.5 text-sm text-[var(--color-texto-suave)]">
          Onde cada lead parou, e quem está esperando por você.
        </p>
      </div>

      {mudarStatus.error && (
        <p className="rounded-xl border border-[var(--color-borda)] bg-[var(--color-alerta-bg)] px-4 py-3 text-sm text-[var(--color-alerta)]">
          {mudarStatus.error instanceof ApiError
            ? mudarStatus.error.message
            : 'Não foi possível mudar o status'}
        </p>
      )}

      {isLoading && (
        <p className="flex items-center gap-2 py-10 text-sm text-[var(--color-texto-suave)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Carregando…
        </p>
      )}

      {error && (
        <p className="text-sm text-[var(--color-alerta)]">
          Não foi possível carregar as campanhas.
        </p>
      )}

      {!isLoading && campanhas.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Rocket
              className="h-8 w-8 text-[var(--color-texto-fraco)]"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium">Nenhuma campanha ainda</p>
              <p className="mt-0.5 text-sm text-[var(--color-texto-suave)]">
                O quadro aparece assim que você criar a primeira.
              </p>
            </div>
            <Button onClick={() => navegar('/campanhas')}>
              Criar campanha
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {campanhas.map((c) => {
          const ativa = c.status === 'ATIVA';
          const semEtapa = c.totalEtapas === 0;

          return (
            <Card key={c.id}>
              <CardContent className="flex items-start justify-between gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/estado/${c.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {c.nome}
                    </Link>
                    <Badge variant={varianteStatus(c.status)}>
                      {rotuloStatusCampanha(c.status)}
                    </Badge>
                    {c.dryRun && <Badge variant="neutro">simulação</Badge>}
                  </div>

                  {c.descricao && (
                    <p className="mt-1 truncate text-sm text-[var(--color-texto-suave)]">
                      {c.descricao}
                    </p>
                  )}

                  <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-texto-suave)]">
                    <div className="flex gap-1.5">
                      <dt>Etapas</dt>
                      <dd className="font-medium text-[var(--color-texto)]">
                        {c.totalEtapas}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>Na fila</dt>
                      <dd className="font-medium text-[var(--color-texto)]">
                        {formatarNumero(c.totalNaFila)}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>Simuladas</dt>
                      <dd className="font-medium text-[var(--color-texto)]">
                        {formatarNumero(c.simuladas)}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>Respostas</dt>
                      <dd className="font-medium text-[var(--color-texto)]">
                        {formatarNumero(c.respostas)}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>Criada</dt>
                      <dd>{formatarDataHora(c.createdAt)}</dd>
                    </div>
                  </dl>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="secundario"
                    size="sm"
                    onClick={() => navegar(`/estado/${c.id}`)}
                  >
                    <KanbanSquare className="h-4 w-4" aria-hidden="true" />
                    Ver quadro
                  </Button>

                  <MenuAcoes
                    rotuloAcessivel={`Ações da campanha ${c.nome}`}
                    acoes={[
                      {
                        rotulo: 'Abrir quadro',
                        icone: KanbanSquare,
                        aoClicar: () => navegar(`/estado/${c.id}`),
                      },
                      {
                        rotulo: 'Editar etapas e filtros',
                        icone: Settings2,
                        aoClicar: () => navegar(`/campanhas/${c.id}`),
                      },
                      {
                        rotulo: 'Ver a prévia das mensagens',
                        icone: Eye,
                        aoClicar: () => navegar(`/campanhas/${c.id}`),
                      },
                      ativa
                        ? {
                            rotulo: 'Pausar',
                            icone: Pause,
                            ajuda: 'Cancela o que ainda não saiu da fila',
                            destrutiva: true,
                            aoClicar: () =>
                              mudarStatus.mutate({
                                id: c.id,
                                status: 'PAUSADA',
                              }),
                          }
                        : {
                            rotulo: 'Ativar',
                            icone: Play,
                            // Ativar sem etapa geraria 422 na API. Melhor
                            // dizer o motivo aqui do que deixar clicar e
                            // devolver erro.
                            desabilitada: semEtapa,
                            ajuda: semEtapa
                              ? 'Crie ao menos uma etapa antes'
                              : undefined,
                            aoClicar: () =>
                              mudarStatus.mutate({ id: c.id, status: 'ATIVA' }),
                          },
                    ]}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="flex items-start gap-2 text-xs text-[var(--color-texto-suave)]">
        {campanhas.some((c) => c.status === 'ATIVA') ? (
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        Pausar cancela as mensagens que ainda não saíram daquela campanha. As
        que já foram entregues não voltam atrás.
      </p>
    </div>
  );
}
