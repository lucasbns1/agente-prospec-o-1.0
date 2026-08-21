/**
 * Campanhas — listagem e criacao.
 *
 * A tela inteira parte de um principio: nada aqui envia mensagem. O
 * botao mais avancado leva a previa, e a previa nao grava nada. Enviar
 * de verdade depende do worker, que segue em dry-run.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Rocket, Plus, Loader2, ArrowLeft, Users, ShieldCheck, Clock,
} from 'lucide-react';
import { get, post, ApiError } from '@/lib/api';
import {
  Button, Card, CardContent, CardHeader, CardTitle, Badge, Input, Label,
  Select,
} from '@/components/ui/primitives';
import { formatarNumero, formatarDataHora, cn } from '@/lib/utils';
import { FiltrosLead, type Filtros } from '@/components/campanha/FiltrosLead';

interface CampanhaLinha {
  id: string;
  nome: string;
  descricao: string | null;
  status: string;
  dryRun: boolean;
  nicho: string | null;
  cidade: string | null;
  limiteDiarioEnvios: number;
  horarioInicio: string;
  horarioFim: string;
  createdAt: string;
  totalEtapas: number;
  totalNaFila: number;
  agendadas: number;
  bloqueadas: number;
  simuladas: number;
  enviadas: number;
  respostas: number;
}

const DIAS = [
  { valor: 1, rotulo: 'Seg' },
  { valor: 2, rotulo: 'Ter' },
  { valor: 3, rotulo: 'Qua' },
  { valor: 4, rotulo: 'Qui' },
  { valor: 5, rotulo: 'Sex' },
  { valor: 6, rotulo: 'Sáb' },
  { valor: 0, rotulo: 'Dom' },
];

export function varianteStatus(
  status: string
): 'neutro' | 'sucesso' | 'morno' | 'info' {
  if (status === 'ATIVA') return 'sucesso';
  if (status === 'PAUSADA') return 'morno';
  if (status === 'CONCLUIDA') return 'info';
  return 'neutro';
}

export function rotuloStatusCampanha(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

// ------------------------------------------------------------ formulario
function NovaCampanha({ aoCancelar }: { aoCancelar: () => void }) {
  const queryClient = useQueryClient();

  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [nicho, setNicho] = useState('');
  const [horarioInicio, setHorarioInicio] = useState('08:00');
  const [horarioFim, setHorarioFim] = useState('20:00');
  const [limiteDiario, setLimiteDiario] = useState(50);
  const [limiteHorario, setLimiteHorario] = useState(10);
  const [maxLeads, setMaxLeads] = useState(0);
  const [dias, setDias] = useState<number[]>([1, 2, 3, 4, 5]);
  const [filtros, setFiltros] = useState<Filtros>({ exigirTelefone: true });

  const criar = useMutation({
    mutationFn: (): Promise<{ campanha: { id: string } }> =>
      post('/api/campaigns', {
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        nicho: nicho.trim() || null,
        horarioInicio,
        horarioFim,
        limiteDiarioEnvios: limiteDiario,
        limiteHorarioEnvios: limiteHorario,
        maxLeads,
        diasPermitidos: [...dias].sort((a, b) => a - b),
        filtros,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campanhas'] });
      aoCancelar();
    },
  });

  const alternarDia = (valor: number): void =>
    setDias((atual) =>
      atual.includes(valor) ? atual.filter((d) => d !== valor) : [...atual, valor]
    );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="fantasma" size="sm" onClick={aoCancelar}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">Nova campanha</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Identificação</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="nome">Nome da campanha</Label>
                <Input
                  id="nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex.: Psicólogos de Campinas sem site"
                />
              </div>
              <div>
                <Label htmlFor="descricao">Descrição (opcional)</Label>
                <Input
                  id="descricao"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Para que serve esta campanha"
                />
              </div>
              <div>
                <Label htmlFor="nicho">Nicho (opcional)</Label>
                <Input
                  id="nicho"
                  value={nicho}
                  onChange={(e) => setNicho(e.target.value)}
                  placeholder="Ex.: Psicologia"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quem entra na campanha</CardTitle>
            </CardHeader>
            <CardContent>
              <FiltrosLead valor={filtros} aoMudar={setFiltros} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-4 w-4" aria-hidden="true" />
                Janela de envio
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="hi">Começa às</Label>
                  <Input
                    id="hi"
                    type="time"
                    value={horarioInicio}
                    onChange={(e) => setHorarioInicio(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="hf">Termina às</Label>
                  <Input
                    id="hf"
                    type="time"
                    value={horarioFim}
                    onChange={(e) => setHorarioFim(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label>Dias permitidos</Label>
                <div className="flex flex-wrap gap-1.5">
                  {DIAS.map((d) => (
                    <button
                      key={d.valor}
                      type="button"
                      onClick={() => alternarDia(d.valor)}
                      aria-pressed={dias.includes(d.valor)}
                      className={cn(
                        'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                        dias.includes(d.valor)
                          ? 'border-[var(--color-marca)] bg-[var(--color-marca)] text-white'
                          : 'border-[var(--color-borda-forte)] bg-white text-[var(--color-texto-suave)]'
                      )}
                    >
                      {d.rotulo}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="ld">Limite por dia</Label>
                  <Input
                    id="ld"
                    type="number"
                    min={1}
                    value={limiteDiario}
                    onChange={(e) => setLimiteDiario(Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label htmlFor="lh">Limite por hora</Label>
                  <Input
                    id="lh"
                    type="number"
                    min={1}
                    value={limiteHorario}
                    onChange={(e) => setLimiteHorario(Number(e.target.value))}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="ml">Máximo de leads (0 = sem limite)</Label>
                <Input
                  id="ml"
                  type="number"
                  min={0}
                  value={maxLeads}
                  onChange={(e) => setMaxLeads(Number(e.target.value))}
                />
              </div>

              <p className="text-xs leading-relaxed text-[var(--color-texto-suave)]">
                Estes limites existem para proteger o número. Disparar
                rápido demais é o caminho mais curto para um bloqueio do
                WhatsApp.
              </p>
            </CardContent>
          </Card>

          <Card className="border-[var(--color-info)]">
            <CardContent className="flex gap-3 pt-5">
              <ShieldCheck
                className="h-5 w-5 shrink-0 text-[var(--color-info)]"
                aria-hidden="true"
              />
              <p className="text-xs leading-relaxed text-[var(--color-texto-suave)]">
                A campanha nasce como <strong>rascunho</strong> e em{' '}
                <strong>dry-run</strong>. Nenhuma mensagem é enviada até
                você desmarcar a simulação nas configurações.
              </p>
            </CardContent>
          </Card>

          {criar.isError && (
            <p className="text-sm text-[var(--color-alerta)]">
              {criar.error instanceof ApiError
                ? criar.error.message
                : 'Não foi possível criar a campanha'}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              onClick={() => criar.mutate()}
              disabled={nome.trim() === '' || dias.length === 0 || criar.isPending}
            >
              {criar.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Criar campanha
            </Button>
            <Button variant="secundario" onClick={aoCancelar}>
              Cancelar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- lista
export function Campanhas() {
  const [criando, setCriando] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState('TODAS');

  const { data, isLoading } = useQuery({
    queryKey: ['campanhas'],
    queryFn: () => get<{ campanhas: CampanhaLinha[] }>('/api/campaigns'),
  });

  if (criando) return <NovaCampanha aoCancelar={() => setCriando(false)} />;

  const todas = data?.campanhas ?? [];
  const campanhas =
    filtroStatus === 'TODAS' ? todas : todas.filter((c) => c.status === filtroStatus);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Campanhas</h1>
          <p className="text-sm text-[var(--color-texto-suave)]">
            Quem recebe, o que recebe e quando recebe.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            aria-label="Filtrar por status"
            className="h-9 w-40"
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
          >
            <option value="TODAS">Todos os status</option>
            <option value="RASCUNHO">Rascunho</option>
            <option value="ATIVA">Ativa</option>
            <option value="PAUSADA">Pausada</option>
            <option value="CONCLUIDA">Concluída</option>
            <option value="ARQUIVADA">Arquivada</option>
          </Select>
          <Button onClick={() => setCriando(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nova campanha
          </Button>
        </div>
      </div>

      {isLoading && (
        <Card>
          <CardContent className="flex items-center gap-2 py-10 text-sm text-[var(--color-texto-suave)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Carregando campanhas…
          </CardContent>
        </Card>
      )}

      {!isLoading && campanhas.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Rocket
              className="h-8 w-8 text-[var(--color-texto-fraco)]"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium">
                {todas.length === 0
                  ? 'Nenhuma campanha ainda'
                  : 'Nenhuma campanha com este status'}
              </p>
              <p className="text-sm text-[var(--color-texto-suave)]">
                {todas.length === 0
                  ? 'Crie a primeira para escolher o público e escrever a abordagem.'
                  : 'Troque o filtro para ver as outras.'}
              </p>
            </div>
            {todas.length === 0 && (
              <Button onClick={() => setCriando(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Nova campanha
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {campanhas.map((c) => (
          <Card key={c.id} className="flex flex-col">
            <CardHeader className="flex-1">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-[15px]">{c.nome}</CardTitle>
                <Badge variant={varianteStatus(c.status)}>
                  {rotuloStatusCampanha(c.status)}
                </Badge>
              </div>
              {c.descricao && (
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-texto-suave)]">
                  {c.descricao}
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[var(--color-fundo)] py-2">
                  <p className="text-sm font-semibold">{c.totalEtapas}</p>
                  <p className="text-[11px] text-[var(--color-texto-suave)]">Etapas</p>
                </div>
                <div className="rounded-lg bg-[var(--color-fundo)] py-2">
                  <p className="text-sm font-semibold">
                    {formatarNumero(c.totalNaFila)}
                  </p>
                  <p className="text-[11px] text-[var(--color-texto-suave)]">Na fila</p>
                </div>
                <div className="rounded-lg bg-[var(--color-fundo)] py-2">
                  <p className="text-sm font-semibold">
                    {formatarNumero(c.respostas)}
                  </p>
                  <p className="text-[11px] text-[var(--color-texto-suave)]">
                    Respostas
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-texto-suave)]">
                {c.dryRun && <Badge variant="info">Dry-run</Badge>}
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {c.horarioInicio}–{c.horarioFim}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" aria-hidden="true" />
                  {c.limiteDiarioEnvios}/dia
                </span>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-[var(--color-texto-fraco)]">
                  Criada em {formatarDataHora(c.createdAt)}
                </span>
                <Button variant="secundario" size="sm" asChild>
                  <Link to={`/campanhas/${c.id}`}>Abrir</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
