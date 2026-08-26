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
import { CalendarDays, Inbox } from 'lucide-react';
import { get } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui/primitives';
import { formatarNumero } from '@/lib/utils';
import type { RelatorioSemana } from '@prospector/shared';

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

  const { data: lista, isLoading: carregandoLista } = useQuery({
    queryKey: ['semanas'],
    queryFn: () => get<{ semanas: SemanaNaLista[] }>('/api/semanas'),
  });

  const semanas = lista?.semanas ?? [];
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
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          {/* ---- O calendário ---- */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                Semanas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {semanas.map((s) => {
                  const ativa = s.inicio === alvo;
                  return (
                    <li key={s.inicio}>
                      <button
                        type="button"
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm ${
                          ativa
                            ? 'bg-[var(--color-marca)] text-white'
                            : 'hover:bg-[var(--color-fundo)]'
                        }`}
                        onClick={() => setSelecionada(s.inicio)}
                        aria-current={ativa ? 'true' : undefined}
                      >
                        <span>{rotuloDaSemana(s.inicio)}</span>
                        <span
                          className={`num text-xs ${
                            ativa ? 'opacity-80' : 'text-[var(--color-texto-fraco)]'
                          }`}
                        >
                          {formatarNumero(s.enviadas)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-[11px] text-[var(--color-texto-fraco)]">
                Só aparecem semanas em que alguma mensagem saiu. A semana vai
                de domingo a sábado.
              </p>
            </CardContent>
          </Card>

          <div className="space-y-6">
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
