/**
 * O quadro: uma coluna por mensagem, os leads dentro.
 *
 * ============================================================
 * O QUE O FORMATO EM COLUNAS RESOLVE
 * ============================================================
 * Numa lista, descobrir "quantos pararam na mensagem 2" exige ler linha
 * por linha. Em colunas, a resposta e a FORMA do quadro: uma coluna
 * cheia no meio significa que aquela mensagem nao esta destravando
 * ninguem — e isso e visivel de longe, sem contar nada.
 *
 * ============================================================
 * O NUMERO E A VERDADE; OS CARTOES SAO UMA AMOSTRA
 * ============================================================
 * O total no topo da coluna vem de uma contagem no banco e e exato. Os
 * cartoes sao os primeiros N. Quando ha mais, a coluna diz quantos
 * ficaram de fora em vez de fingir que aquilo e tudo.
 */
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Loader2, Hand, Inbox, Flag, MessageSquare, ShieldCheck,
} from 'lucide-react';
import { get } from '@/lib/api';
import {
  Card, CardContent, Badge, variantePorTemperatura,
} from '@/components/ui/primitives';
import { formatarNumero, formatarDataHora, cn } from '@/lib/utils';
import { varianteStatus, rotuloStatusCampanha } from '@/pages/Campanhas';

interface CartaoLead {
  id: string;
  status: string;
  proximoEnvioEm: string | null;
  aguardandoLiberacao: boolean;
  totalEnviadas: number;
  totalRecebidas: number;
  updatedAt: string;
  lead: {
    id: string;
    nomeCompleto: string | null;
    empresa: string | null;
    telefone: string | null;
    cidade: string | null;
    temperatura: string;
    status: string;
    optOut: boolean;
  };
}

interface Coluna {
  chave: string;
  tipo: 'NA_FILA' | 'ETAPA' | 'PRECISA_DE_VOCE' | 'ENCERRADO';
  etapaId: string | null;
  titulo: string;
  legenda: string;
  total: number;
  leads: CartaoLead[];
}

interface Quadro {
  campanha: { id: string; nome: string; status: string; dryRun: boolean };
  totalLeads: number;
  colunas: Coluna[];
}

const ICONE_COLUNA = {
  NA_FILA: Inbox,
  ETAPA: MessageSquare,
  PRECISA_DE_VOCE: Hand,
  ENCERRADO: Flag,
} as const;

function Cartao({ c }: { c: CartaoLead }) {
  const titulo = c.lead.empresa || c.lead.nomeCompleto || 'Sem nome';
  const subtitulo =
    c.lead.empresa && c.lead.nomeCompleto ? c.lead.nomeCompleto : c.lead.cidade;

  return (
    <Link
      to={`/conversas/${c.lead.id}`}
      className="block rounded-lg border border-[var(--color-borda)] bg-white p-2.5 transition-colors hover:border-[var(--color-texto-fraco)]"
    >
      <p className="truncate text-sm font-medium">{titulo}</p>
      {subtitulo && (
        <p className="truncate text-xs text-[var(--color-texto-suave)]">
          {subtitulo}
        </p>
      )}
      {c.lead.telefone && (
        <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-texto-suave)]">
          {c.lead.telefone}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Badge variant={variantePorTemperatura(c.lead.temperatura)}>
          {c.lead.temperatura.toLowerCase()}
        </Badge>
        {c.lead.optOut && <Badge variant="neutro">opt-out</Badge>}
        {c.aguardandoLiberacao && <Badge variant="morno">liberação manual</Badge>}
      </div>

      <p className="mt-1.5 text-[11px] text-[var(--color-texto-fraco)]">
        {c.totalEnviadas} enviada{c.totalEnviadas === 1 ? '' : 's'} ·{' '}
        {c.totalRecebidas} resposta{c.totalRecebidas === 1 ? '' : 's'}
      </p>
    </Link>
  );
}

