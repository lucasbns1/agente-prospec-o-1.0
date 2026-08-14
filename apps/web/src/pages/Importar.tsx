/**
 * Importacao de leads — CSV/XLSX do Instant Data Scraper.
 *
 * Tres passos explicitos. O upload NUNCA grava direto: voce ve a previa
 * completa, com o que sera criado, o que sera ignorado e por que, e so
 * entao confirma.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle,
  Copy, Globe, PhoneOff, ArrowLeft, Loader2,
} from 'lucide-react';
import {
  Button, Card, CardContent, CardHeader, CardTitle, Badge, Input, Label,
} from '@/components/ui/primitives';
import { ApiError } from '@/lib/api';
import { formatarNumero, cn } from '@/lib/utils';

type Situacao = 'NOVO' | 'DUPLICADO_ARQUIVO' | 'DUPLICADO_BANCO' | 'INVALIDO';

interface LinhaPreview {
  numeroLinha: number;
  situacao: Situacao;
  motivo: string | null;
  leadDuplicadoNome: string | null;
  nome: string | null;
  telefone: string | null;
  telefoneNormalizado: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  categoria: string | null;
  website: string | null;
  websiteStatus: string;
  semSiteProprio: boolean;
  semTelefone: boolean;
  avisos: Array<{ campo: string; mensagem: string }>;
}

interface Resumo {
  totalLinhas: number;
  novos: number;
  duplicadosNoArquivo: number;
  duplicadosNoBanco: number;
  invalidos: number;
  comSite: number;
  semSite: number;
  redeSocial: number;
  semTelefone: number;
}

interface Analise {
  resumo: Resumo;
  cabecalhos: string[];
  mapeamento: Record<string, string>;
  formato: string;
  planilhaUsada: string | null;
  planilhasDisponiveis: string[] | null;
  avisosArquivo: string[];
  truncado: boolean;
  linhas: LinhaPreview[];
}

interface Relatorio {
  importId: string;
  resumo: Resumo & { importados: number };
  problemas: Array<{
    numeroLinha: number;
    nome: string | null;
    problema: string;
    acaoTomada: string;
  }>;
}

const ROTULO_SITUACAO: Record<Situacao, { texto: string; variante: 'sucesso' | 'morno' | 'alerta' }> = {
  NOVO: { texto: 'Novo', variante: 'sucesso' },
  DUPLICADO_ARQUIVO: { texto: 'Duplicado no arquivo', variante: 'morno' },
  DUPLICADO_BANCO: { texto: 'Já existe no CRM', variante: 'morno' },
  INVALIDO: { texto: 'Inválido', variante: 'alerta' },
};

function CardResumo({
  valor, rotulo, icone: Icone, destaque,
}: {
  valor: number; rotulo: string;
  icone: typeof CheckCircle2;
  destaque?: 'sucesso' | 'morno' | 'alerta' | 'info';
}) {
  const cor = destaque
    ? {
        sucesso: 'text-[var(--color-sucesso)]',
        morno: 'text-[var(--color-morno)]',
        alerta: 'text-[var(--color-alerta)]',
        info: 'text-[var(--color-info)]',
      }[destaque]
    : 'text-[var(--color-texto)]';

  return (
    <div className="rounded-lg border border-[var(--color-borda)] bg-white px-4 py-3">
      <div className="flex items-center gap-2">
        <Icone className={cn('h-3.5 w-3.5', cor)} aria-hidden="true" />
        <span className={cn('num text-xl font-semibold', cor)}>
          {formatarNumero(valor)}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-[var(--color-texto-suave)]">{rotulo}</div>
    </div>
  );
}

export function Importar() {
  const queryClient = useQueryClient();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [somenteSemSite, setSomenteSemSite] = useState(false);

  // Classificação do lote — vira o rótulo pelo qual você escolhe esta
  // planilha na hora de montar a campanha.
  const [nicho, setNicho] = useState('');
  const [cidade, setCidade] = useState('');
  const [estado, setEstado] = useState('');

  const analisar = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append('arquivo', f);
      const r = await fetch('/api/imports/analisar', {
        method: 'POST', body: fd, credentials: 'include',
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new ApiError(e?.erro?.mensagem ?? 'Falha ao ler o arquivo', r.status);
      }
      return (await r.json()) as Analise;
    },
    onSuccess: setAnalise,
  });

  const confirmar = useMutation({
    mutationFn: async () => {
      if (!arquivo) throw new Error('Nenhum arquivo');
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      fd.append('somenteSemSite', String(somenteSemSite));
      // Só vira um lote classificado quando os dois vêm preenchidos:
      // "psicólogos" sem cidade não identifica planilha nenhuma.
      if (nicho.trim() && cidade.trim()) {
        fd.append('nicho', nicho.trim());
        fd.append('cidade', cidade.trim());
        if (estado.trim()) fd.append('estado', estado.trim().toUpperCase());
      }
      const r = await fetch('/api/imports/confirmar', {
        method: 'POST', body: fd, credentials: 'include',
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new ApiError(e?.erro?.mensagem ?? 'Falha ao importar', r.status);
      }
      return (await r.json()) as Relatorio;
    },
    onSuccess: (r) => {
      setRelatorio(r);
      setAnalise(null);
      void queryClient.invalidateQueries();
    },
  });

  function recomecar() {
    setArquivo(null);
    setAnalise(null);
    setRelatorio(null);
    analisar.reset();
    confirmar.reset();
  }

  // ---------------------------------------------------------------- passo 3
  if (relatorio) {
    const r = relatorio.resumo;
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-6 w-6 text-[var(--color-sucesso)]" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Importação concluída</h1>
            <p className="mt-0.5 text-sm text-[var(--color-texto-suave)]">
              {formatarNumero(r.importados)} lead(s) criado(s) no CRM.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <CardResumo valor={r.totalLinhas} rotulo="Linhas no arquivo" icone={FileSpreadsheet} />
          <CardResumo valor={r.importados} rotulo="Novos leads" icone={CheckCircle2} destaque="sucesso" />
          <CardResumo valor={r.duplicadosNoArquivo + r.duplicadosNoBanco} rotulo="Duplicados" icone={Copy} destaque="morno" />
          <CardResumo valor={r.invalidos} rotulo="Inválidos" icone={XCircle} destaque="alerta" />
          <CardResumo valor={r.semSite} rotulo="Sem site" icone={Globe} destaque="info" />
          <CardResumo valor={r.redeSocial} rotulo="Instagram/Facebook" icone={Globe} />
          <CardResumo valor={r.semTelefone} rotulo="Sem telefone" icone={PhoneOff} destaque="morno" />
        </div>

        {relatorio.problemas.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                Problemas encontrados ({relatorio.problemas.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-[var(--color-borda)] bg-[var(--color-fundo)] text-left text-xs text-[var(--color-texto-suave)]">
                      <th className="px-5 py-2 font-medium">Linha</th>
                      <th className="px-3 py-2 font-medium">Nome</th>
                      <th className="px-3 py-2 font-medium">Problema</th>
                      <th className="px-5 py-2 font-medium">Ação tomada</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-borda)]">
                    {relatorio.problemas.map((p, i) => (
                      <tr key={i}>
                        <td className="num px-5 py-2 text-[var(--color-texto-suave)]">{p.numeroLinha}</td>
                        <td className="px-3 py-2">{p.nome ?? <em className="text-[var(--color-texto-fraco)]">sem nome</em>}</td>
                        <td className="px-3 py-2 text-[var(--color-texto-suave)]">{p.problema}</td>
                        <td className="px-5 py-2 text-[var(--color-texto-suave)]">{p.acaoTomada}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-2">
          <Button onClick={recomecar}>Importar outro arquivo</Button>
          {/* Link do react-router: navegacao SPA, sem recarregar tudo. */}
          <Button variant="secundario" asChild>
            <Link to="/leads">Ver os leads</Link>
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- passo 2
  if (analise) {
    const r = analise.resumo;
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Prévia da importação</h1>
            <p className="mt-0.5 text-sm text-[var(--color-texto-suave)]">
              Nada foi gravado ainda. Confira e confirme.
            </p>
          </div>
          <Button variant="fantasma" onClick={recomecar}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Trocar arquivo
          </Button>
        </div>

        {analise.avisosArquivo.length > 0 && (
          <div className="rounded-lg border border-[var(--color-morno)] bg-[var(--color-morno-bg)] px-4 py-3 text-sm text-[var(--color-morno)]">
            <ul className="space-y-1">
              {analise.avisosArquivo.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <CardResumo valor={r.totalLinhas} rotulo="Total encontrado" icone={FileSpreadsheet} />
          <CardResumo valor={r.novos} rotulo="Potenciais novos" icone={CheckCircle2} destaque="sucesso" />
          <CardResumo valor={r.duplicadosNoArquivo + r.duplicadosNoBanco} rotulo="Duplicados" icone={Copy} destaque="morno" />
          <CardResumo valor={r.invalidos} rotulo="Inválidos" icone={XCircle} destaque="alerta" />
          <CardResumo valor={r.semSite} rotulo="Sem site" icone={Globe} destaque="info" />
          <CardResumo valor={r.comSite} rotulo="Com site" icone={Globe} />
          <CardResumo valor={r.semTelefone} rotulo="Sem telefone" icone={PhoneOff} destaque="morno" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Colunas reconhecidas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(analise.mapeamento).map(([campo, coluna]) => (
                <Badge key={campo} variant="info">
                  {campo} ← {coluna}
                </Badge>
              ))}
              {analise.cabecalhos
                .filter((c) => !Object.values(analise.mapeamento).includes(c))
                .map((c) => (
                  <Badge key={c} variant="neutro" title="Coluna não reconhecida — será ignorada">
                    {c} (ignorada)
                  </Badge>
                ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Linhas {analise.truncado && <span className="font-normal text-[var(--color-texto-fraco)]">(mostrando as 200 primeiras)</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--color-fundo)]">
                  <tr className="border-y border-[var(--color-borda)] text-left text-xs text-[var(--color-texto-suave)]">
                    <th className="px-5 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Nome</th>
                    <th className="px-3 py-2 font-medium">Telefone</th>
                    <th className="px-3 py-2 font-medium">Bairro</th>
                    <th className="px-3 py-2 font-medium">Cidade</th>
                    <th className="px-3 py-2 font-medium">Site</th>
                    <th className="px-5 py-2 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-borda)]">
                  {analise.linhas.map((l) => {
                    const s = ROTULO_SITUACAO[l.situacao];
                    return (
                      <tr key={l.numeroLinha} className={l.situacao !== 'NOVO' ? 'opacity-60' : ''}>
                        <td className="num px-5 py-2 text-[var(--color-texto-fraco)]">{l.numeroLinha}</td>
                        <td className="px-3 py-2 font-medium">
                          {l.nome ?? <em className="font-normal text-[var(--color-texto-fraco)]">sem nome</em>}
                        </td>
                        <td className="num px-3 py-2">
                          {l.telefone ?? <span className="text-[var(--color-texto-fraco)]">—</span>}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-texto-suave)]">
                          {l.bairro ?? <span className="text-[var(--color-texto-fraco)]">—</span>}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-texto-suave)]">{l.cidade ?? '—'}</td>
                        <td className="px-3 py-2">
                          {l.semSiteProprio ? (
                            <Badge variant="info">
                              {l.websiteStatus === 'REDE_SOCIAL' ? 'Rede social' : 'Sem site'}
                            </Badge>
                          ) : (
                            <Badge variant="neutro">Tem site</Badge>
                          )}
                        </td>
                        <td className="px-5 py-2">
                          <Badge variant={s.variante}>{s.texto}</Badge>
                          {l.motivo && (
                            <div className="mt-0.5 text-xs text-[var(--color-texto-fraco)]">{l.motivo}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Classificação do lote.
            Sem isto, meses depois "todos os leads sem site" mistura a
            planilha de psicólogos de Campinas com a de salões de Osasco,
            e não há como montar uma campanha só para uma delas. */}
        <Card>
          <CardHeader>
            <CardTitle>Classificar esta planilha</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-[var(--color-texto-suave)]">
              Dá um nome ao lote. É por ele que você escolhe esta planilha
              na hora de criar a campanha.
            </p>

            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_100px]">
              <div>
                <Label htmlFor="imp-nicho">Nicho</Label>
                <Input
                  id="imp-nicho"
                  value={nicho}
                  onChange={(e) => setNicho(e.target.value)}
                  placeholder="psicólogos"
                />
              </div>
              <div>
                <Label htmlFor="imp-cidade">Cidade</Label>
                <Input
                  id="imp-cidade"
                  value={cidade}
                  onChange={(e) => setCidade(e.target.value)}
                  placeholder="Campinas"
                />
              </div>
              <div>
                <Label htmlFor="imp-estado">UF</Label>
                <Input
                  id="imp-estado"
                  value={estado}
                  maxLength={2}
                  onChange={(e) => setEstado(e.target.value)}
                  placeholder="SP"
                />
              </div>
            </div>

            {nicho.trim() && cidade.trim() ? (
              <p className="text-sm">
                Este lote vai se chamar{' '}
                <strong>
                  {nicho.trim()} em {cidade.trim()}
                  {estado.trim() ? `/${estado.trim().toUpperCase()}` : ''}
                </strong>
                .
              </p>
            ) : (
              <p className="text-xs text-[var(--color-texto-fraco)]">
                Opcional. Sem nicho e cidade, a planilha entra sem
                classificação e você só a encontra pelo nome do arquivo.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-borda)] bg-white p-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={somenteSemSite}
              onChange={(e) => setSomenteSemSite(e.target.checked)}
              className="h-4 w-4"
            />
            Importar somente leads <strong>sem site próprio</strong>
          </label>

          <div className="ml-auto flex gap-2">
            <Button variant="secundario" onClick={recomecar} disabled={confirmar.isPending}>
              Cancelar
            </Button>
            <Button onClick={() => confirmar.mutate()} disabled={confirmar.isPending || r.novos === 0}>
              {confirmar.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Importando…
                </>
              ) : (
                `Importar ${formatarNumero(somenteSemSite ? r.semSite : r.novos)} lead(s)`
              )}
            </Button>
          </div>
        </div>

        {confirmar.isError && (
          <div role="alert" className="rounded-lg border border-[var(--color-alerta)] bg-[var(--color-alerta-bg)] px-4 py-3 text-sm text-[var(--color-alerta)]">
            {confirmar.error instanceof ApiError ? confirmar.error.message : 'Falha ao importar.'}
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------- passo 1
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Importar leads</h1>
        <p className="mt-0.5 text-sm text-[var(--color-texto-suave)]">
          Envie o CSV ou XLSX exportado do Instant Data Scraper.
        </p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <label
            className={cn(
              'flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors',
              arquivo
                ? 'border-[var(--color-sucesso)] bg-[var(--color-sucesso-bg)]'
                : 'border-[var(--color-borda-forte)] hover:border-[var(--color-marca-clara)] hover:bg-[var(--color-fundo)]'
            )}
          >
            <input
              type="file"
              accept=".csv,.xlsx"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setArquivo(f);
                analisar.reset();
              }}
            />
            {arquivo ? (
              <>
                <FileSpreadsheet className="h-8 w-8 text-[var(--color-sucesso)]" aria-hidden="true" />
                <div>
                  <div className="text-sm font-medium">{arquivo.name}</div>
                  <div className="text-xs text-[var(--color-texto-suave)]">
                    {(arquivo.size / 1024).toFixed(0)} KB — clique para trocar
                  </div>
                </div>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-[var(--color-texto-fraco)]" aria-hidden="true" />
                <div>
                  <div className="text-sm font-medium">Clique para escolher um arquivo</div>
                  <div className="text-xs text-[var(--color-texto-suave)]">
                    .csv ou .xlsx, até 25 MB
                  </div>
                </div>
              </>
            )}
          </label>

          {analisar.isError && (
            <div role="alert" className="mt-4 rounded-lg border border-[var(--color-alerta)] bg-[var(--color-alerta-bg)] px-4 py-3 text-sm text-[var(--color-alerta)]">
              {analisar.error instanceof ApiError ? analisar.error.message : 'Falha ao ler o arquivo.'}
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => arquivo && analisar.mutate(arquivo)}
              disabled={!arquivo || analisar.isPending}
            >
              {analisar.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Analisando…
                </>
              ) : (
                'Analisar arquivo'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-[var(--color-borda)] bg-white p-3 text-xs text-[var(--color-texto-suave)]">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-info)]" aria-hidden="true" />
        <span>
          O arquivo é apenas analisado neste passo. <strong>Nada é gravado</strong> até
          você confirmar na tela seguinte.
        </span>
      </div>
    </div>
  );
}
