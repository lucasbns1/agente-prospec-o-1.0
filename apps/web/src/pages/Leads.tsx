/**
 * CRM — tabela de leads.
 *
 * Filtros, busca e paginacao sao TODOS server-side. O navegador nunca
 * recebe a lista inteira: com alguns milhares de leads isso travaria a
 * tela e transformaria cada digitacao em trabalho de CPU no cliente.
 */
import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search, ChevronLeft, ChevronRight, Users, X } from 'lucide-react';
import { get } from '@/lib/api';
import { Button, Card, Badge, Input, variantePorTemperatura } from '@/components/ui/primitives';
import { formatarNumero, formatarDataHora, cn } from '@/lib/utils';
import { LeadDetalhe } from '@/components/LeadDetalhe';

const VISOES = [
  { id: 'TODOS', rotulo: 'Todos' },
  { id: 'SEM_SITE', rotulo: 'Sem site' },
  { id: 'COM_SITE', rotulo: 'Com site' },
  { id: 'SEM_TELEFONE', rotulo: 'Sem telefone' },
  { id: 'AGUARDANDO_RESPOSTA', rotulo: 'Aguardando resposta' },
  { id: 'INTERESSADOS', rotulo: 'Interessados' },
  { id: 'QUENTES', rotulo: 'Quentes' },
  { id: 'NEGATIVOS', rotulo: 'Negativos' },
  { id: 'OPT_OUT', rotulo: 'Opt-out' },
  { id: 'INTERVENCAO', rotulo: 'Intervenção' },
] as const;

type VisaoId = (typeof VISOES)[number]['id'];

interface LeadLinha {
  id: string;
  nomeCompleto: string | null;
  categoria: string | null;
  telefone: string | null;
  telefoneNormalizado: string | null;
  cidade: string | null;
  bairro: string | null;
  websiteUrl: string | null;
  websiteStatus: string;
  status: string;
  temperatura: string;
  optOut: boolean;
  ultimaCategoria: string | null;
  ultimaInteracaoEm: string | null;
  proximaAcao: string | null;
  origem: string | null;
  avaliacao: number | null;
}

interface RespostaLeads {
  leads: LeadLinha[];
  paginacao: { pagina: number; porPagina: number; total: number; totalPaginas: number };
}

function BadgeSite({ status }: { status: string }) {
  if (status === 'SITE_PROPRIO') return <Badge variant="neutro">Tem site</Badge>;
  if (status === 'REDE_SOCIAL') return <Badge variant="info">Rede social</Badge>;
  if (status === 'NAO_INFORMADO') return <Badge variant="info">Sem site</Badge>;
  if (status === 'INVALIDO') return <Badge variant="morno">URL inválida</Badge>;
  return <Badge variant="neutro">—</Badge>;
}

/** Status legivel, sem underscore. */
function rotuloStatus(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
}

