/**
 * O relatório da semana.
 *
 * ============================================================
 * A PERGUNTA QUE ESTA TELA RESPONDE
 * ============================================================
 * O dashboard responde "como está agora". Esta tela responde "o que
 * aconteceu naquela semana" — e são perguntas diferentes. A primeira
 * decide o que fazer hoje; a segunda decide se a abordagem funciona.
 *
 * O calendário à esquerda só lista semanas que tiveram envio. Semana
 * parada não vira linha: "não mandei nada" já é visível pela ausência.
 *
 * ============================================================
 * O FUNIL DAQUI SE SOBREPÕE DE PROPÓSITO
 * ============================================================
 * Quem perguntou preço e depois fechou aparece nas duas linhas. Elas não
 * são fatias de uma pizza — são perguntas diferentes sobre o mesmo
 * grupo. As únicas mutuamente exclusivas são "não responderam" e
 * "responderam", e essas duas somam o total.
 *
 * A conta inteira mora em `montarRelatorioSemana`, no domínio, com 19
 * testes. Aqui é só apresentação.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Inbox, ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { get } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui/primitives';
import { formatarNumero } from '@/lib/utils';
import type { RelatorioSemana, ResumoDoDia } from '@prospector/shared';

interface SemanaNaLista {
  inicio: string;
  fim: string;
  enviadas: number;
  abordados: number;
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "4 a 10 de janeiro" — o rótulo humano de uma semana. */
function rotuloDaSemana(inicioISO: string): string {
  const inicio = new Date(inicioISO);
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + 6);

  const dia = (d: Date) => d.getDate();
  const mes = (d: Date) =>
    d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');

  // Mesma mês nos dois extremos: não repete o nome do mês.
  return mes(inicio) === mes(fim)
    ? `${dia(inicio)} a ${dia(fim)} de ${mes(inicio)}`
    : `${dia(inicio)} ${mes(inicio)} a ${dia(fim)} ${mes(fim)}`;
}

