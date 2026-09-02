/**
 * Detalhe da campanha — etapas, previa e fila.
 *
 * A previa e o coracao desta tela. Ela mostra, lead a lead, o texto
 * EXATO que sairia, e nao grava nada no banco. E onde voce descobre que
 * uma mensagem ficou estranha antes de ela existir.
 */
import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Loader2, Plus, Trash2, ArrowUp, ArrowDown, Eye, ListOrdered,
  Play, Pause, ShieldCheck, AlertTriangle, Inbox, Save, Users, Settings2,
  BellRing,
} from 'lucide-react';
import { get, post, put, patch, del, ApiError } from '@/lib/api';
import {
  Button, Card, CardContent, CardHeader, CardTitle, Badge, Input,
  Textarea, Checkbox,
} from '@/components/ui/primitives';
import { formatarNumero, formatarDataHora, cn } from '@/lib/utils';
import { FiltrosLead, type Filtros } from '@/components/campanha/FiltrosLead';
import { varianteStatus, rotuloStatusCampanha } from '@/pages/Campanhas';
import { ConfiguracoesCampanha } from '@/components/campanha/ConfiguracoesCampanha';

/**
 * Atalhos de variavel oferecidos abaixo do texto.
 *
 * Os dois primeiros sao os corretos para prospeccao:
 *
 *   nome_abordagem       so o nome de uma PESSOA declarada. Sem ela, a
 *                        saudacao vira "Oi!" — nunca "Oi, Barbearia!"
 *   nome_estabelecimento o nome do lugar, para "Encontrei o X no Google"
 *
 * `nome`, `primeiro_nome` e `empresa` continuam na lista por causa das
 * campanhas ja escritas, mas ficam no FIM: quem monta um texto novo deve
 * tropecar primeiro nos dois de cima.
 */
const VARIAVEIS = [
  'nome_abordagem', 'nome_estabelecimento',
  'cidade', 'bairro', 'estado', 'categoria', 'telefone',
  'avaliacao', 'totalAvaliacoes',
  'empresa', 'nome', 'primeiro_nome',
];

interface Etapa {
  id?: string;
  ordem: number;
  nome: string | null;
  texto: string;
  templateId: string | null;
  ativo: boolean;
  enviarAutomaticamente: boolean;
  aguardarResposta: boolean;
  notificarAoChegar: boolean;
  notificacaoTexto: string | null;
}

interface Campanha {
  id: string;
  nome: string;
  descricao: string | null;
  status: string;
  dryRun: boolean;
  horarioInicio: string;
  horarioFim: string;
  diasPermitidos: number[];
  limiteDiarioEnvios: number;
  limiteHorarioEnvios: number;
  delayEntreLeadsMinSegundos: number;
  delayEntreLeadsMaxSegundos: number;
  delayMinSegundos: number;
  delayMaxSegundos: number;
  maxLeads: number;
  filtros: Filtros | null;
  steps: Etapa[];
}

interface LinhaPreview {
  leadId: string;
  empresa: string | null;
  telefone: string | null;
  cidade: string | null;
  temSite: boolean;
  qualificacao: string;
  motivo: string;
  mensagemPrevista: string | null;
  motivoBloqueioMensagem: string | null;
}

interface Preview {
  resumo: {
    totalEncontrados: number;
    elegiveis: number;
    bloqueados: number;
    naoQualificados: number;
    revisar: number;
    semTelefone: number;
    optOut: number;
    jaContatados: number;
    prontos: number;
  };
  linhas: LinhaPreview[];
  truncado: boolean;
  templateUsado: string | null;
}

interface MensagemFila {
  id: string;
  status: string;
  motivoBloqueio: string | null;
  detalheBloqueio: string | null;
  telefoneDestino: string | null;
  textoRenderizado: string | null;
  scheduledAt: string | null;
  dryRun: boolean;
  lead: { id: string; nomeCompleto: string | null; empresa: string | null };
}

type Aba = 'etapas' | 'publico' | 'previa' | 'fila' | 'config';

function varianteQualificacao(q: string): 'sucesso' | 'morno' | 'alerta' | 'neutro' {
  if (q === 'QUALIFICADO') return 'sucesso';
  if (q === 'REVISAR') return 'morno';
  if (q === 'BLOQUEADO' || q === 'NAO_QUALIFICADO') return 'alerta';
  return 'neutro';
}