export function Leads() {
  const [visao, setVisao] = useState<VisaoId>('TODOS');
  const [busca, setBusca] = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState('');
  const [cidade, setCidade] = useState('');
  const [categoria, setCategoria] = useState('');
  const [pagina, setPagina] = useState(1);
  const [leadAberto, setLeadAberto] = useState<string | null>(null);

  const params = new URLSearchParams({
    visao,
    pagina: String(pagina),
    porPagina: '50',
    ordenarPor: 'createdAt',
    ordem: 'desc',
  });
  if (buscaAtiva) params.set('busca', buscaAtiva);
  if (cidade) params.set('cidade', cidade);
  if (categoria) params.set('categoria', categoria);

  const { data, isLoading } = useQuery({
    queryKey: ['leads', params.toString()],
    queryFn: () => get<RespostaLeads>(`/api/leads?${params}`),
    placeholderData: keepPreviousData,
  });

  const { data: contadores } = useQuery({
    queryKey: ['leads', 'contadores'],
    queryFn: () => get<{ contadores: Record<string, number> }>('/api/leads/contadores'),
  });

  const { data: filtros } = useQuery({
    queryKey: ['leads', 'filtros'],
    queryFn: () =>
      get<{ cidades: string[]; bairros: string[]; categorias: string[] }>(
        '/api/leads/filtros'
      ),
  });

  function trocarVisao(v: VisaoId) {
    setVisao(v);
    setPagina(1);
  }

  const p = data?.paginacao;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-0.5 text-sm text-[var(--color-texto-suave)]">
            {p ? `${formatarNumero(p.total)} lead(s) nesta visão` : 'Carregando…'}
          </p>
        </div>
      </div>

      {/* Visões */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Visões de leads">
        {VISOES.map((v) => {
          const total = contadores?.contadores[v.id];
          const ativa = visao === v.id;
          return (
            <button
              key={v.id}
              role="tab"
              aria-selected={ativa}
              onClick={() => trocarVisao(v.id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm transition-colors',
                ativa
                  ? 'bg-[var(--color-marca)] text-white'
                  : 'border border-[var(--color-borda)] bg-white text-[var(--color-texto-suave)] hover:bg-[var(--color-fundo)]'
              )}
            >
              {v.rotulo}
              {total !== undefined && (
                <span className={cn('num ml-1.5 text-xs', ativa ? 'opacity-80' : 'text-[var(--color-texto-fraco)]')}>
                  {formatarNumero(total)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Busca e filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative flex-1 min-w-[240px]"
          onSubmit={(e) => {
            e.preventDefault();
            setBuscaAtiva(busca);
            setPagina(1);
          }}
        >
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-texto-fraco)]"
            aria-hidden="true"
          />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, telefone, endereço, bairro ou cidade…"
            className="pl-9"
            aria-label="Buscar leads"
          />
          {buscaAtiva && (
            <button
              type="button"
              onClick={() => { setBusca(''); setBuscaAtiva(''); setPagina(1); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-[var(--color-fundo)]"
              aria-label="Limpar busca"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </form>

        <select
          value={cidade}
          onChange={(e) => { setCidade(e.target.value); setPagina(1); }}
          aria-label="Filtrar por cidade"
          className="h-10 rounded-lg border border-[var(--color-borda-forte)] bg-white px-3 text-sm"
        >
          <option value="">Todas as cidades</option>
          {filtros?.cidades.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <select
          value={categoria}
          onChange={(e) => { setCategoria(e.target.value); setPagina(1); }}
          aria-label="Filtrar por categoria"
          className="h-10 rounded-lg border border-[var(--color-borda-forte)] bg-white px-3 text-sm"
        >
          <option value="">Todas as categorias</option>
          {filtros?.categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Tabela */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-borda)] bg-[var(--color-fundo)] text-left text-xs text-[var(--color-texto-suave)]">
                <th className="px-5 py-2.5 font-medium">Nome</th>
                <th className="px-3 py-2.5 font-medium">Categoria</th>
                <th className="px-3 py-2.5 font-medium">Telefone</th>
                <th className="px-3 py-2.5 font-medium">Cidade</th>
                <th className="px-3 py-2.5 font-medium">Bairro</th>
                <th className="px-3 py-2.5 font-medium">Site</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Temp.</th>
                <th className="px-3 py-2.5 font-medium">Última interação</th>
                <th className="px-5 py-2.5 font-medium">Próxima ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-borda)]">
              {isLoading && (
                <tr><td colSpan={10} className="px-5 py-10 text-center text-[var(--color-texto-suave)]">Carregando…</td></tr>
              )}

              {!isLoading && data?.leads.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-5 py-14 text-center">
                    <Users className="mx-auto h-8 w-8 text-[var(--color-texto-fraco)]" aria-hidden="true" />
                    <p className="mt-2 text-sm text-[var(--color-texto-suave)]">
                      Nenhum lead nesta visão.
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-texto-fraco)]">
                      Importe um CSV do Instant Data Scraper para começar.
                    </p>
                  </td>
                </tr>
              )}

              {data?.leads.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => setLeadAberto(l.id)}
                  className="cursor-pointer hover:bg-[var(--color-fundo)]"
                >
                  <td className="px-5 py-2.5 font-medium">
                    {l.nomeCompleto ?? <em className="font-normal text-[var(--color-texto-fraco)]">sem nome</em>}
                    {l.optOut && <Badge variant="alerta" className="ml-2">opt-out</Badge>}
                  </td>
                  <td className="px-3 py-2.5 text-[var(--color-texto-suave)]">{l.categoria ?? '—'}</td>
                  <td className="num px-3 py-2.5">
                    {l.telefone ?? <span className="text-[var(--color-texto-fraco)]">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[var(--color-texto-suave)]">{l.cidade ?? '—'}</td>
                  <td className="px-3 py-2.5 text-[var(--color-texto-suave)]">{l.bairro ?? '—'}</td>
                  <td className="px-3 py-2.5"><BadgeSite status={l.websiteStatus} /></td>
                  <td className="px-3 py-2.5 text-xs text-[var(--color-texto-suave)]">{rotuloStatus(l.status)}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={variantePorTemperatura(l.temperatura)}>
                      {l.temperatura.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--color-texto-suave)]">
                    {formatarDataHora(l.ultimaInteracaoEm)}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-[var(--color-texto-suave)]">
                    {l.proximaAcao ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {p && p.totalPaginas > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--color-borda)] px-5 py-3">
            <span className="text-xs text-[var(--color-texto-suave)]">
              Página {p.pagina} de {p.totalPaginas} — {formatarNumero(p.total)} lead(s)
            </span>
            <div className="flex gap-1">
              <Button
                variant="secundario" size="sm"
                disabled={p.pagina <= 1}
                onClick={() => setPagina((n) => n - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Anterior
              </Button>
              <Button
                variant="secundario" size="sm"
                disabled={p.pagina >= p.totalPaginas}
                onClick={() => setPagina((n) => n + 1)}
              >
                Próxima
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {leadAberto && (
        <LeadDetalhe leadId={leadAberto} onFechar={() => setLeadAberto(null)} />
      )}
    </div>
  );
}
