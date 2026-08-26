/**
 * Dashboard — o centro de comando.
 *
 * A ordem da pagina e uma decisao de produto, nao estetica: primeiro o
 * que exige acao sua, depois os numeros. Um lead quente esperando
 * resposta vale mais que qualquer grafico.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Flame, Inbox, TriangleAlert, Rocket, MessageSquareOff, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { get, post, del } from '@/lib/api';
import {
  Card, CardContent, CardHeader, CardTitle, Badge, Button,
  variantePorTemperatura,
} from '@/components/ui/primitives';
import { formatarNumero, formatarDataHora } from '@/lib/utils';
import { LeadDetalhe } from '@/components/LeadDetalhe';
import type {
  DashboardResponse,
  GrupoSemResposta,
  LeadSemResposta,
  ResumoPorNicho,
} from '@prospector/shared';

/**
 * Quem recebeu e nunca respondeu.
 *
 * ============================================================
 * POR QUE ISTO GANHOU LUGAR PROPRIO
 * ============================================================
 * Todo o resto desta pagina fala de leads que FIZERAM alguma coisa. O
 * grupo maior de qualquer prospeccao — quem recebeu a mensagem e ficou
 * calado — nao aparecia em lugar nenhum, nem para dizer quantos sao.
 *
 * Agrupado pela ultima etapa que saiu, e nao num numero so: quem ignorou
 * a abordagem pode nem ter visto; quem recebeu a proposta inteira e nao
 * respondeu ja e outra conversa, e pede outra acao.
 *
 * A lista so e buscada quando voce abre um grupo. Ela pode ser longa, e
 * carregar tudo a cada visita ao dashboard seria pagar caro por algo que
 * quase sempre nao e olhado.
 */