function varianteFila(s: string): 'sucesso' | 'info' | 'morno' | 'alerta' | 'neutro' {
  if (s === 'ENVIADA') return 'sucesso';
  if (s === 'SIMULADA') return 'info';
  if (s === 'AGENDADA' || s === 'PENDENTE') return 'neutro';
  if (s === 'BLOQUEADA' || s === 'FALHOU') return 'alerta';
  return 'morno';
}

/** "LEAD_SEM_TELEFONE" => "Lead sem telefone". */
function humanizar(v: string | null): string {
  if (!v) return '—';
  const s = v.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------- editor etapas
function EditorEtapas({ campanha }: { campanha: Campanha }) {
  const queryClient = useQueryClient();
  const [etapas, setEtapas] = useState<Etapa[]>(
    campanha.steps.length > 0
      ? campanha.steps
      : [
          {
            ordem: 1,
            nome: 'Abordagem',
            texto: '',
            templateId: null,
            ativo: true,
            enviarAutomaticamente: true,
            aguardarResposta: true,
            notificarAoChegar: false,
            notificacaoTexto: null,
          },
        ]
  );

  const salvar = useMutation({
    mutationFn: () =>
      put(`/api/campaigns/${campanha.id}/steps`, {
        // A ordem enviada e sempre a posicao atual na lista. Confiar no
        // campo `ordem` antigo deixaria buracos depois de remover uma
        // etapa, e o backend rejeita ordens duplicadas.
        etapas: etapas.map((e, i) => ({
          ordem: i + 1,
          nome: e.nome,
          texto: e.texto,
          templateId: e.templateId,
          ativo: e.ativo,
          enviarAutomaticamente: e.enviarAutomaticamente,
          aguardarResposta: e.aguardarResposta,
          notificarAoChegar: e.notificarAoChegar,
          notificacaoTexto: e.notificacaoTexto,
        })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campanha', campanha.id] });
      void queryClient.invalidateQueries({ queryKey: ['campanhas'] });
    },
  });

  const atualizar = (indice: number, mudancas: Partial<Etapa>): void =>
    setEtapas((atual) =>
      atual.map((e, i) => (i === indice ? { ...e, ...mudancas } : e))
    );

  const mover = (indice: number, direcao: -1 | 1): void =>
    setEtapas((atual) => {
      const destino = indice + direcao;
      if (destino < 0 || destino >= atual.length) return atual;
      const copia = [...atual];
      const [movida] = copia.splice(indice, 1);
      copia.splice(destino, 0, movida!);
      return copia;
    });

  const remover = (indice: number): void =>
    setEtapas((atual) => atual.filter((_, i) => i !== indice));

  const adicionar = (): void =>
    setEtapas((atual) => [
      ...atual,
      {
        ordem: atual.length + 1,
        nome: `Follow-up ${atual.length}`,
        texto: '',
        templateId: null,
        ativo: true,
        enviarAutomaticamente: true,
        aguardarResposta: true,
        notificarAoChegar: false,
        notificacaoTexto: null,
      },
    ]);

  const inserirVariavel = (indice: number, variavel: string): void =>
    atualizar(indice, { texto: `${etapas[indice]?.texto ?? ''}{{${variavel}}}` });

  const semTexto = etapas.some((e) => e.texto.trim() === '' && !e.templateId);

  return (
    <div className="space-y-4">
      {etapas.map((etapa, i) => (
        <Card key={i}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-marca)] text-xs font-semibold text-white">
                  {i + 1}
                </span>
                <Input
                  aria-label={`Nome da etapa ${i + 1}`}
                  className="h-8 w-48 text-sm"
                  value={etapa.nome ?? ''}
                  placeholder="Nome da etapa"
                  onChange={(e) => atualizar(i, { nome: e.target.value || null })}
                />
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="fantasma"
                  size="icone"
                  aria-label={`Mover etapa ${i + 1} para cima`}
                  disabled={i === 0}
                  onClick={() => mover(i, -1)}
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="fantasma"
                  size="icone"
                  aria-label={`Mover etapa ${i + 1} para baixo`}
                  disabled={i === etapas.length - 1}
                  onClick={() => mover(i, 1)}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="fantasma"
                  size="icone"
                  aria-label={`Remover etapa ${i + 1}`}
                  disabled={etapas.length === 1}
                  onClick={() => remover(i)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              aria-label={`Texto da etapa ${i + 1}`}
              rows={4}
              value={etapa.texto}
              placeholder="Oi, {{nome_abordagem}}! Encontrei o {{nome_estabelecimento}} no Google…"
              onChange={(e) => atualizar(i, { texto: e.target.value })}
            />

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-[var(--color-texto-suave)]">
                Inserir:
              </span>
              {VARIAVEIS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => inserirVariavel(i, v)}
                  className="rounded-md border border-[var(--color-borda)] bg-[var(--color-fundo)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-texto-suave)] hover:border-[var(--color-marca)] hover:text-[var(--color-texto)]"
                >
                  {v}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-4 border-t border-[var(--color-borda)] pt-3">
              <Checkbox
                rotulo="Etapa ativa"
                checked={etapa.ativo}
                onChange={(e) => atualizar(i, { ativo: e.target.checked })}
              />
              <Checkbox
                rotulo="Enviar automaticamente"
                checked={etapa.enviarAutomaticamente}
                onChange={(e) =>
                  atualizar(i, { enviarAutomaticamente: e.target.checked })
                }
              />
              <Checkbox
                rotulo="Aguardar resposta"
                checked={etapa.aguardarResposta}
                onChange={(e) => atualizar(i, { aguardarResposta: e.target.checked })}
              />
            </div>

            {/* Aviso na CHEGADA da etapa — diferente das regras por
                resposta. É assim que o trabalho manual no meio da
                sequência ("montar a prévia deste") vem te procurar, em
                vez de depender de você olhar o quadro. */}
            <div className="space-y-2 rounded-lg border border-[var(--color-borda)] bg-[var(--color-fundo)] p-3">
              <Checkbox
                rotulo="Me avisar quando um lead chegar nesta etapa"
                checked={etapa.notificarAoChegar}
                onChange={(e) =>
                  atualizar(i, { notificarAoChegar: e.target.checked })
                }
              />

              {etapa.notificarAoChegar && (
                <>
                  <Input
                    aria-label={`Texto do aviso da etapa ${i + 1}`}
                    value={etapa.notificacaoTexto ?? ''}
                    placeholder="Ex: Montar a prévia do site deste lead"
                    onChange={(e) =>
                      atualizar(i, { notificacaoTexto: e.target.value || null })
                    }
                  />
                  <p className="flex items-start gap-1.5 text-xs text-[var(--color-texto-suave)]">
                    <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    O aviso aparece em <strong>Notificações</strong> e no sino,
                    com link direto para a conversa. Vale também em simulação.
                  </p>
                </>
              )}
            </div>

            <p className="text-xs text-[var(--color-texto-suave)]">
              {etapa.texto.length} caracteres
            </p>
          </CardContent>
        </Card>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secundario" onClick={adicionar}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Adicionar etapa
        </Button>
        <Button onClick={() => salvar.mutate()} disabled={semTexto || salvar.isPending}>
          {salvar.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="h-4 w-4" aria-hidden="true" />
          )}
          Salvar etapas
        </Button>
        {salvar.isSuccess && (
          <span className="text-sm text-[var(--color-sucesso)]">Etapas salvas.</span>
        )}
      </div>

      {semTexto && (
        <p className="text-sm text-[var(--color-alerta)]">
          Toda etapa precisa de um texto antes de salvar.
        </p>
      )}
      {salvar.isError && (
        <p className="text-sm text-[var(--color-alerta)]">
          {salvar.error instanceof ApiError
            ? salvar.error.message
            : 'Não foi possível salvar'}
        </p>
      )}
    </div>
  );
}

// --------------------------------------------------------------- previa
function Previa({ campanha }: { campanha: Campanha }) {
  const queryClient = useQueryClient();
  const [leadAberto, setLeadAberto] = useState<string | null>(null);
  /**
   * Leads escolhidos a mao. Vazio = enfileira todos os prontos.
   *
   * Existe para o primeiro envio real: voce quer escolher QUEM recebe,
   * nao aceitar os que a ordenacao entregou primeiro.
   */
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const alternar = (leadId: string): void =>
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(leadId)) novo.delete(leadId);
      else novo.add(leadId);
      return novo;
    });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['campanha-previa', campanha.id],
    queryFn: () => get<Preview>(`/api/campaigns/${campanha.id}/preview?limite=100`),
  });

  const enfileirar = useMutation({
    mutationFn: () =>
      post<{ criadas: number; atualizadas: number; jaExistiam: number; bloqueadas: number }>(
        `/api/campaigns/${campanha.id}/enfileirar`,
        selecionados.size > 0 ? { leadIds: [...selecionados] } : undefined
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campanha-fila', campanha.id] });
      void queryClient.invalidateQueries({ queryKey: ['campanhas'] });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-sm text-[var(--color-texto-suave)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Montando a prévia…
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 py-8">
          <AlertTriangle
            className="h-5 w-5 shrink-0 text-[var(--color-alerta)]"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium">Não foi possível gerar a prévia</p>
            <p className="text-sm text-[var(--color-texto-suave)]">
              {error instanceof ApiError
                ? error.message
                : 'A campanha precisa de uma etapa ativa com texto.'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const r = data.resumo;
  const cartoes = [
    { rotulo: 'Encontrados', valor: r.totalEncontrados },
    { rotulo: 'Prontos', valor: r.prontos },
    { rotulo: 'Revisar', valor: r.revisar },
    { rotulo: 'Bloqueados', valor: r.bloqueados },
    { rotulo: 'Sem telefone', valor: r.semTelefone },
    { rotulo: 'Já contatados', valor: r.jaContatados },
  ];

  return (
    <div className="space-y-4">
      <Card className="border-[var(--color-info)]">
        <CardContent className="flex gap-3 pt-5">
          <ShieldCheck
            className="h-5 w-5 shrink-0 text-[var(--color-info)]"
            aria-hidden="true"
          />
          <p className="text-xs leading-relaxed text-[var(--color-texto-suave)]">
            Esta prévia <strong>não grava nada</strong> e{' '}
            <strong>não envia nada</strong>. É exatamente o texto que sairia
            para cada lead.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cartoes.map((c) => (
          <Card key={c.rotulo}>
            <CardContent className="pt-5">
              <p className="text-lg font-semibold">{formatarNumero(c.valor)}</p>
              <p className="text-xs text-[var(--color-texto-suave)]">{c.rotulo}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.templateUsado && (
        <Card>
          <CardHeader>
            <CardTitle>Template da primeira etapa</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap rounded-lg bg-[var(--color-fundo)] p-3 font-mono text-xs leading-relaxed">
              {data.templateUsado}
            </pre>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* So campanha ATIVA enfileira — o backend recusa o resto. Melhor
            dizer isso aqui do que deixar o clique falhar com 422. */}
        <Button
          onClick={() => enfileirar.mutate()}
          disabled={
            enfileirar.isPending ||
            campanha.status !== 'ATIVA' ||
            (selecionados.size === 0 && r.prontos === 0)
          }
        >
          {enfileirar.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          {selecionados.size > 0
            ? `Enfileirar ${selecionados.size} selecionado${selecionados.size === 1 ? '' : 's'} (dry-run)`
            : `Enfileirar ${formatarNumero(r.prontos)} mensagens (dry-run)`}
        </Button>
        {campanha.status !== 'ATIVA' && (
          <span className="text-sm text-[var(--color-texto-suave)]">
            Ative a campanha para poder enfileirar.
          </span>
        )}
        {enfileirar.isSuccess && (
          <span className="text-sm text-[var(--color-sucesso)]">
            {enfileirar.data.criadas} criadas, {enfileirar.data.atualizadas} atualizadas, {enfileirar.data.jaExistiam} já
            existiam, {enfileirar.data.bloqueadas} bloqueadas.
          </span>
        )}
        {enfileirar.isError && (
          <span className="text-sm text-[var(--color-alerta)]">
            {enfileirar.error instanceof ApiError
              ? enfileirar.error.message
              : 'Falha ao enfileirar'}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-[var(--color-texto-suave)]">
          {selecionados.size === 0
            ? 'Nenhum lead marcado — enfileira todos os prontos.'
            : `${selecionados.size} de ${data.linhas.length} marcados.`}
        </span>
        {selecionados.size > 0 && (
          <button
            type="button"
            onClick={() => setSelecionados(new Set())}
            className="underline underline-offset-2 hover:text-[var(--color-texto)]"
          >
            limpar seleção
          </button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-[var(--color-borda)]">
            {data.linhas.map((l) => (
              <li key={l.leadId} className="flex gap-3 px-5 py-4">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0"
                  aria-label={`Selecionar ${l.empresa ?? 'lead'}`}
                  checked={selecionados.has(l.leadId)}
                  onChange={() => alternar(l.leadId)}
                />

                <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 text-left"
                  aria-expanded={leadAberto === l.leadId}
                  onClick={() =>
                    setLeadAberto((atual) => (atual === l.leadId ? null : l.leadId))
                  }
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {l.empresa ?? 'Sem nome'}
                    </p>
                    <p className="text-xs text-[var(--color-texto-suave)]">
                      {[l.cidade, l.telefone].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <Badge variant={varianteQualificacao(l.qualificacao)}>
                    {humanizar(l.qualificacao)}
                  </Badge>
                </button>

                {l.mensagemPrevista ? (
                  <p
                    className={cn(
                      'mt-2 rounded-lg bg-[var(--color-fundo)] px-3 py-2 text-sm leading-relaxed',
                      leadAberto !== l.leadId && 'line-clamp-2'
                    )}
                  >
                    {l.mensagemPrevista}
                  </p>
                ) : (
                  <p className="mt-2 rounded-lg bg-[var(--color-alerta-bg)] px-3 py-2 text-sm text-[var(--color-alerta)]">
                    Sem mensagem: {l.motivoBloqueioMensagem ?? l.motivo}
                  </p>
                )}

                {leadAberto === l.leadId && (
                  <p className="mt-2 text-xs text-[var(--color-texto-suave)]">
                    Motivo da qualificação: {l.motivo} ·{' '}
                    <Link
                      to="/leads"
                      className="underline hover:text-[var(--color-texto)]"
                    >
                      ver no CRM
                    </Link>
                  </p>
                )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {data.truncado && (
        <p className="text-xs text-[var(--color-texto-suave)]">
          Mostrando os primeiros 100 leads. O enfileiramento considera todos.
        </p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- fila
function Fila({ campanhaId }: { campanhaId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['campanha-fila', campanhaId],
    queryFn: () =>
      get<{ mensagens: MensagemFila[]; contagem: Record<string, number> }>(
        `/api/campaigns/${campanhaId}/fila`
      ),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-sm text-[var(--color-texto-suave)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Carregando a fila…
        </CardContent>
      </Card>
    );
  }

  const mensagens = data?.mensagens ?? [];

  if (mensagens.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
          <Inbox
            className="h-8 w-8 text-[var(--color-texto-fraco)]"
            aria-hidden="true"
          />
          <p className="text-sm font-medium">A fila está vazia</p>
          <p className="text-sm text-[var(--color-texto-suave)]">
            Use a aba Prévia para enfileirar as mensagens.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {Object.entries(data?.contagem ?? {}).map(([status, total]) => (
          <Badge key={status} variant={varianteFila(status)}>
            {humanizar(status)}: {total}
          </Badge>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-[var(--color-borda)]">
            {mensagens.map((m) => (
              <li key={m.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {m.lead.empresa ?? m.lead.nomeCompleto ?? 'Sem nome'}
                    </p>
                    <p className="text-xs text-[var(--color-texto-suave)]">
                      {m.telefoneDestino ?? 'sem telefone'} · agendada para{' '}
                      {formatarDataHora(m.scheduledAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {m.dryRun && <Badge variant="info">Dry-run</Badge>}
                    <Badge variant={varianteFila(m.status)}>
                      {humanizar(m.status)}
                    </Badge>
                  </div>
                </div>

                {m.textoRenderizado && (
                  <p className="mt-2 rounded-lg bg-[var(--color-fundo)] px-3 py-2 text-sm leading-relaxed">
                    {m.textoRenderizado}
                  </p>
                )}
                {m.motivoBloqueio && (
                  <p className="mt-2 text-xs text-[var(--color-alerta)]">
                    {humanizar(m.motivoBloqueio)}
                    {m.detalheBloqueio ? ` — ${m.detalheBloqueio}` : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- pagina
export function CampanhaDetalhe() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [aba, setAba] = useState<Aba>('etapas');
  const [filtros, setFiltros] = useState<Filtros | null>(null);
  // Confirmação em dois passos: excluir é a única ação sem desfazer.
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const navegar = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['campanha', id],
    queryFn: () => get<{ campanha: Campanha }>(`/api/campaigns/${id}`),
  });

  const mudarStatus = useMutation({
    // ============================================================
    // ATIVAR SEM PLANILHA PRECISA DE CONFIRMACAO
    // ============================================================
    // A API recusa com `CAMPANHA_SEM_PLANILHA` quando a campanha nao tem
    // planilha escolhida — porque nesse estado ela manda para o CRM
    // INTEIRO, de todas as listas. Aqui a recusa vira uma pergunta, e a
    // resposta "sim" e reenviada explicitamente.
    //
    // A guarda de verdade mora na API: a confirmacao da tela sozinha nao
    // protegeria quem chamasse a rota direto.
    mutationFn: async (status: string) => {
      try {
        return await post(`/api/campaigns/${id}/status`, { status });
      } catch (err) {
        // `codigo` e o campo que o cliente de API preenche a partir de
        // `erro.codigo` da resposta.
        if ((err as { codigo?: string })?.codigo !== 'CAMPANHA_SEM_PLANILHA') {
          throw err;
        }

        const segue = window.confirm(
          'Esta campanha não tem planilha escolhida.\n\n' +
            'Do jeito que está, ela vai mandar mensagem para TODOS os leads ' +
            'do CRM — de todas as listas, nichos e cidades, não só da lista ' +
            'que você importou para ela.\n\n' +
            'Para restringir, cancele e escolha as planilhas na aba Público.\n\n' +
            'Ativar mesmo assim?'
        );
        if (!segue) throw err;

        return await post(`/api/campaigns/${id}/status`, {
          status,
          permitirTodosOsLeads: true,
        });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campanha', id] });
      void queryClient.invalidateQueries({ queryKey: ['campanhas'] });
    },
  });

  const excluir = useMutation({
    // `confirmar: true` e exigido pela API tambem — a confirmacao da tela
    // sozinha nao protegeria quem chamasse a rota direto.
    mutationFn: () => del(`/api/campaigns/${id}`, { confirmar: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campanhas'] });
      navegar('/campanhas');
    },
  });

  const salvarFiltros = useMutation({
    mutationFn: (f: Filtros) => patch(`/api/campaigns/${id}`, { filtros: f }),
    onSuccess: () => {
      // A previa e montada a partir dos filtros salvos, entao ela precisa
      // ser refeita — senao a aba Previa mostraria o publico antigo.
      void queryClient.invalidateQueries({ queryKey: ['campanha', id] });
      void queryClient.invalidateQueries({ queryKey: ['campanha-previa', id] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-[var(--color-texto-suave)]">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Carregando…
      </div>
    );
  }

  const campanha = data?.campanha;
  if (!campanha) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-[var(--color-texto-suave)]">
          Campanha não encontrada.{' '}
          <Link to="/campanhas" className="underline">
            Voltar
          </Link>
        </CardContent>
      </Card>
    );
  }

  const abas: Array<{ id: Aba; rotulo: string; icone: typeof Eye }> = [
    { id: 'etapas', rotulo: 'Etapas', icone: ListOrdered },
    { id: 'publico', rotulo: 'Público', icone: Users },
    { id: 'previa', rotulo: 'Prévia', icone: Eye },
    { id: 'fila', rotulo: 'Fila', icone: Inbox },
    { id: 'config', rotulo: 'Configurações', icone: Settings2 },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="fantasma" size="sm" asChild>
            <Link to="/campanhas">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Campanhas
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{campanha.nome}</h1>
            <div className="mt-0.5 flex items-center gap-1.5">
              <Badge variant={varianteStatus(campanha.status)}>
                {rotuloStatusCampanha(campanha.status)}
              </Badge>
              {campanha.dryRun && <Badge variant="info">Dry-run</Badge>}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {campanha.status !== 'ATIVA' ? (
            <Button
              onClick={() => mudarStatus.mutate('ATIVA')}
              disabled={mudarStatus.isPending}
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Ativar
            </Button>
          ) : (
            <Button
              variant="secundario"
              onClick={() => mudarStatus.mutate('PAUSADA')}
              disabled={mudarStatus.isPending}
            >
              <Pause className="h-4 w-4" aria-hidden="true" />
              Pausar
            </Button>
          )}
        </div>
      </div>

      {mudarStatus.isError && (
        <p className="text-sm text-[var(--color-alerta)]">
          {mudarStatus.error instanceof ApiError
            ? mudarStatus.error.message
            : 'Não foi possível mudar o status'}
        </p>
      )}

      <div
        className="flex gap-1 border-b border-[var(--color-borda)]"
        role="tablist"
        aria-label="Seções da campanha"
      >
        {abas.map(({ id: abaId, rotulo, icone: Icone }) => (
          <button
            key={abaId}
            role="tab"
            aria-selected={aba === abaId}
            onClick={() => setAba(abaId)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors',
              aba === abaId
                ? 'border-[var(--color-marca)] font-medium text-[var(--color-texto)]'
                : 'border-transparent text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]'
            )}
          >
            <Icone className="h-4 w-4" aria-hidden="true" />
            {rotulo}
          </button>
        ))}
      </div>

      {/* Sem `key` derivada dos dados: o refetch depois de salvar muda
          steps.length, o que remontaria o editor e apagaria tanto a
          mensagem de sucesso quanto qualquer edicao ainda nao salva. */}
      {aba === 'etapas' && <EditorEtapas campanha={campanha} />}

      {aba === 'publico' && (
        <Card>
          <CardHeader>
            <CardTitle>Quem entra nesta campanha</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FiltrosLead
              valor={filtros ?? campanha.filtros ?? {}}
              aoMudar={setFiltros}
            />
            <div className="flex items-center gap-2">
              <Button
                onClick={() => filtros && salvarFiltros.mutate(filtros)}
                disabled={!filtros || salvarFiltros.isPending}
              >
                {salvarFiltros.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="h-4 w-4" aria-hidden="true" />
                )}
                Salvar público
              </Button>
              {salvarFiltros.isSuccess && (
                <span className="text-sm text-[var(--color-sucesso)]">
                  Público salvo.
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {aba === 'previa' && <Previa campanha={campanha} />}
      {aba === 'fila' && <Fila campanhaId={campanha.id} />}

      {aba === 'config' && (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Configurações de envio</CardTitle>
            </CardHeader>
            <CardContent>
              <ConfiguracoesCampanha
                campanhaId={campanha.id}
                valor={{
                  horarioInicio: campanha.horarioInicio,
                  horarioFim: campanha.horarioFim,
                  diasPermitidos: campanha.diasPermitidos,
                  limiteDiarioEnvios: campanha.limiteDiarioEnvios,
                  limiteHorarioEnvios: campanha.limiteHorarioEnvios,
                  delayEntreLeadsMinSegundos: campanha.delayEntreLeadsMinSegundos,
                  delayEntreLeadsMaxSegundos: campanha.delayEntreLeadsMaxSegundos,
                  delayMinSegundos: campanha.delayMinSegundos,
                  delayMaxSegundos: campanha.delayMaxSegundos,
                  maxLeads: campanha.maxLeads,
                  dryRun: campanha.dryRun,
                }}
              />
            </CardContent>
          </Card>

          {/* Exclusão por último e separada: é a única ação da tela que
              não tem desfazer. */}
          <Card>
            <CardHeader>
              <CardTitle>Excluir campanha</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-[var(--color-texto-suave)]">
                Apaga a campanha, as etapas e a fila. Os{' '}
                <strong>leads permanecem</strong> — eles existiam antes
                desta campanha e continuam depois dela.
              </p>

              {excluir.error && (
                <p className="text-sm text-[var(--color-alerta)]">
                  {excluir.error instanceof ApiError
                    ? excluir.error.message
                    : 'Não foi possível excluir'}
                </p>
              )}

              {!confirmandoExclusao ? (
                <Button
                  variant="secundario"
                  onClick={() => setConfirmandoExclusao(true)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Excluir esta campanha
                </Button>
              ) : (
                <div className="space-y-2 rounded-lg border border-[var(--color-alerta)] bg-[var(--color-alerta-bg)] p-3">
                  <p className="text-sm font-medium text-[var(--color-alerta)]">
                    Excluir “{campanha.nome}”? Não há como desfazer.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="secundario"
                      size="sm"
                      onClick={() => setConfirmandoExclusao(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => excluir.mutate()}
                      disabled={excluir.isPending}
                    >
                      {excluir.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          Excluindo…
                        </>
                      ) : (
                        'Sim, excluir'
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