export function QuadroCampanha() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['quadro', id],
    queryFn: () => get<Quadro>(`/api/campaigns/${id}/quadro`),
    enabled: Boolean(id),
    // O quadro muda sozinho conforme o worker anda. Sem isto voce teria
    // que apertar F5 para saber se algo mudou.
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-[var(--color-texto-suave)]">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Carregando o quadro…
      </p>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <Link
          to="/estado"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar
        </Link>
        <p className="text-sm text-[var(--color-alerta)]">
          Não foi possível carregar o quadro desta campanha.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/estado"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Estado das campanhas
        </Link>

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {data.campanha.nome}
          </h1>
          <Badge variant={varianteStatus(data.campanha.status)}>
            {rotuloStatusCampanha(data.campanha.status)}
          </Badge>
          {data.campanha.dryRun && <Badge variant="neutro">simulação</Badge>}
          <Link
            to={`/campanhas/${data.campanha.id}`}
            className="text-sm text-[var(--color-texto-suave)] underline-offset-2 hover:underline"
          >
            editar
          </Link>
        </div>

        <p className="mt-0.5 text-sm text-[var(--color-texto-suave)]">
          {formatarNumero(data.totalLeads)} lead
          {data.totalLeads === 1 ? '' : 's'} nesta campanha.
        </p>
      </div>

      {data.totalLeads === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Inbox
              className="h-7 w-7 text-[var(--color-texto-fraco)]"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">Nenhum lead nesta campanha</p>
            <p className="text-sm text-[var(--color-texto-suave)]">
              Enfileire a campanha em{' '}
              <Link
                to={`/campanhas/${data.campanha.id}`}
                className="underline underline-offset-2"
              >
                editar
              </Link>{' '}
              para os leads aparecerem aqui.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Rolagem horizontal: com 5 ou 6 etapas as colunas nao cabem na
          tela, e espremer todas deixaria os cartoes ilegiveis. */}
      <div className="-mx-1 overflow-x-auto pb-2">
        <div className="flex min-w-max gap-3 px-1">
          {data.colunas.map((col) => {
            const Icone = ICONE_COLUNA[col.tipo];
            const destaque = col.tipo === 'PRECISA_DE_VOCE' && col.total > 0;
            const ocultos = col.total - col.leads.length;

            return (
              <section
                key={col.chave}
                aria-label={`${col.titulo}: ${col.total}`}
                className={cn(
                  'flex w-64 shrink-0 flex-col rounded-xl border bg-[var(--color-fundo)] p-2.5',
                  destaque
                    ? 'border-[var(--color-alerta)]'
                    : 'border-[var(--color-borda)]'
                )}
              >
                <header className="mb-2 px-0.5">
                  <div className="flex items-center gap-1.5">
                    <Icone
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        destaque
                          ? 'text-[var(--color-alerta)]'
                          : 'text-[var(--color-texto-suave)]'
                      )}
                      aria-hidden="true"
                    />
                    <h2 className="truncate text-sm font-medium">{col.titulo}</h2>
                    <span
                      className={cn(
                        'ml-auto rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums',
                        destaque
                          ? 'bg-[var(--color-alerta-bg)] text-[var(--color-alerta)]'
                          : 'bg-white text-[var(--color-texto-suave)]'
                      )}
                    >
                      {formatarNumero(col.total)}
                    </span>
                  </div>
                  {col.legenda && (
                    <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-texto-fraco)]">
                      {col.legenda}
                    </p>
                  )}
                </header>

                <div className="space-y-2">
                  {col.leads.map((c) => (
                    <Cartao key={c.id} c={c} />
                  ))}

                  {col.total === 0 && (
                    <p className="px-0.5 py-3 text-xs text-[var(--color-texto-fraco)]">
                      Ninguém aqui.
                    </p>
                  )}

                  {ocultos > 0 && (
                    <p className="px-0.5 pt-1 text-[11px] text-[var(--color-texto-suave)]">
                      + {formatarNumero(ocultos)} não exibido
                      {ocultos === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs text-[var(--color-texto-suave)]">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Cada lead aparece em uma coluna só. Quem está em{' '}
        <strong className="font-medium">Precisa de você</strong> saiu da coluna
        da mensagem de propósito: a automação parou nele e não volta sozinha.
      </p>

      <p className="text-xs text-[var(--color-texto-fraco)]">
        Atualiza sozinho a cada 15 segundos. Última leitura:{' '}
        {formatarDataHora(new Date())}.
      </p>
    </div>
  );
}
