/**
 * A conversa aberta.
 *
 * Mostra a thread e, junto de cada resposta recebida, COMO o sistema a
 * interpretou: categoria, subtipo e confianca. Sem isso, "por que o
 * sistema fez isso?" nao teria resposta na tela — so no log.
 *
 * ============================================================
 * MENSAGEM SIMULADA NUNCA APARECE COMO ENVIADA
 * ============================================================
 * O sistema esta em dry-run. Uma simulacao mostrada como "enviado" faria
 * voce acreditar que falou com alguem que nunca recebeu nada — o pior
 * erro possivel numa ferramenta de prospeccao.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Bot, Hand, Play, ShieldAlert, FlaskConical, Clock, CheckSquare,
} from 'lucide-react';
import { get, post, ApiError } from '@/lib/api';
import {
  Card, CardContent, CardHeader, CardTitle, Badge, Button,
  variantePorTemperatura,
} from '@/components/ui/primitives';
import { formatarDataHora, cn } from '@/lib/utils';

interface Mensagem {
  id: string;
  direcao: string;
  status: string;
  texto: string;
  categoria: string | null;
  subtipo: string | null;
  confianca: number | null;
  simulada: boolean;
  createdAt: string;
  recebidaEm: string | null;
  enviadaEm: string | null;
  erro: string | null;
}

interface Evento {
  id: string;
  tipo: string;
  descricao: string;
  origem: string;
  createdAt: string;
}

interface RespostaConversa {
  lead: {
    id: string;
    nomeCompleto: string | null;
    empresa: string | null;
    telefone: string | null;
    cidade: string | null;
    categoria: string | null;
    status: string;
    temperatura: string;
    optOut: boolean;
    proximaAcao: string | null;
    campaign: { id: string; nome: string } | null;
    leadCampaigns: Array<{
      status: string;
      campaign: { id: string; nome: string };
      etapaAtual: { id: string; ordem: number; nome: string | null } | null;
    }>;
    tasks: Array<{ id: string; titulo: string; prioridade: string }>;
  };
  mensagens: Mensagem[];
  eventos: Evento[];
  filaPendente: Array<{
    id: string;
    status: string;
    scheduledAt: string | null;
    textoRenderizado: string | null;
    dryRun: boolean;
  }>;
  automacao: { ativa: boolean; motivoParada: string | null };
}

function humanizar(v: string | null): string {
  if (!v) return '—';
  return v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
}

function varianteCategoria(c: string | null): 'sucesso' | 'alerta' | 'morno' | 'info' | 'neutro' {
  if (c === 'POSITIVO' || c === 'INTERESSE') return 'sucesso';
  if (c === 'OPT_OUT' || c === 'NEGATIVO') return 'alerta';
  if (c === 'PRECO' || c === 'FALAR_DEPOIS') return 'morno';
  if (c === 'DUVIDA') return 'info';
  return 'neutro';
}

/** Como cada mensagem se apresenta. Simulada nunca diz "enviada". */
function rotuloEnvio(m: Mensagem): { texto: string; variante: 'info' | 'sucesso' | 'alerta' | 'neutro' } {
  if (m.simulada || m.status === 'SIMULADA') {
    return { texto: 'SIMULAÇÃO DE ENVIO', variante: 'info' };
  }
  if (m.status === 'FALHOU') return { texto: 'Falhou', variante: 'alerta' };
  if (m.direcao === 'ENVIADA') return { texto: 'Enviada', variante: 'sucesso' };
  return { texto: humanizar(m.status), variante: 'neutro' };
}

