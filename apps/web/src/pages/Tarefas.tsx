/**
 * Tarefas — o que voce precisa fazer.
 *
 * A ordem e a mesma do dashboard: atrasadas primeiro, depois as mais
 * urgentes. Uma lista de tarefas ordenada por data de criacao seria
 * inutil justamente nos dias em que ha muitas.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare, Check, Loader2, Plus, TriangleAlert, CalendarClock,
} from 'lucide-react';
import { get, post, ApiError } from '@/lib/api';
import {
  Button, Card, CardContent, CardHeader, CardTitle, Badge, Input, Label,
  Select, Textarea,
} from '@/components/ui/primitives';
import { formatarDataHora, cn } from '@/lib/utils';
import { LeadDetalhe } from '@/components/LeadDetalhe';

interface Tarefa {
  id: string;
  leadId: string | null;
  tipo: string;
  titulo: string;
  descricao: string | null;
  prioridade: string;
  status: string;
  prazo: string | null;
  concluidaEm: string | null;
  createdAt: string;
  lead: {
    id: string;
    nomeCompleto: string | null;
    empresa: string | null;
    telefone: string | null;
    cidade: string | null;
    temperatura: string;
    status: string;
  } | null;
}

interface Resposta {
  tarefas: Tarefa[];
  contagem: Record<string, number>;
  atrasadas: number;
}

const TIPOS = [
  { valor: 'OUTRO', rotulo: 'Outro' },
  { valor: 'CRIAR_PREVIEW', rotulo: 'Criar preview' },
  { valor: 'RESPONDER_CLIENTE', rotulo: 'Responder cliente' },
  { valor: 'ENVIAR_PROPOSTA', rotulo: 'Enviar proposta' },
  { valor: 'FOLLOW_UP', rotulo: 'Follow-up' },
  { valor: 'VERIFICAR_LEAD', rotulo: 'Verificar lead' },
];

const VISOES = [
  { id: 'ABERTAS', rotulo: 'Abertas' },
  { id: 'ATRASADAS', rotulo: 'Atrasadas' },
  { id: 'CONCLUIDA', rotulo: 'Concluídas' },
  { id: 'TODAS', rotulo: 'Todas' },
] as const;

type VisaoId = (typeof VISOES)[number]['id'];

function variantePrioridade(p: string): 'alerta' | 'morno' | 'info' | 'neutro' {
  if (p === 'URGENTE') return 'alerta';
  if (p === 'ALTA') return 'morno';
  if (p === 'MEDIA') return 'info';
  return 'neutro';
}

function humanizar(v: string): string {
  return v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
}

/** true quando o prazo já passou e a tarefa continua aberta. */
function estaAtrasada(t: Tarefa): boolean {
  if (!t.prazo || t.status === 'CONCLUIDA' || t.status === 'CANCELADA') return false;
  return new Date(t.prazo).getTime() < Date.now();
}

