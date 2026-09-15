/**
 * WhatsApp — conexao do canal e troca de numero.
 *
 * O botao escolhe um SLOT, nao um numero. O numero de uma sessao e definido
 * por quem escaneia o QR Code; o que guardamos por slot sao as credenciais.
 * Por isso a tela fala em "Número 1" e "Número 2" com o telefone abaixo como
 * etiqueta: e o que o usuario reconhece, sem prometer que digitar um numero
 * conecta aquele numero.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QrCode, Check, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import { get, post, ApiError } from '@/lib/api';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
} from '@/components/ui/primitives';

interface Slot {
  id: 1 | 2;
  rotulo: string;
  numeroEsperado: string;
  autenticado: boolean;
  ativo: boolean;
}

interface StatusWhatsApp {
  status: string;
  modo: string;
  dryRun: boolean;
  slotAtivo: 1 | 2;
  detalhe: string;
}

/** "5511968662120" -> "+55 11 96866-2120" */
function formatarNumero(numero: string): string {
  const m = /^(\d{2})(\d{2})(\d{4,5})(\d{4})$/.exec(numero);
  return m ? `+${m[1]} ${m[2]} ${m[3]}-${m[4]}` : numero;
}

export function WhatsApp() {
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => get<StatusWhatsApp>('/api/whatsapp/status'),
    refetchInterval: 15_000,
  });

  const slots = useQuery({
    queryKey: ['whatsapp-slots'],
    queryFn: () => get<{ slots: Slot[] }>('/api/whatsapp/slots'),
  });

  const conectar = useMutation({
    mutationFn: (id: number) => post(`/api/whatsapp/slots/${id}/connect`),
    onSettled: () => {
      // Mesmo quando a conexao falha, o slot ativo mudou no servidor: a tela
      // tem que refletir o numero que passou a valer, nao o anterior.
      void queryClient.invalidateQueries({ queryKey: ['whatsapp-slots'] });
      void queryClient.invalidateQueries({ queryKey: ['whatsapp-status'] });
    },
  });

  const esquecer = useMutation({
    mutationFn: (id: number) => post(`/api/whatsapp/slots/${id}/logout`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['whatsapp-slots'] }),
  });

  const lista = slots.data?.slots ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-[var(--color-texto-suave)]">
          Conexão do canal e troca de número.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Números</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {slots.isLoading && (
              <p className="text-sm text-[var(--color-texto-suave)]">Carregando…</p>
            )}

            {lista.map((slot) => (
              <div
                key={slot.id}
                className={
                  slot.ativo
                    ? 'flex items-center justify-between gap-4 rounded-lg border-2 border-[var(--color-marca)] bg-[var(--color-fundo)] px-4 py-3'
                    : 'flex items-center justify-between gap-4 rounded-lg border border-[var(--color-borda)] px-4 py-3'
                }
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{slot.rotulo}</span>
                    {slot.ativo && (
                      <Badge variant="info">
                        <Check className="h-3 w-3" aria-hidden="true" />
                        em uso
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-[var(--color-texto-suave)]">
                    {slot.numeroEsperado
                      ? formatarNumero(slot.numeroEsperado)
                      : 'Número não configurado no .env'}
                    {' · '}
                    {slot.autenticado
                      ? 'já autenticado, conecta sem QR'
                      : 'ainda não escaneado'}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {slot.autenticado && (
                    <Button
                      variant="fantasma"
                      size="sm"
                      onClick={() => esquecer.mutate(slot.id)}
                      disabled={esquecer.isPending}
                      title="Apaga as credenciais deste número. O próximo uso pede QR Code."
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Esquecer
                    </Button>
                  )}
                  <Button
                    variant={slot.ativo ? 'secundario' : 'primary'}
                    size="sm"
                    onClick={() => conectar.mutate(slot.id)}
                    disabled={conectar.isPending}
                  >
                    {slot.ativo ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        Reconectar
                      </>
                    ) : (
                      'Usar este'
                    )}
                  </Button>
                </div>
              </div>
            ))}

            {conectar.error instanceof ApiError && (
              <p className="flex items-start gap-2 rounded-lg bg-[color-mix(in_srgb,var(--color-alerta)_10%,white)] px-3 py-2 text-xs text-[var(--color-alerta)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {conectar.error.message}
              </p>
            )}

            <p className="text-xs text-[var(--color-texto-fraco)]">
              Cada número guarda a própria sessão. Voltar para um número já
              autenticado não pede QR Code de novo.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-4 w-4" aria-hidden="true" />
              Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-[var(--color-alerta)]" aria-hidden="true" />
              {status.data?.status ?? '—'}
            </div>
            <p className="text-xs text-[var(--color-texto-suave)]">
              {status.data?.detalhe}
            </p>
            <dl className="divide-y divide-[var(--color-borda)] text-sm">
              <div className="flex justify-between py-2">
                <dt className="text-[var(--color-texto-suave)]">Número em uso</dt>
                <dd>
                  {(() => {
                    const ativo = lista.find((s) => s.ativo);
                    return ativo?.numeroEsperado
                      ? formatarNumero(ativo.numeroEsperado)
                      : (ativo?.rotulo ?? '—');
                  })()}
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-[var(--color-texto-suave)]">Modo</dt>
                <dd>{status.data?.modo ?? '—'}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
