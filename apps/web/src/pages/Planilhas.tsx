/**
 * Planilhas — o que você já importou, e como desfazer.
 *
 * ============================================================
 * POR QUE ESTA TELA EXISTE
 * ============================================================
 * Importar era uma via de mão única. Se o arquivo vinha com as colunas
 * trocadas, ou era a lista errada, o CRM ficava com dezenas de leads que
 * não serviam — e a única saída era apagar um por um, ou `reset:fabrica`
 * e perder tudo junto.
 *
 * Aqui você vê cada planilha, quantos leads dela ainda existem, e apaga
 * a que não presta.
 *
 * ============================================================
 * O NÚMERO QUE IMPORTA É O DE AGORA
 * ============================================================
 * A tela mostra `leadsAtuais`, e não `totalImportados`. O segundo é
 * histórico do dia da importação; leads podem ter sido apagados depois.
 * Antes de apagar, o que você precisa saber é quantos vão embora agora.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, X, Loader2, Inbox } from 'lucide-react';
import { get, del } from '@/lib/api';
import {
  Card, CardContent, CardHeader, CardTitle, Badge, Button,
} from '@/components/ui/primitives';
import { formatarDataHora } from '@/lib/utils';
import { ApiError } from '@/lib/api';

interface Planilha {
  id: string;
  nomeArquivo: string;
  formato: string;
  status: string;
  totalLinhas: number;
  totalImportados: number;
  totalDuplicados: number;
  totalInvalidos: number;
  createdAt: string;
  captureSession: {
    id: string;
    nicho: string | null;
    cidade: string | null;
    estado: string | null;
  } | null;
  _count: { leads: number };
}

interface Resultado {
  nomeArquivo: string;
  leadsApagados: number;
  leadsPreservados: number;
}

export function Planilhas() {
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState<Planilha | null>(null);
  const [ultimo, setUltimo] = useState<Resultado | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['planilhas'],
    queryFn: () => get<{ imports: Planilha[] }>('/api/imports'),
  });

  const apagar = useMutation({
    mutationFn: (id: string) => del<Resultado>(`/api/imports/${id}`),
    onSuccess: (r) => {
      setUltimo(r);
      setConfirmando(null);
      void queryClient.invalidateQueries({ queryKey: ['planilhas'] });
      void queryClient.invalidateQueries({ queryKey: ['lotes'] });
      void queryClient.invalidateQueries({ queryKey: ['leads'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const planilhas = data?.imports ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Planilhas</h1>
        <p className="text-sm text-[var(--color-texto-suave)]">
          O que você já importou. Apagar uma planilha apaga os leads que ela
          criou.
        </p>
      </div>

      {ultimo && (
        <div className="rounded-lg border border-[var(--color-borda)] bg-[var(--color-fundo)] px-4 py-3 text-sm">
          <strong>{ultimo.nomeArquivo}</strong> foi apagada.{' '}
          {ultimo.leadsApagados} lead(s) removido(s).
          {ultimo.leadsPreservados > 0 && (
            <>
              {' '}
              <span className="text-[var(--color-alerta)]">
                {ultimo.leadsPreservados} continuaram no CRM porque já tinham
                mensagem ou pediram para sair.
              </span>
            </>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            Importações
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-[var(--color-texto-fraco)]">
              Carregando…
            </p>
          ) : planilhas.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Inbox
                className="h-8 w-8 text-[var(--color-texto-fraco)]"
                aria-hidden="true"
              />
              <p className="text-sm text-[var(--color-texto-suave)]">
                Nenhuma planilha importada ainda.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-borda)]">
              {planilhas.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.nomeArquivo}</p>
                    <p className="text-xs text-[var(--color-texto-suave)]">
                      {formatarDataHora(p.createdAt)}
                      {p.captureSession?.nicho && (
                        <> · {p.captureSession.nicho} em {p.captureSession.cidade}</>
                      )}
                      {' · '}
                      {p.totalLinhas} linha(s), {p.totalDuplicados} duplicada(s),{' '}
                      {p.totalInvalidos} inválida(s)
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant={p._count.leads > 0 ? 'info' : 'neutro'}>
                      {p._count.leads} lead(s) no CRM
                    </Badge>
                    <Button
                      variant="fantasma"
                      size="icone"
                      aria-label={`Apagar ${p.nomeArquivo}`}
                      title="Apagar esta planilha"
                      onClick={() => setConfirmando(p)}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ============================================================
          A CONFIRMAÇÃO
          ============================================================
          Ela diz o NÚMERO, e não só "tem certeza?". "Apagar 47 leads" e
          "apagar 2 leads" são decisões diferentes, e uma confirmação que
          não mostra o tamanho do estrago não está confirmando nada. */}
      {confirmando && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setConfirmando(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-confirmar"
            className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--color-borda)] bg-white p-5 shadow-xl"
          >
            <h2 id="titulo-confirmar" className="text-base font-semibold">
              Deseja mesmo acabar com essa daqui?
            </h2>

            <p className="mt-2 text-sm text-[var(--color-texto-suave)]">
              <strong>{confirmando.nomeArquivo}</strong> some, e junto com ela{' '}
              <strong>{confirmando._count.leads} lead(s)</strong> que vieram
              dessa importação.
            </p>

            <p className="mt-3 text-xs leading-relaxed text-[var(--color-texto-suave)]">
              Leads que já receberam mensagem, ou que pediram para sair,{' '}
              <strong>continuam no CRM</strong> — eles só perdem o vínculo com a
              planilha. É o histórico deles que impede o sistema de abordar a
              mesma pessoa de novo na próxima importação.
            </p>

            <p className="mt-3 text-xs font-medium text-[var(--color-alerta)]">
              Não tem como desfazer.
            </p>

            {apagar.error && (
              <p className="mt-3 text-sm text-[var(--color-alerta)]">
                {apagar.error instanceof ApiError
                  ? apagar.error.message
                  : 'Não foi possível apagar.'}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secundario"
                onClick={() => setConfirmando(null)}
                disabled={apagar.isPending}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => apagar.mutate(confirmando.id)}
                disabled={apagar.isPending}
              >
                {apagar.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                Apagar planilha
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