/** Chave estável de um dia: "2026-01-07", no fuso local. */
function chaveDoDia(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** O domingo 00:00 da semana em que `d` cai. Espelha o domínio. */
function domingoDa(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

/**
 * O calendário do mês, com as semanas como LINHAS.
 *
 * ============================================================
 * UMA GRADE, DOIS CLIQUES DIFERENTES
 * ============================================================
 * Clicar no rótulo da esquerda escolhe a SEMANA; clicar num dia abre o
 * resumo daquele DIA. São perguntas diferentes — "a abordagem funciona?"
 * e "o que saiu na terça?" — e juntá-las num controle só evita a tela
 * ter dois calendários dizendo a mesma coisa.
 *
 * Dias de outro mês aparecem apagados, mas continuam clicáveis: a semana
 * que atravessa a virada do mês é uma semana só, e cortá-la ao meio
 * esconderia metade dela.
 */
function Calendario({
  mes,
  aoMudarMes,
  porDia,
  semanaAtiva,
  aoEscolherSemana,
  diaAtivo,
  aoEscolherDia,
}: {
  mes: Date;
  aoMudarMes: (d: Date) => void;
  porDia: Map<string, number>;
  semanaAtiva: string | null;
  aoEscolherSemana: (iso: string) => void;
  diaAtivo: string | null;
  aoEscolherDia: (iso: string | null) => void;
}) {
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const ultimo = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);

  // As semanas que cobrem o mês, inclusive as que entram por fora.
  const linhas: Date[] = [];
  for (
    let d = domingoDa(primeiro);
    d <= ultimo;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)
  ) {
    linhas.push(d);
  }

  const hoje = chaveDoDia(new Date());
  const semanaAtivaMs = semanaAtiva ? domingoDa(new Date(semanaAtiva)).getTime() : null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          className="rounded p-1 hover:bg-[var(--color-fundo)]"
          onClick={() => aoMudarMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="text-sm font-medium capitalize">
          {mes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          className="rounded p-1 hover:bg-[var(--color-fundo)]"
          onClick={() => aoMudarMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <table className="w-full">
        <thead>
          <tr>
            <th className="w-8" />
            {DIAS.map((d) => (
              <th
                key={d}
                className="pb-1 text-center text-[11px] font-medium uppercase text-[var(--color-texto-fraco)]"
              >
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((domingo) => {
            const iso = domingo.toISOString();
            const daSemana = semanaAtivaMs === domingo.getTime();

            // O total da linha decide se vale oferecer o clique: uma
            // semana sem envio nenhum não tem relatório para mostrar.
            const totalDaSemana = Array.from({ length: 7 }, (_, i) => {
              const d = new Date(domingo);
              d.setDate(d.getDate() + i);
              return porDia.get(chaveDoDia(d)) ?? 0;
            }).reduce((t, n) => t + n, 0);

            return (
              <tr key={iso}>
                <td className="pr-1 align-middle">
                  <button
                    type="button"
                    className={`h-7 w-7 rounded text-[10px] ${
                      daSemana
                        ? 'bg-[var(--color-marca)] text-white'
                        : totalDaSemana > 0
                          ? 'text-[var(--color-texto-suave)] hover:bg-[var(--color-fundo)]'
                          : 'cursor-not-allowed text-[var(--color-texto-fraco)] opacity-40'
                    }`}
                    onClick={() => {
                      if (totalDaSemana === 0) return;
                      aoEscolherSemana(iso);
                      // Trocar de semana fecha o dia aberto: ele era da
                      // semana anterior, e deixá-lo aberto faria a tela
                      // mostrar duas semanas ao mesmo tempo.
                      aoEscolherDia(null);
                    }}
                    disabled={totalDaSemana === 0}
                    title={
                      totalDaSemana > 0
                        ? `Ver a semana de ${rotuloDaSemana(iso)}`
                        : 'Nenhuma mensagem saiu nesta semana'
                    }
                  >
                    sem
                  </button>
                </td>

                {Array.from({ length: 7 }, (_, i) => {
                  const d = new Date(domingo);
                  d.setDate(d.getDate() + i);
                  const chave = chaveDoDia(d);
                  const qtd = porDia.get(chave) ?? 0;
                  const foraDoMes = d.getMonth() !== mes.getMonth();
                  const ativo = diaAtivo === chave;

                  return (
                    <td key={chave} className="p-0.5 text-center">
                      <button
                        type="button"
                        className={`flex h-9 w-full flex-col items-center justify-center rounded text-[11px] leading-none ${
                          ativo
                            ? 'bg-[var(--color-marca)] text-white'
                            : qtd > 0
                              ? 'bg-[var(--color-fundo)] hover:ring-1 hover:ring-[var(--color-marca)]'
                              : 'hover:bg-[var(--color-fundo)]'
                        } ${foraDoMes && !ativo ? 'opacity-40' : ''} ${
                          chave === hoje && !ativo
                            ? 'ring-1 ring-[var(--color-borda)]'
                            : ''
                        }`}
                        onClick={() => aoEscolherDia(ativo ? null : chave)}
                        title={
                          qtd > 0
                            ? `${qtd} mensagem(ns) em ${d.toLocaleDateString('pt-BR')}`
                            : d.toLocaleDateString('pt-BR')
                        }
                      >
                        <span className="num">{d.getDate()}</span>
                        {qtd > 0 && (
                          <span
                            className={`num mt-0.5 text-[9px] ${
                              ativo ? 'opacity-80' : 'text-[var(--color-texto-fraco)]'
                            }`}
                          >
                            {qtd}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-3 text-[11px] text-[var(--color-texto-fraco)]">
        O número menor em cada dia são as mensagens que saíram. Clique num
        <strong> dia</strong> para o resumo dele, ou em <strong>sem</strong> à
        esquerda para o relatório da semana inteira.
      </p>
    </div>
  );
}

/** O resumo de um dia — a linha do tempo do que saiu e do que voltou. */
function PainelDoDia({ chave, aoFechar }: { chave: string; aoFechar: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['dia', chave],
    // A chave é local ("2026-01-07"); `new Date` no servidor a lê como
    // meia-noite local dele, que é a mesma máquina. Mandar ISO com fuso
    // aqui é o que faria o dia escorregar.
    queryFn: () => get<ResumoDoDia>(`/api/dias/${chave}`),
  });

  const rotulo = new Date(`${chave}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="capitalize">{rotulo}</CardTitle>
        <button
          type="button"
          className="text-xs text-[var(--color-texto-fraco)] underline"
          onClick={aoFechar}
        >
          fechar
        </button>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <p className="py-6 text-center text-sm text-[var(--color-texto-fraco)]">
            Carregando…
          </p>
        ) : data.enviadas === 0 && data.respostas === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--color-texto-suave)]">
            Nada saiu e nada chegou neste dia.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-[var(--color-borda)] p-3">
                <p className="num text-xl font-semibold">
                  {formatarNumero(data.enviadas)}
                </p>
                <p className="text-[11px] text-[var(--color-texto-suave)]">
                  mensagens saíram
                </p>
              </div>
              <div className="rounded-lg border border-[var(--color-borda)] p-3">
                <p className="num text-xl font-semibold">
                  {formatarNumero(data.pessoasAbordadas)}
                </p>
                <p className="text-[11px] text-[var(--color-texto-suave)]">
                  pessoas abordadas
                </p>
              </div>
              <div className="rounded-lg border border-[var(--color-borda)] p-3">
                <p className="num text-xl font-semibold">
                  {formatarNumero(data.respostas)}
                </p>
                <p className="text-[11px] text-[var(--color-texto-suave)]">
                  respostas chegaram
                </p>
              </div>
            </div>

            {data.porEtapa.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {data.porEtapa.map((e) => (
                  <Badge key={e.ordem} variant="neutro">
                    {e.rotulo}: {formatarNumero(e.enviadas)}
                  </Badge>
                ))}
                {data.porNicho.map((n) => (
                  <Badge key={n.nicho} variant="info">
                    {n.nicho}: {formatarNumero(n.enviadas)}
                  </Badge>
                ))}
              </div>
            )}

            {data.listaRespostas.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                  <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  O que voltou
                </p>
                <ul className="divide-y divide-[var(--color-borda)]">
                  {data.listaRespostas.map((r, i) => (
                    <li key={`${r.leadId}-${i}`} className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {r.nome ?? 'Lead sem nome'}
                        </span>
                        {r.categoria ? (
                          <Badge variant="info">{r.categoria.toLowerCase()}</Badge>
                        ) : (
                          <Badge variant="neutro">não entendida</Badge>
                        )}
                        <span className="num text-[11px] text-[var(--color-texto-fraco)]">
                          {new Date(r.quando).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-[var(--color-texto-suave)]">
                        {r.texto}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.envios.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  O que saiu
                </p>
                <ul className="divide-y divide-[var(--color-borda)]">
                  {data.envios.map((e, i) => (
                    <li
                      key={`${e.leadId}-${i}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                    >
                      <span className="text-sm">{e.nome ?? 'Lead sem nome'}</span>
                      <span className="flex items-center gap-2">
                        <Badge variant="neutro">
                          {e.etapaNome?.trim() || `Mensagem ${e.ordem}`}
                        </Badge>
                        <span className="num text-[11px] text-[var(--color-texto-fraco)]">
                          {new Date(e.quando).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-[11px] text-[var(--color-texto-fraco)]">
              As duas listas são independentes: a resposta que chegou hoje quase
              sempre é sobre uma mensagem de ontem. Por isso não há “taxa de
              resposta do dia” — ela não teria significado.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Uma linha do funil. `de` desenha a barra proporcional. */
function LinhaFunil({
  rotulo,
  valor,
  de,
  nota,
}: {
  rotulo: string;
  valor: number;
  de: number;
  nota?: string;
}) {
  const largura = de > 0 ? (valor / de) * 100 : 0;

  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 text-xs text-[var(--color-texto-suave)]">
        {rotulo}
      </span>
      <div className="h-5 flex-1 overflow-hidden rounded bg-[var(--color-fundo)]">
        <div
          className="h-full rounded bg-[var(--color-marca)] transition-all"
          style={{ width: `${Math.max(largura, valor > 0 ? 2 : 0)}%` }}
        />
      </div>
      <span className="num w-10 shrink-0 text-right text-xs font-medium">
        {formatarNumero(valor)}
      </span>
      <span className="w-14 shrink-0 text-right text-[11px] text-[var(--color-texto-fraco)]">
        {nota ?? (de > 0 && valor > 0 ? `${Math.round(largura)}%` : '')}
      </span>
    </div>
  );
}

export function Semanas() {
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [mes, setMes] = useState(() => {
    const hoje = new Date();
    return new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  });

  const { data: lista, isLoading: carregandoLista } = useQuery({
    queryKey: ['semanas'],
    queryFn: () =>
      get<{ semanas: SemanaNaLista[]; dias: { dia: string; enviadas: number }[] }>(
        '/api/semanas'
      ),
  });

  const semanas = lista?.semanas ?? [];
  const porDia = new Map(
    (lista?.dias ?? []).map((d) => [chaveDoDia(new Date(d.dia)), d.enviadas])
  );
  // Sem escolha explícita, a mais recente — que é a que você quer ver ao
  // abrir a tela.
  const alvo = selecionada ?? semanas[0]?.inicio ?? null;

  const { data: relatorio, isLoading: carregandoRelatorio } = useQuery({
    queryKey: ['semana', alvo],
    queryFn: () => get<RelatorioSemana>(`/api/semanas/${encodeURIComponent(alvo!)}`),
    enabled: alvo !== null,
  });

  const f = relatorio?.funil;
  const picoDoDia = Math.max(...(relatorio?.porDia ?? []).map((d) => d.enviadas), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Semanas</h1>
        <p className="mt-0.5 text-sm text-[var(--color-texto-suave)]">
          O que aconteceu com quem você abordou em cada semana.
        </p>
      </div>

      {carregandoLista ? (
        <p className="py-8 text-center text-sm text-[var(--color-texto-fraco)]">
          Carregando…
        </p>
      ) : semanas.length === 0 ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Inbox className="h-8 w-8 text-[var(--color-texto-fraco)]" aria-hidden="true" />
              <p className="text-sm text-[var(--color-texto-suave)]">
                Nenhuma mensagem saiu ainda.
              </p>
              <p className="text-xs text-[var(--color-texto-fraco)]">
                As semanas aparecem aqui assim que a primeira campanha rodar.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* ---- O calendário ---- */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                Calendário
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Calendario
                mes={mes}
                aoMudarMes={setMes}
                porDia={porDia}
                semanaAtiva={alvo}
                aoEscolherSemana={setSelecionada}
                diaAtivo={dia}
                aoEscolherDia={setDia}
              />
            </CardContent>
          </Card>

          <div className="space-y-6">
            {/* O dia escolhido vem ANTES do relatório da semana: você
                clicou nele agora, e é o que quer ver. */}
            {dia !== null && <PainelDoDia chave={dia} aoFechar={() => setDia(null)} />}

            {carregandoRelatorio || !relatorio || !f ? (
              <p className="py-8 text-center text-sm text-[var(--color-texto-fraco)]">
                Carregando…
              </p>
            ) : (
              <>
                {/* ---- Volume por dia ---- */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>
                      {rotuloDaSemana(relatorio.inicio)}
                    </CardTitle>
                    <Badge variant="info">
                      {formatarNumero(relatorio.enviadas)} mensagens
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-2">
                      {relatorio.porDia.map((d, i) => (
                        <div key={d.dia} className="flex flex-1 flex-col items-center gap-1">
                          <span className="num text-[11px] text-[var(--color-texto-fraco)]">
                            {d.enviadas > 0 ? formatarNumero(d.enviadas) : ''}
                          </span>
                          <div
                            className="w-full rounded-t bg-[var(--color-marca)]"
                            style={{
                              // Altura mínima visível para o dia com
                              // envio; zero fica realmente vazio, que é o
                              // que faz a rajada aparecer.
                              height: `${Math.max((d.enviadas / picoDoDia) * 80, d.enviadas > 0 ? 4 : 0)}px`,
                            }}
                          />
                          <span className="text-[11px] text-[var(--color-texto-suave)]">
                            {DIAS[i]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* ---- O funil ---- */}
                <Card>
                  <CardHeader>
                    <CardTitle>O que aconteceu com eles</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <LinhaFunil
                        rotulo="Abordados"
                        valor={f.abordados}
                        de={f.abordados}
                        nota="pessoas"
                      />
                      <LinhaFunil
                        rotulo="Não responderam"
                        valor={f.semResposta}
                        de={f.abordados}
                      />
                      <LinhaFunil
                        rotulo="Responderam"
                        valor={f.responderam}
                        de={f.abordados}
                      />
                      <LinhaFunil
                        rotulo="Disseram não"
                        valor={f.negativos}
                        de={f.abordados}
                      />
                      <LinhaFunil
                        rotulo="Demonstraram interesse"
                        valor={f.interessados}
                        de={f.abordados}
                      />
                      <LinhaFunil
                        rotulo="Perguntaram preço"
                        valor={f.perguntaramPreco}
                        de={f.abordados}
                      />
                      <LinhaFunil
                        rotulo="Receberam a prévia"
                        valor={f.receberamPrevia}
                        de={f.abordados}
                      />
                      <LinhaFunil
                        rotulo="Fecharam"
                        valor={f.fecharam}
                        de={f.abordados}
                      />
                    </div>

                    {f.naoEntendidas > 0 && (
                      <p className="mt-3 rounded-lg bg-[var(--color-fundo)] p-3 text-xs text-[var(--color-texto-suave)]">
                        <strong>{formatarNumero(f.naoEntendidas)}</strong>{' '}
                        {f.naoEntendidas === 1 ? 'pessoa respondeu' : 'pessoas responderam'}{' '}
                        algo que o sistema não conseguiu classificar. Elas contam
                        em “responderam”, mas não entram em nenhuma linha de
                        intenção.
                      </p>
                    )}

                    <p className="mt-3 text-[11px] text-[var(--color-texto-fraco)]">
                      As linhas se sobrepõem de propósito: quem perguntou preço e
                      depois fechou aparece nas duas. Só “não responderam” e
                      “responderam” são exclusivas — essas duas somam o total.
                      Resposta que chegou depois do fim da semana também conta.
                    </p>
                  </CardContent>
                </Card>

                {/* ---- Onde a conversa parou ---- */}
                {relatorio.travou.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Onde a conversa parou</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {relatorio.travou.map((t) => (
                          <div
                            key={t.ordem}
                            className="rounded-lg border border-[var(--color-borda)] p-3"
                          >
                            <p className="num text-xl font-semibold">
                              {formatarNumero(t.leads)}
                            </p>
                            <p className="text-[11px] text-[var(--color-texto-suave)]">
                              {t.rotulo}
                            </p>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-[11px] text-[var(--color-texto-fraco)]">
                        A etapa mais avançada que chegou em cada pessoa — não onde
                        ela respondeu pela última vez.
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* ---- Por nicho ---- */}
                {relatorio.porNicho.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Por nicho, naquela semana</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] text-sm">
                          <thead>
                            <tr className="border-b border-[var(--color-borda)] text-left text-[11px] uppercase tracking-wide text-[var(--color-texto-fraco)]">
                              <th className="py-2 pr-3 font-medium">Nicho</th>
                              <th className="py-2 px-2 text-right font-medium">Msgs</th>
                              <th className="py-2 px-2 text-right font-medium">Pessoas</th>
                              <th className="py-2 px-2 text-right font-medium">Responderam</th>
                              <th className="py-2 px-2 text-right font-medium">Interesse</th>
                              <th className="py-2 pl-2 text-right font-medium">Fecharam</th>
                            </tr>
                          </thead>
                          <tbody className="num">
                            {relatorio.porNicho.map((n) => (
                              <tr
                                key={n.nicho}
                                className="border-b border-[var(--color-borda)] last:border-0"
                              >
                                <th
                                  scope="row"
                                  className="py-2 pr-3 text-left font-medium normal-case"
                                >
                                  {n.nicho}
                                </th>
                                <td className="py-2 px-2 text-right">
                                  {formatarNumero(n.enviadas)}
                                </td>
                                <td className="py-2 px-2 text-right">
                                  {formatarNumero(n.funil.abordados)}
                                </td>
                                <td className="py-2 px-2 text-right">
                                  {formatarNumero(n.funil.responderam)}
                                </td>
                                <td className="py-2 px-2 text-right">
                                  {formatarNumero(n.funil.interessados)}
                                </td>
                                <td className="py-2 pl-2 text-right">
                                  {formatarNumero(n.funil.fecharam)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
