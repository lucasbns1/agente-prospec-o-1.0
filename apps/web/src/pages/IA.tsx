/**
 * O que a IA andou decidindo.
 *
 * ============================================================
 * A PERGUNTA QUE ESTA TELA RESPONDE
 * ============================================================
 * "A IA esta ajudando ou atrapalhando?"
 *
 * Ela decide o que acontece com os seus leads. Sem esta tela, saber o
 * que ela fez exigiria abrir o Postgres e escrever SQL — o que na
 * pratica significa nunca conferir.
 *
 * Tres blocos, nessa ordem de importancia:
 *
 *   1. RECONCILIACAO — onde o banco discorda de si mesmo. Vem primeiro
 *      porque e o unico que pede acao sua.
 *   2. RESUMO        — os numeros que dizem se vale a pena.
 *   3. DECISOES      — a leitura caso a caso, quando algo chamar atencao.
 *
 * Somente leitura. Ligar ou desligar a IA continua sendo edicao do
 * `.env` mais reinicio, de proposito: uma tela aberta no navegador nao
 * pode mudar quem comanda a cadencia.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Brain, TriangleAlert, Loader2, ExternalLink } from 'lucide-react';
import { get } from '@/lib/api';
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/primitives';
import { formatarDataHora, cn } from '@/lib/utils';

interface Resumo {
  total: number;
  divergencias: number;
  fallbacks: number;
  intervencoes: number;
  optOuts: number;
  modelo: string | null;
  ultimaEm: string | null;
  latenciaMediaMs: number | null;
  latenciaMaximaMs: number | null;
  porAcao: { acao: string; total: number }[];
  porIntent: { intent: string; total: number }[];
  rejeicoes: { motivo: string; total: number }[];
}

interface Decisao {
  id: string;
  createdAt: string;
  gatilho: string;
  intentIa: string | null;
  acaoIa: string | null;
  acaoMotor: string | null;
  acaoExecutada: string | null;
  motivoRejeicao: string | null;
  confianca: number | null;
  motivo: string | null;
  divergiu: boolean;
  fallback: boolean;
  erro: string | null;
  modelo: string | null;
  latenciaMs: number | null;
  etapaOrdem: number | null;
  lead: { id: string; empresa: string | null; nomeCompleto: string | null } | null;
  campaign: { id: string; nome: string } | null;
}

interface Achado {
  tipo: string;
  gravidade: 'CRITICA' | 'ATENCAO' | 'INFO';
  leadId: string;
  descricao: string;
  sugestao: string;
}

interface Reconciliacao {
  resumo: { CRITICA: number; ATENCAO: number; INFO: number };
  achados: Achado[];
}

const FILTROS = [
  { id: 'TODAS', rotulo: 'Todas' },
  { id: 'DIVERGIU', rotulo: 'Divergiram do motor' },
  { id: 'FALLBACK', rotulo: 'Caíram no motor' },
] as const;

type Filtro = (typeof FILTROS)[number]['id'];

function Numero({ rotulo, valor, alerta }: { rotulo: string; valor: string | number; alerta?: boolean }) {
  return (
    <div>
      <div className={cn('text-2xl font-semibold', alerta && 'text-amber-600')}>{valor}</div>
      <div className="text-xs text-muted-foreground">{rotulo}</div>
    </div>
  );
}

export function IA() {
  const [filtro, setFiltro] = useState<Filtro>('TODAS');

  const resumo = useQuery({
    queryKey: ['ia', 'resumo'],
    queryFn: () => get<Resumo>('/api/ia/resumo'),
  });

  const decisoes = useQuery({
    queryKey: ['ia', 'decisoes', filtro],
    queryFn: () =>
      get<{ decisoes: Decisao[] }>(
        `/api/ia/decisoes?limite=50${
          filtro === 'DIVERGIU' ? '&divergiu=true' : filtro === 'FALLBACK' ? '&fallback=true' : ''
        }`
      ),
  });

  const rec = useQuery({
    queryKey: ['ia', 'reconciliacao'],
    queryFn: () => get<Reconciliacao>('/api/ia/reconciliacao'),
  });

  const semDados = resumo.data && resumo.data.total === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Brain className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold">Inteligência artificial</h1>
          <p className="text-sm text-muted-foreground">
            O que a IA decidiu, e onde o sistema precisa de você.
          </p>
        </div>
      </div>

      {/* --------------------------------------------------------------
          RECONCILIAÇÃO — primeiro porque é o único que pede ação sua
         -------------------------------------------------------------- */}
      {rec.data && rec.data.achados.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-amber-600" />
              Precisa da sua atenção
              <Badge variant="neutro">
                {rec.data.resumo.CRITICA} crítica(s) · {rec.data.resumo.ATENCAO} atenção
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {rec.data.achados
              .filter((a) => a.gravidade !== 'INFO')
              .slice(0, 15)
              .map((a, i) => (
                <div
                  key={`${a.tipo}-${a.leadId}-${i}`}
                  className={cn(
                    'rounded-md border p-3 text-sm',
                    a.gravidade === 'CRITICA' ? 'border-red-300 bg-red-50' : 'border-amber-200'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium">{a.descricao}</div>
                      {/* A sugestão importa tanto quanto o problema: em
                          várias delas a resposta certa é NÃO reenviar. */}
                      <div className="text-muted-foreground">{a.sugestao}</div>
                    </div>
                    <Link to={`/conversas/${a.leadId}`}>
                      <Button variant="secundario" size="sm">
                        <ExternalLink className="mr-1 h-3 w-3" />
                        Abrir
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {/* -------------------------------------------------------------- */}
      {semDados ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <p>Nenhuma decisão registrada ainda.</p>
            <p className="mt-2">
              Ou o Gemini está desligado (<code>GEMINI_ENABLED=false</code> no{' '}
              <code>.env</code>), ou nenhum evento aconteceu desde que ele foi ligado.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Resumo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                <Numero rotulo="decisões" valor={resumo.data?.total ?? '—'} />
                <Numero rotulo="divergiram do motor" valor={resumo.data?.divergencias ?? '—'} />
                {/* Fallback não é defeito: é o sistema seguindo sem a IA.
                    Vira alerta quando é a maioria. */}
                <Numero
                  rotulo="caíram no motor"
                  valor={resumo.data?.fallbacks ?? '—'}
                  alerta={
                    (resumo.data?.fallbacks ?? 0) > (resumo.data?.total ?? 0) / 2 &&
                    (resumo.data?.total ?? 0) > 0
                  }
                />
                <Numero rotulo="intervenções" valor={resumo.data?.intervencoes ?? '—'} />
                <Numero rotulo="opt-outs" valor={resumo.data?.optOuts ?? '—'} />
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span>modelo: {resumo.data?.modelo ?? '—'}</span>
                <span>
                  latência: {resumo.data?.latenciaMediaMs ?? '—'}ms média ·{' '}
                  {resumo.data?.latenciaMaximaMs ?? '—'}ms máxima
                </span>
                {resumo.data?.ultimaEm && (
                  <span>última: {formatarDataHora(resumo.data.ultimaEm)}</span>
                )}
              </div>

              {(resumo.data?.rejeicoes.length ?? 0) > 0 && (
                <div className="rounded-md border p-3">
                  <div className="mb-2 text-sm font-medium">Recusadas pela guarda</div>
                  {/* Aparecer aqui é o sistema funcionando. O que interessa
                      é QUAL barreira, e com que frequência. */}
                  <div className="flex flex-wrap gap-2">
                    {resumo.data!.rejeicoes.map((r) => (
                      <Badge key={r.motivo} variant="neutro">
                        {r.motivo}: {r.total}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Decisões</span>
                <div className="flex gap-1">
                  {FILTROS.map((f) => (
                    <Button
                      key={f.id}
                      variant={filtro === f.id ? 'primary' : 'secundario'}
                      size="sm"
                      onClick={() => setFiltro(f.id)}
                    >
                      {f.rotulo}
                    </Button>
                  ))}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {decisoes.isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (decisoes.data?.decisoes.length ?? 0) === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nada com este filtro.
                </p>
              ) : (
                <div className="space-y-2">
                  {decisoes.data!.decisoes.map((d) => (
                    <div key={d.id} className="rounded-md border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {d.lead?.empresa ?? d.lead?.nomeCompleto ?? 'Lead'}
                        </span>
                        <Badge variant="neutro">{d.gatilho}</Badge>
                        {d.intentIa && <Badge variant="neutro">{d.intentIa}</Badge>}
                        {d.etapaOrdem !== null && (
                          <Badge variant="neutro">etapa {d.etapaOrdem}</Badge>
                        )}
                        {d.divergiu && <Badge variant="neutro">divergiu</Badge>}
                        {d.fallback && <Badge variant="neutro">fallback</Badge>}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {formatarDataHora(d.createdAt)}
                        </span>
                      </div>

                      {/* As três colunas que contam a história: o que a IA
                          quis, o que o motor queria, e o que aconteceu. */}
                      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                        <span>
                          IA: <strong>{d.acaoIa ?? '—'}</strong>
                          {d.confianca !== null && ` (${d.confianca})`}
                        </span>
                        <span>
                          motor: <strong>{d.acaoMotor ?? '—'}</strong>
                        </span>
                        <span>
                          executado: <strong>{d.acaoExecutada ?? '—'}</strong>
                        </span>
                      </div>

                      {d.motivoRejeicao && (
                        <div className="mt-1 text-xs text-amber-700">
                          guarda recusou: {d.motivoRejeicao}
                        </div>
                      )}
                      {d.motivo && (
                        <div className="mt-1 text-muted-foreground">{d.motivo}</div>
                      )}
                      {d.erro && (
                        <div className="mt-1 text-xs text-red-600">erro: {d.erro}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
