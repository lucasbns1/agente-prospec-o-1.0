/**
 * Conversas — a caixa de entrada.
 *
 * Duas colunas: a lista de quem falou e a conversa aberta. A ordem e por
 * ultima mensagem, como qualquer caixa de entrada — e o que coloca na
 * frente quem esta esperando.
 */
import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  MessagesSquare, Search, Loader2, UserRoundX, Inbox,
} from 'lucide-react';
import { get } from '@/lib/api';
import {
  Card, CardContent, Badge, Input, Button, variantePorTemperatura,
} from '@/components/ui/primitives';
import { formatarDataHora, cn } from '@/lib/utils';
import { Conversa } from '@/components/Conversa';

interface ConversaLinha {
  id: string;
  leadId: string;
  naoLidas: number;
  ultimaMensagemEm: string | null;
  ultimaMensagemTexto: string | null;
  lead: {
    id: string;
    nomeCompleto: string | null;
    empresa: string | null;
    telefone: string | null;
    cidade: string | null;
    temperatura: string;
    status: string;
    optOut: boolean;
    ultimaCategoria: string | null;
    proximaAcao: string | null;
  };
  campaign: { id: string; nome: string } | null;
}

interface Desconhecido {
  id: string;
  telefone: string;
  nomeContato: string | null;
  texto: string;
  motivo: string;
  recebidaEm: string;
}

function humanizar(v: string | null): string {
  if (!v) return '—';
  return v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
}

export function Conversas() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');
  const [verDesconhecidos, setVerDesconhecidos] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['conversas', busca],
    queryFn: () =>
      get<{ conversas: ConversaLinha[]; naoLidas: number }>(
        `/api/conversas${busca ? `?busca=${encodeURIComponent(busca)}` : ''}`
      ),
  });

  const { data: desconhecidos } = useQuery({
    queryKey: ['conversas-desconhecidos'],
    queryFn: () =>
      get<{ contatos: Desconhecido[]; pendentes: number }>(
        '/api/conversas/desconhecidos'
      ),
  });

  const conversas = data?.conversas ?? [];
  const pendentes = desconhecidos?.pendentes ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Conversas</h1>
          <p className="text-sm text-[var(--color-texto-suave)]">
            Quem respondeu, em ordem de quem falou por último.
          </p>
        </div>
        {pendentes > 0 && (
          <Button
            variant={verDesconhecidos ? 'primary' : 'secundario'}
            size="sm"
            onClick={() => setVerDesconhecidos((v) => !v)}
          >
            <UserRoundX className="h-4 w-4" aria-hidden="true" />
            {pendentes} de número desconhecido
          </Button>
        )}
      </div>

      {verDesconhecidos && (
        <Card>
          <CardContent className="p-0">
            <div className="border-b border-[var(--color-borda)] px-5 py-3">
              <p className="text-sm font-medium">Mensagens de quem não é lead</p>
              <p className="text-xs leading-relaxed text-[var(--color-texto-suave)]">
                O sistema não cria lead sozinho para cada número que escreve, e
                também não descarta a mensagem. Ela fica aqui para você decidir.
              </p>
            </div>
            <ul className="divide-y divide-[var(--color-borda)]">
              {(desconhecidos?.contatos ?? []).map((c) => (
                <li key={c.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {c.nomeContato ?? c.telefone}
                    </span>
                    <Badge variant="morno">{c.motivo}</Badge>
                    <span className="text-[11px] text-[var(--color-texto-fraco)]">
                      {formatarDataHora(c.recebidaEm)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-texto-suave)]">
                    {c.texto}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* ---------------- lista ---------------- */}
        <Card className="flex max-h-[calc(100vh-220px)] flex-col overflow-hidden">
          <div className="border-b border-[var(--color-borda)] p-3">
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-texto-fraco)]"
                aria-hidden="true"
              />
              <Input
                className="pl-8"
                placeholder="Buscar por nome ou telefone"
                aria-label="Buscar conversas"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <p className="flex items-center gap-2 px-4 py-8 text-sm text-[var(--color-texto-suave)]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Carregando…
              </p>
            )}

            {!isLoading && conversas.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <Inbox
                  className="h-7 w-7 text-[var(--color-texto-fraco)]"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium">Nenhuma conversa ainda</p>
                <p className="text-xs text-[var(--color-texto-suave)]">
                  As conversas aparecem aqui quando um lead responde.
                </p>
              </div>
            )}

            <ul className="divide-y divide-[var(--color-borda)]">
              {conversas.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/conversas/${c.leadId}`)}
                    aria-current={leadId === c.leadId ? 'true' : undefined}
                    className={cn(
                      'w-full px-4 py-3 text-left transition-colors hover:bg-[var(--color-fundo)]',
                      leadId === c.leadId && 'bg-[var(--color-fundo)]'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {c.lead.empresa ?? c.lead.nomeCompleto ?? 'Sem nome'}
                      </span>
                      {c.naoLidas > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-marca)] px-1.5 text-[10px] font-semibold text-white">
                          {c.naoLidas}
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 truncate text-xs text-[var(--color-texto-suave)]">
                      {c.ultimaMensagemTexto ?? 'Sem mensagens'}
                    </p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant={variantePorTemperatura(c.lead.temperatura)}>
                        {c.lead.temperatura.toLowerCase()}
                      </Badge>
                      {c.lead.optOut && <Badge variant="alerta">opt-out</Badge>}
                      {c.lead.status === 'AGUARDANDO_INTERVENCAO' && (
                        <Badge variant="alerta">precisa de você</Badge>
                      )}
                      <span className="text-[10px] text-[var(--color-texto-fraco)]">
                        {formatarDataHora(c.ultimaMensagemEm)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        {/* ---------------- conversa aberta ---------------- */}
        {leadId ? (
          <Conversa leadId={leadId} />
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-20 text-center">
              <MessagesSquare
                className="h-8 w-8 text-[var(--color-texto-fraco)]"
                aria-hidden="true"
              />
              <p className="text-sm font-medium">Escolha uma conversa</p>
              <p className="text-sm text-[var(--color-texto-suave)]">
                Ou veja quem precisa de você no{' '}
                <Link to="/" className="underline">
                  dashboard
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export { humanizar };