function SemResposta({ aoAbrirLead }: { aoAbrirLead: (id: string) => void }) {
  const [aberto, setAberto] = useState<number | null>(null);
  const cliente = useQueryClient();

  // ============================================================
  // "JA MANDEI PARA ESTE"
  // ============================================================
  // Esta lista e uma fila de trabalho: voce passa por ela abrindo o
  // WhatsApp e escrevendo na mao. Sem uma forma de riscar o que ja foi
  // feito, ela nunca encolhe.
  //
  // O lead marcado NAO some na hora. Ele fica riscado, com um "desfazer"
  // do lado, ate voce sair da secao — um clique errado numa lista de
  // trinta nomes tem que ter volta, e um item que evapora nao tem.
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});

  const marcar = useMutation({
    mutationFn: (leadId: string) =>
      post(`/api/leads/${leadId}/marcar-mandado`).then(() => leadId),
    onSuccess: (leadId) => {
      setMarcados((m) => ({ ...m, [leadId]: true }));
      // Os totais das outras secoes mudam junto: o lead saiu do silencio.
      void cliente.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const desfazer = useMutation({
    mutationFn: (leadId: string) =>
      del(`/api/leads/${leadId}/marcar-mandado`).then(() => leadId),
    onSuccess: (leadId) => {
      setMarcados((m) => {
        const { [leadId]: _fora, ...resto } = m;
        return resto;
      });
      void cliente.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-sem-resposta'],
    queryFn: () => get<{ grupos: GrupoSemResposta[] }>('/api/dashboard/sem-resposta'),
    refetchInterval: 60_000,
  });

  const grupos = data?.grupos ?? [];
  const total = grupos.reduce((soma, g) => soma + g.total, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <MessageSquareOff
            className="h-4 w-4 text-[var(--color-texto-suave)]"
            aria-hidden="true"
          />
          Não responderam
        </CardTitle>
        {total > 0 && <Badge variant="info">{total}</Badge>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-[var(--color-texto-fraco)]">
            Carregando…
          </p>
        ) : grupos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Inbox
              className="h-8 w-8 text-[var(--color-texto-fraco)]"
              aria-hidden="true"
            />
            <p className="text-sm text-[var(--color-texto-suave)]">
              Todo mundo que recebeu mensagem respondeu.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-borda)]">
            {grupos.map((g) => (
              <li key={g.ordem}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 py-3 text-left"
                  onClick={() => {
                    const fechando = aberto === g.ordem;
                    setAberto(fechando ? null : g.ordem);
                    // Ao fechar o grupo, a lista e relida: e quando os
                    // leads marcados finalmente saem dela. Riscar na hora
                    // e sumir na hora sao coisas diferentes — a segunda
                    // levaria o "desfazer" junto.
                    if (fechando) {
                      setMarcados({});
                      void cliente.invalidateQueries({
                        queryKey: ['dashboard-sem-resposta'],
                      });
                    }
                  }}
                  aria-expanded={aberto === g.ordem}
                >
                  <span className="flex items-center gap-2 text-sm">
                    {aberto === g.ordem ? (
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    )}
                    Não responderam a <strong>{g.rotulo}</strong>
                  </span>
                  <Badge variant="info">{g.total}</Badge>
                </button>

                {aberto === g.ordem && (
                  <ul className="pb-3 pl-6">
                    {g.leads.map((l: LeadSemResposta) => {
                      const jaMandei = marcados[l.leadId] === true;
                      return (
                        <li
                          key={l.leadId}
                          className="flex flex-wrap items-center gap-2 py-1.5"
                        >
                          <button
                            type="button"
                            className={`flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 text-left ${
                              jaMandei ? 'opacity-50 line-through' : ''
                            }`}
                            onClick={() => aoAbrirLead(l.leadId)}
                          >
                            <span className="min-w-0">
                              <span className="truncate text-sm font-medium">
                                {l.nome ?? 'Lead sem nome'}
                              </span>
                              <span className="ml-2 text-xs text-[var(--color-texto-fraco)]">
                                {[l.categoria, l.bairro, l.cidade]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            </span>
                            <span className="flex items-center gap-2">
                              <Badge variant={variantePorTemperatura(l.temperatura)}>
                                {l.temperatura.toLowerCase()}
                              </Badge>
                              <span className="text-xs text-[var(--color-texto-fraco)]">
                                calado desde {formatarDataHora(l.desde)}
                              </span>
                            </span>
                          </button>

                          {jaMandei ? (
                            <button
                              type="button"
                              className="shrink-0 text-xs text-[var(--color-texto-fraco)] underline"
                              onClick={() => desfazer.mutate(l.leadId)}
                              disabled={desfazer.isPending}
                            >
                              desfazer
                            </button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secundario"
                              className="shrink-0"
                              onClick={() => marcar.mutate(l.leadId)}
                              disabled={marcar.isPending}
                              title="Registra que você mandou mensagem na mão. Não envia nada."
                            >
                              <Check className="mr-1 h-3 w-3" aria-hidden="true" />
                              Já mandei
                            </Button>
                          )}
                        </li>
                      );
                    })}
                    {g.leads.length < g.total && (
                      <li className="py-1.5 text-xs text-[var(--color-texto-fraco)]">
                        …e mais {g.total - g.leads.length}. Use a tela de Leads
                        para ver todos.
                      </li>
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A prospecção separada por nicho.
 *
 * ============================================================
 * POR QUE ISTO GANHOU LUGAR PRÓPRIO
 * ============================================================
 * O nicho existia no banco desde a importação — "psicólogos em
 * Campinas" vira uma etiqueta em cada lead do lote — e não aparecia em
 * tela nenhuma. Todo número desta página era a soma de tudo, e a soma
 * de tudo esconde exatamente a decisão que a semana seguinte pede:
 * qual lista vale continuar.
 *
 * Estética automotiva com 40% de resposta e psicólogo com 4% davam um
 * único "22%" — um número que não descreve nenhum dos dois.
 *
 * A linha do total vem primeiro e fica destacada: é a leitura de "quanto
 * eu mandei no total", e ela é calculada sobre todos os leads de uma
 * vez, não somando as linhas de baixo.
 */
function PorNicho() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-nichos'],
    queryFn: () => get<ResumoPorNicho>('/api/dashboard/nichos'),
    refetchInterval: 60_000,
  });

  const linhas = data ? [data.total, ...data.nichos] : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Por nicho</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-[var(--color-texto-fraco)]">
            Carregando…
          </p>
        ) : linhas.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--color-texto-suave)]">
            Nenhum lead importado ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-borda)] text-left text-[11px] uppercase tracking-wide text-[var(--color-texto-fraco)]">
                  <th className="py-2 pr-3 font-medium">Nicho</th>
                  <th className="py-2 px-2 text-right font-medium">Leads</th>
                  <th className="py-2 px-2 text-right font-medium">Mandei</th>
                  <th className="py-2 px-2 text-right font-medium">Msgs</th>
                  <th className="py-2 px-2 text-right font-medium">Na fila</th>
                  <th className="py-2 px-2 text-right font-medium">Responderam</th>
                  <th className="py-2 px-2 text-right font-medium">Calados</th>
                  <th className="py-2 px-2 text-right font-medium">Taxa</th>
                  <th className="py-2 px-2 text-right font-medium">Quentes</th>
                  <th className="py-2 pl-2 text-right font-medium">Clientes</th>
                </tr>
              </thead>
              <tbody className="num">
                {linhas.map((n, i) => (
                  <tr
                    key={n.nicho}
                    className={`border-b border-[var(--color-borda)] last:border-0 ${
                      i === 0 ? 'bg-[var(--color-fundo)] font-semibold' : ''
                    }`}
                  >
                    <th
                      scope="row"
                      className="py-2 pr-3 text-left font-medium normal-case"
                    >
                      {n.nicho}
                    </th>
                    <td className="py-2 px-2 text-right">{formatarNumero(n.leads)}</td>
                    <td className="py-2 px-2 text-right">
                      {formatarNumero(n.abordados)}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {formatarNumero(n.enviadas)}
                    </td>
                    <td className="py-2 px-2 text-right text-[var(--color-texto-suave)]">
                      {formatarNumero(n.naFila)}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {formatarNumero(n.responderam)}
                    </td>
                    <td className="py-2 px-2 text-right text-[var(--color-texto-suave)]">
                      {formatarNumero(n.semResposta)}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {/* Sem ninguém abordado, "0%" seria uma afirmação
                          sobre um teste que não foi feito. */}
                      {n.taxaResposta === null ? '—' : `${n.taxaResposta}%`}
                    </td>
                    <td className="py-2 px-2 text-right">{formatarNumero(n.quentes)}</td>
                    <td className="py-2 pl-2 text-right">
                      {formatarNumero(n.clientes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-[var(--color-texto-fraco)]">
          <strong>Mandei</strong> são as pessoas que receberam ao menos uma
          mensagem; <strong>Msgs</strong> são as mensagens que saíram (um lead
          com 3 etapas conta 3). A taxa é sobre quem foi abordado, não sobre a
          lista inteira. Leads importados sem nicho aparecem como “Sem nicho”.
        </p>
      </CardContent>
    </Card>
  );
}

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

      {/* ---- Quem recebeu e ficou calado ---- */}
      <SemResposta aoAbrirLead={setLeadAberto} />

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

      <PorNicho />

      {/* ---- Onde a prospecção está ---- */}
      {/*
        O funil acima conta ESTADOS (quentes, clientes). Este conta
        POSIÇÃO na sequência, que é outra pergunta: vinte pessoas paradas
        na mensagem 1 e vinte espalhadas até a 4 dão exatamente os mesmos
        números lá em cima, e são duas semanas completamente diferentes.
      */}
      {(data?.porEtapa ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Onde os leads estão</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {(data?.porEtapa ?? []).map((e) => (
                <div
                  key={e.ordem}
                  className="rounded-lg border border-[var(--color-borda)] p-3"
                >
                  <p className="num text-xl font-semibold">
                    {formatarNumero(e.leads)}
                  </p>
                  <p className="text-[11px] text-[var(--color-texto-suave)]">
                    {e.rotulo}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-[var(--color-texto-fraco)]">
              Cada lead aparece uma vez só, na etapa mais avançada que
              chegou nele. Quem saiu (opt-out, encerrado, cliente) fica de
              fora.
            </p>
          </CardContent>
        </Card>
      )}

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
