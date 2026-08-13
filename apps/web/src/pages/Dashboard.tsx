/**
 * Dashboard — o centro de comando.
 *
 * A ordem da pagina e uma decisao de produto, nao estetica: primeiro o
 * que exige acao sua, depois os numeros. Um lead quente esperando
 * resposta vale mais que qualquer grafico.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Flame, Inbox, TriangleAlert, Rocket } from 'lucide-react';
import { Link } from 'react-router-dom';
import { get } from '@/lib/api';
import {
  Card, CardContent, CardHeader, CardTitle, Badge, Button,
  variantePorTemperatura,
} from '@/components/ui/primitives';
import { formatarNumero, formatarDataHora } from '@/lib/utils';
import { LeadDetalhe } from '@/components/LeadDetalhe';
import type { DashboardResponse } from '@prospector/shared';

/** Cor do motivo. Os quatro primeiros são os que doem. */
function varianteMotivo(motivo: string): 'alerta' | 'quente' | 'morno' | 'info' {
  if (motivo === 'INTERVENCAO_NECESSARIA') return 'alerta';
  if (motivo === 'LEAD_QUENTE') return 'quente';
  if (motivo === 'PEDIDO_PREVIEW' || motivo === 'PEDIDO_PRECO') return 'morno';
  return 'info';
}

interface CartaoMetrica {
  chave: keyof DashboardResponse['metricas'];
  rotulo: string;
  destaque?: 'frio' | 'morno' | 'quente' | 'sucesso' | 'alerta';
}

const CARTOES: CartaoMetrica[] = [
  { chave: 'totalLeads', rotulo: 'Total de leads' },
  { chave: 'totalImportados', rotulo: 'Importados' },
  { chave: 'semSite', rotulo: 'Sem site próprio' },
  { chave: 'comSite', rotulo: 'Com site' },
  { chave: 'totalProspectados', rotulo: 'Prospectados' },
  { chave: 'mensagensEnviadas', rotulo: 'Mensagens enviadas' },
  { chave: 'mensagensRecebidas', rotulo: 'Mensagens recebidas' },
  { chave: 'aguardandoResposta', rotulo: 'Aguardando resposta' },
  { chave: 'emConversa', rotulo: 'Em conversa' },
  { chave: 'intervencoesPendentes', rotulo: 'Intervenções pendentes', destaque: 'alerta' },
  { chave: 'interessados', rotulo: 'Interessados' },
  { chave: 'negativos', rotulo: 'Negativos' },
  { chave: 'frios', rotulo: 'Frios', destaque: 'frio' },
  { chave: 'mornos', rotulo: 'Mornos', destaque: 'morno' },
  { chave: 'quentes', rotulo: 'Quentes', destaque: 'quente' },
  { chave: 'optOuts', rotulo: 'Opt-outs', destaque: 'alerta' },
  { chave: 'clientes', rotulo: 'Clientes', destaque: 'sucesso' },
  { chave: 'errosEnvio', rotulo: 'Erros de envio', destaque: 'alerta' },
  { chave: 'agendados', rotulo: 'Agendados' },
  { chave: 'tarefasPendentes', rotulo: 'Tarefas pendentes' },
  { chave: 'leadsHoje', rotulo: 'Leads hoje' },
];

const COR_DESTAQUE: Record<string, string> = {
  frio: 'text-[var(--color-frio)]',
  morno: 'text-[var(--color-morno)]',
  quente: 'text-[var(--color-quente)]',
  sucesso: 'text-[var(--color-sucesso)]',
  alerta: 'text-[var(--color-alerta)]',
};