// ------------------------------------------------------- retomar automacao
function RetomarAutomacao({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);

  const retomar = useMutation({
    mutationFn: () =>
      post<{ jaNaFila: number; campanha: { nome: string } }>(
        `/api/conversas/${leadId}/retomar-automacao`,
        { confirmar: true }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversa', leadId] });
      void queryClient.invalidateQueries({ queryKey: ['conversas'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setConfirmando(false);
    },
  });

  if (!confirmando) {
    return (
      <Button size="sm" onClick={() => setConfirmando(true)}>
        <Play className="h-4 w-4" aria-hidden="true" />
        Retomar automação
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-borda-forte)] bg-[var(--color-fundo)] p-3">
      <p className="text-sm font-medium">Retomar automação deste lead?</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--color-texto-suave)]">
        Isso permitirá que a próxima etapa da cadência seja executada. O
        sistema confere antes se o lead não pediu opt-out, se a campanha
        continua ativa e se já não há mensagem na fila — para não duplicar.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={retomar.isPending} onClick={() => retomar.mutate()}>
          {retomar.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          Confirmar
        </Button>
        <Button variant="secundario" size="sm" onClick={() => setConfirmando(false)}>
          Cancelar
        </Button>
        {retomar.isError && (
          <span className="text-xs text-[var(--color-alerta)]">
            {retomar.error instanceof ApiError
              ? retomar.error.message
              : 'Não foi possível retomar'}
          </span>
        )}
      </div>
      {retomar.isSuccess && (
        <p className="mt-2 text-xs text-[var(--color-sucesso)]">
          Retomada em “{retomar.data.campanha.nome}”.
          {retomar.data.jaNaFila > 0 &&
            ` ${retomar.data.jaNaFila} mensagem(ns) já estavam na fila e foram mantidas.`}
        </p>
      )}
    </div>
  );
}

// --------------------------------------------------------------- conversa
export function Conversa({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['conversa', leadId],
    queryFn: () => get<RespostaConversa>(`/api/conversas/${leadId}`),
  });

  const assumir = useMutation({
    mutationFn: () =>
      post(`/api/leads/${leadId}/status`, {
        status: 'AGUARDANDO_INTERVENCAO',
        motivo: 'Conversa assumida manualmente',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversa', leadId] });
      void queryClient.invalidateQueries({ queryKey: ['conversas'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-16 text-sm text-[var(--color-texto-suave)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Carregando conversa…
        </CardContent>
      </Card>
    );
  }

  const { lead, mensagens, eventos, filaPendente, automacao } = data;
  const vinculo = lead.leadCampaigns[0];

  return (
    <div className="space-y-4">
      {/* ---- cabeçalho ---- */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-[15px]">
                {lead.empresa ?? lead.nomeCompleto ?? 'Sem nome'}
              </CardTitle>
              <p className="mt-0.5 text-xs text-[var(--color-texto-suave)]">
                {[lead.telefone, lead.cidade, lead.categoria]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant={variantePorTemperatura(lead.temperatura)}>
                  {lead.temperatura.toLowerCase()}
                </Badge>
                <Badge variant="neutro">{humanizar(lead.status)}</Badge>
                {lead.optOut && <Badge variant="alerta">opt-out</Badge>}
                {vinculo && (
                  <Badge variant="info">
                    {vinculo.campaign.nome}
                    {vinculo.etapaAtual
                      ? ` · etapa ${vinculo.etapaAtual.ordem}`
                      : ''}
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              {automacao.ativa ? (
                <Button
                  variant="secundario"
                  size="sm"
                  disabled={assumir.isPending}
                  onClick={() => assumir.mutate()}
                >
                  {assumir.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Hand className="h-4 w-4" aria-hidden="true" />
                  )}
                  Assumir conversa
                </Button>
              ) : !lead.optOut ? (
                <RetomarAutomacao leadId={leadId} />
              ) : null}

              <span className="flex items-center gap-1.5 text-[11px] text-[var(--color-texto-suave)]">
                {automacao.ativa ? (
                  <>
                    <Bot className="h-3 w-3" aria-hidden="true" />
                    automação ativa
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                    automação parada
                  </>
                )}
              </span>
            </div>
          </div>

          {!automacao.ativa && automacao.motivoParada && (
            <p className="mt-2 rounded-lg bg-[var(--color-fundo)] px-3 py-2 text-xs text-[var(--color-texto-suave)]">
              {automacao.motivoParada}
            </p>
          )}
        </CardHeader>

        {lead.tasks.length > 0 && (
          <CardContent className="pt-0">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--color-texto-suave)]">
              <CheckSquare className="h-3 w-3" aria-hidden="true" />
              Tarefas abertas
            </p>
            <ul className="space-y-1">
              {lead.tasks.map((t) => (
                <li key={t.id} className="text-xs">
                  {t.titulo}{' '}
                  <Badge variant="neutro">{humanizar(t.prioridade)}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>

      {/* ---- thread ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          {mensagens.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-texto-suave)]">
              Nenhuma mensagem trocada ainda.
            </p>
          ) : (
            <ul className="space-y-3">
              {mensagens.map((m) => {
                const recebida = m.direcao === 'RECEBIDA';
                const rotulo = rotuloEnvio(m);
                return (
                  <li
                    key={m.id}
                    className={cn('flex', recebida ? 'justify-start' : 'justify-end')}
                  >
                    <div className={cn('max-w-[80%] space-y-1', recebida ? '' : 'items-end')}>
                      <div
                        className={cn(
                          'rounded-xl px-3 py-2 text-sm leading-relaxed',
                          recebida
                            ? 'bg-[var(--color-fundo)]'
                            : 'bg-[var(--color-marca)] text-white'
                        )}
                      >
                        {m.texto}
                      </div>

                      <div
                        className={cn(
                          'flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--color-texto-fraco)]',
                          recebida ? '' : 'justify-end'
                        )}
                      >
                        <span>
                          {formatarDataHora(m.recebidaEm ?? m.enviadaEm ?? m.createdAt)}
                        </span>

                        {recebida && m.categoria && (
                          <>
                            <Badge variant={varianteCategoria(m.categoria)}>
                              {humanizar(m.categoria)}
                            </Badge>
                            {m.confianca !== null && (
                              // A confiança é o que separa uma certeza de um
                              // chute que ficou abaixo do limiar de ação.
                              <span title="Confiança da classificação">
                                confiança {(m.confianca / 100).toFixed(2)}
                              </span>
                            )}
                            {m.subtipo && <span>· {m.subtipo}</span>}
                          </>
                        )}

                        {!recebida && (
                          <Badge variant={rotulo.variante}>
                            {rotulo.variante === 'info' && (
                              <FlaskConical className="h-2.5 w-2.5" aria-hidden="true" />
                            )}
                            {rotulo.texto}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---- fila pendente ---- */}
      {filaPendente.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" aria-hidden="true" />
              Na fila ({filaPendente.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {filaPendente.map((f) => (
                <li key={f.id} className="rounded-lg bg-[var(--color-fundo)] px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-texto-suave)]">
                    <Badge variant="neutro">{humanizar(f.status)}</Badge>
                    {f.dryRun && <Badge variant="info">dry-run</Badge>}
                    <span>agendada para {formatarDataHora(f.scheduledAt)}</span>
                  </div>
                  {f.textoRenderizado && (
                    <p className="mt-1 text-sm">{f.textoRenderizado}</p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ---- eventos ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Eventos ({eventos.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2.5 border-l border-[var(--color-borda)] pl-4">
            {eventos.map((e) => (
              <li key={e.id} className="relative">
                <span
                  className="absolute -left-[21px] top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--color-borda-forte)]"
                  aria-hidden="true"
                />
                <p className="text-sm">{e.descricao}</p>
                <p className="text-[11px] text-[var(--color-texto-fraco)]">
                  {formatarDataHora(e.createdAt)} · {humanizar(e.tipo)} · {e.origem}
                </p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