// ------------------------------------------------------------ nova tarefa
function NovaTarefa({ aoFechar }: { aoFechar: () => void }) {
  const queryClient = useQueryClient();
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [tipo, setTipo] = useState('OUTRO');
  const [prioridade, setPrioridade] = useState('MEDIA');
  const [prazo, setPrazo] = useState('');

  const criar = useMutation({
    mutationFn: () =>
      post('/api/tasks', {
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        tipo,
        prioridade,
        // Sem prazo a tarefa nunca conta como atrasada — proposital.
        prazo: prazo ? new Date(prazo).toISOString() : null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tarefas'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      aoFechar();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nova tarefa</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="t-titulo">O que precisa ser feito</Label>
          <Input
            id="t-titulo"
            value={titulo}
            placeholder="Ex.: montar o preview da Clínica Bem Viver"
            onChange={(e) => setTitulo(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="t-desc">Detalhes (opcional)</Label>
          <Textarea
            id="t-desc"
            rows={2}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="t-tipo">Tipo</Label>
            <Select id="t-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.rotulo}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="t-prio">Prioridade</Label>
            <Select
              id="t-prio"
              value={prioridade}
              onChange={(e) => setPrioridade(e.target.value)}
            >
              {['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'].map((p) => (
                <option key={p} value={p}>
                  {humanizar(p)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="t-prazo">Prazo (opcional)</Label>
            <Input
              id="t-prazo"
              type="datetime-local"
              value={prazo}
              onChange={(e) => setPrazo(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            disabled={titulo.trim() === '' || criar.isPending}
            onClick={() => criar.mutate()}
          >
            {criar.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            Criar tarefa
          </Button>
          <Button variant="secundario" onClick={aoFechar}>
            Cancelar
          </Button>
          {criar.isError && (
            <span className="text-sm text-[var(--color-alerta)]">
              {criar.error instanceof ApiError
                ? criar.error.message
                : 'Não foi possível criar'}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------- pagina
export function Tarefas() {
  const queryClient = useQueryClient();
  const [visao, setVisao] = useState<VisaoId>('ABERTAS');
  const [criando, setCriando] = useState(false);
  const [leadAberto, setLeadAberto] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (visao === 'ATRASADAS') params.set('apenasAtrasadas', 'true');
  if (visao === 'CONCLUIDA') params.set('status', 'CONCLUIDA');

  const { data, isLoading } = useQuery({
    queryKey: ['tarefas', visao],
    queryFn: () => get<Resposta>(`/api/tasks?${params.toString()}`),
  });

  const concluir = useMutation({
    mutationFn: (id: string) => post(`/api/tasks/${id}/concluir`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tarefas'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const todas = data?.tarefas ?? [];
  const tarefas =
    visao === 'ABERTAS'
      ? todas.filter((t) => t.status === 'ABERTA' || t.status === 'EM_ANDAMENTO')
      : todas;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tarefas</h1>
          <p className="text-sm text-[var(--color-texto-suave)]">
            O que precisa da sua ação, em ordem de urgência.
          </p>
        </div>
        <Button onClick={() => setCriando((v) => !v)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nova tarefa
        </Button>
      </div>

      {(data?.atrasadas ?? 0) > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-alerta)] bg-[var(--color-alerta-bg)] px-4 py-3">
          <TriangleAlert
            className="h-4 w-4 shrink-0 text-[var(--color-alerta)]"
            aria-hidden="true"
          />
          <p className="text-sm text-[var(--color-alerta)]">
            <strong>{data?.atrasadas}</strong> tarefa(s) com prazo vencido.
          </p>
        </div>
      )}

      {criando && <NovaTarefa aoFechar={() => setCriando(false)} />}

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Visões">
        {VISOES.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={visao === v.id}
            onClick={() => setVisao(v.id)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm transition-colors',
              visao === v.id
                ? 'border-[var(--color-marca)] bg-[var(--color-marca)] text-white'
                : 'border-[var(--color-borda-forte)] bg-white text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]'
            )}
          >
            {v.rotulo}
          </button>
        ))}
      </div>

      {isLoading && (
        <Card>
          <CardContent className="flex items-center gap-2 py-10 text-sm text-[var(--color-texto-suave)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Carregando tarefas…
          </CardContent>
        </Card>
      )}

      {!isLoading && tarefas.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <CheckSquare
              className="h-8 w-8 text-[var(--color-texto-fraco)]"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">Nenhuma tarefa aqui</p>
            <p className="text-sm text-[var(--color-texto-suave)]">
              O sistema cria tarefas sozinho quando não consegue seguir em
              frente — por exemplo, quando não entende uma resposta.
            </p>
          </CardContent>
        </Card>
      )}

      {tarefas.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-[var(--color-borda)]">
              {tarefas.map((t) => {
                const atrasada = estaAtrasada(t);
                const concluida = t.status === 'CONCLUIDA';
                return (
                  <li key={t.id} className="flex items-start gap-3 px-5 py-4">
                    <Button
                      variant="fantasma"
                      size="icone"
                      aria-label={`Concluir "${t.titulo}"`}
                      disabled={concluida || concluir.isPending}
                      onClick={() => concluir.mutate(t.id)}
                      className={cn(
                        'mt-0.5 shrink-0 rounded-full border',
                        concluida
                          ? 'border-[var(--color-sucesso)] text-[var(--color-sucesso)]'
                          : 'border-[var(--color-borda-forte)]'
                      )}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className={cn(
                            'text-sm font-medium',
                            concluida && 'text-[var(--color-texto-suave)] line-through'
                          )}
                        >
                          {t.titulo}
                        </p>
                        <Badge variant={variantePrioridade(t.prioridade)}>
                          {humanizar(t.prioridade)}
                        </Badge>
                        {atrasada && <Badge variant="alerta">Atrasada</Badge>}
                      </div>

                      {t.descricao && (
                        <p className="mt-0.5 text-xs text-[var(--color-texto-suave)]">
                          {t.descricao}
                        </p>
                      )}

                      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-[var(--color-texto-fraco)]">
                        <span>{humanizar(t.tipo)}</span>
                        {t.prazo && (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1',
                              atrasada && 'font-medium text-[var(--color-alerta)]'
                            )}
                          >
                            <CalendarClock className="h-3 w-3" aria-hidden="true" />
                            {formatarDataHora(t.prazo)}
                          </span>
                        )}
                        {t.lead && (
                          <button
                            type="button"
                            className="underline hover:text-[var(--color-texto)]"
                            onClick={() => setLeadAberto(t.lead!.id)}
                          >
                            {t.lead.empresa ?? t.lead.nomeCompleto ?? 'ver lead'}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
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