export function Dashboard() {
  const [leadAberto, setLeadAberto] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => get<DashboardResponse>('/api/dashboard'),
  });

  if (isError) {
    return (
      <div className="rounded-xl border border-[var(--color-alerta)] bg-[var(--color-alerta-bg)] p-4 text-sm text-[var(--color-alerta)]">
        Não foi possível carregar o dashboard. Verifique se a API está rodando.
      </div>
    );
  }

  const metricas = data?.metricas;
  const atencao = data?.atencao ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-0.5 text-sm text-[var(--color-texto-suave)]">
          Visão geral da sua prospecção.
        </p>
      </div>

      {/* ---- PRECISA DA SUA ATENÇÃO (vem antes dos números de propósito) ---- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-[var(--color-quente)]" aria-hidden="true" />
            Precisa da sua atenção
          </CardTitle>
          {atencao.length > 0 && (
            <Badge variant="quente">{atencao.length}</Badge>
          )}
        </CardHeader>
        <CardContent>
          {atencao.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Inbox
                className="h-8 w-8 text-[var(--color-texto-fraco)]"
                aria-hidden="true"
              />
              <p className="text-sm text-[var(--color-texto-suave)]">
                Nada exige sua atenção agora.
              </p>
              <p className="text-xs text-[var(--color-texto-fraco)]">
                Leads quentes, respostas não reconhecidas e pedidos de preview
                aparecem aqui primeiro.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-borda)]">
              {atencao.map((item) => (
                <li key={item.leadId} className="py-3">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                    onClick={() => setLeadAberto(item.leadId)}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {item.nome ?? 'Lead sem nome'}
                        </span>
                        <Badge variant={variantePorTemperatura(item.temperatura)}>
                          {item.temperatura.toLowerCase()}
                        </Badge>
                        {item.totalMotivos > 1 && (
                          <Badge variant="neutro">
                            +{item.totalMotivos - 1} motivo(s)
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--color-texto-suave)]">
                        {[item.categoria, item.bairro, item.cidade]
                          .filter(Boolean)
                          .join(' · ') || 'sem localização'}
                        {' · espera desde '}
                        {formatarDataHora(item.em)}
                      </p>
                      {item.ultimaMensagem && (
                        <p className="mt-1 truncate text-xs text-[var(--color-texto-fraco)]">
                          {item.ultimaMensagem}
                        </p>
                      )}
                    </div>

                    <Badge variant={varianteMotivo(item.motivo)}>
                      {item.acaoNecessaria}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---- Métricas ---- */}
      <section aria-label="Métricas">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {CARTOES.map(({ chave, rotulo, destaque }) => (
            <Card key={chave}>
              <div className="px-4 py-3.5">
                <div
                  className={`num text-2xl font-semibold ${
                    destaque ? COR_DESTAQUE[destaque] : ''
                  }`}
                >
                  {isLoading ? (
                    <span className="inline-block h-7 w-10 animate-pulse rounded bg-[var(--color-fundo)]" />
                  ) : (
                    formatarNumero(metricas?.[chave] ?? 0)
                  )}
                </div>
                <div className="mt-0.5 text-xs text-[var(--color-texto-suave)]">
                  {rotulo}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* ---- Campanha ativa ---- */}
      {data?.campanhaAtiva && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Rocket className="h-4 w-4" aria-hidden="true" />
              {data.campanhaAtiva.nome}
            </CardTitle>
            <Button variant="secundario" size="sm" asChild>
              <Link to={`/campanhas/${data.campanhaAtiva.id}`}>Abrir</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { rotulo: 'Na fila', valor: data.campanhaAtiva.totalLeads },
                {
                  rotulo: `Enviadas hoje (de ${data.campanhaAtiva.limiteDiario})`,
                  valor: data.campanhaAtiva.enviadasHoje,
                },
                { rotulo: 'Respostas', valor: data.campanhaAtiva.respostas },
                { rotulo: 'Quentes', valor: data.campanhaAtiva.quentes },
              ].map((c) => (
                <div key={c.rotulo} className="rounded-lg bg-[var(--color-fundo)] px-3 py-2">
                  <p className="num text-lg font-semibold">
                    {formatarNumero(c.valor)}
                  </p>
                  <p className="text-[11px] text-[var(--color-texto-suave)]">
                    {c.rotulo}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Funil ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Funil</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(data?.funil ?? []).map((etapa) => {
              const maximo = Math.max(...(data?.funil ?? []).map((e) => e.total), 1);
              const largura = (etapa.total / maximo) * 100;
              return (
                <div key={etapa.rotulo} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-[var(--color-texto-suave)]">
                    {etapa.rotulo}
                  </span>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-[var(--color-fundo)]">
                    <div
                      className="h-full rounded bg-[var(--color-marca)] transition-all"
                      style={{ width: `${Math.max(largura, etapa.total > 0 ? 2 : 0)}%` }}
                    />
                  </div>
                  <span className="num w-10 shrink-0 text-right text-xs font-medium">
                    {formatarNumero(etapa.total)}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-[var(--color-borda)] bg-white p-3 text-xs text-[var(--color-texto-suave)]">
        <TriangleAlert
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-morno)]"
          aria-hidden="true"
        />
        <span>
          <strong>Fase 5.</strong> Importação, CRM, campanhas, fila, tarefas e
          intervenção manual funcionando; todos os números vêm do banco. A
          integração com o WhatsApp entra na fase seguinte — nenhuma mensagem
          é enviada ainda.
        </span>
      </div>

      {leadAberto && (
        <LeadDetalhe leadId={leadAberto} onFechar={() => setLeadAberto(null)} />
      )}
    </div>
  );
}
