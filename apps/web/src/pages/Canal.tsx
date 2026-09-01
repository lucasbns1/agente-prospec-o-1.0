/**
 * Configuracao do canal — conectar o WhatsApp.
 *
 * ============================================================
 * O QR NAO E BUSCADO EM SEGUNDO PLANO
 * ============================================================
 * Ele so e pedido quando VOCE clica em "Mostrar QR Code". Um QR do
 * WhatsApp Web da acesso a conta; deixar a tela buscando sozinha
 * significaria ter uma credencial trafegando e desenhada em toda aba
 * aberta, o tempo todo, sem ninguem olhando.
 *
 * Ele tambem nao e guardado: some da tela assim que a sessao autentica.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  QrCode, Loader2, RefreshCw, ShieldCheck, TriangleAlert, Smartphone,
} from 'lucide-react';
import { get, ApiError } from '@/lib/api';
import {
  Card, CardContent, CardHeader, CardTitle, Badge, Button,
} from '@/components/ui/primitives';
import { formatarDataHora } from '@/lib/utils';

interface StatusCanal {
  provider: string;
  status: string;
  autenticado: boolean;
  conectado: boolean;
  telefone: string | null;
  detalhe: string | null;
  temQr: boolean;
  ultimoEventoEm: string | null;
  sessaoDesde: string | null;
  envioRealPermitidoNaFase: boolean;
  tentativasReconexao: number;
  atualizadoEm: string;
  dryRun: boolean;
  canal: string;
}

/** Cada estado ganha uma frase que diz o que fazer, não só o nome. */
const ESTADOS: Record<
  string,
  { rotulo: string; cor: string; explica: string }
> = {
  DESCONECTADO: {
    rotulo: 'Desconectado',
    cor: 'bg-[var(--color-alerta)]',
    explica: 'O canal não está conectado. Inicie o worker para conectar.',
  },
  INICIALIZANDO: {
    rotulo: 'Inicializando',
    cor: 'bg-[var(--color-morno)]',
    explica: 'Abrindo o navegador e carregando a sessão salva.',
  },
  AGUARDANDO_QR: {
    rotulo: 'Aguardando QR Code',
    cor: 'bg-[var(--color-morno)]',
    explica: 'Escaneie o QR Code pelo WhatsApp do celular.',
  },
  AUTENTICANDO: {
    rotulo: 'Autenticando',
    cor: 'bg-[var(--color-morno)]',
    explica: 'QR lido. Validando a sessão.',
  },
  CONECTADO: {
    rotulo: 'Conectado',
    cor: 'bg-[var(--color-sucesso)]',
    explica: 'Recebendo mensagens normalmente.',
  },
  RECONECTANDO: {
    rotulo: 'Reconectando',
    cor: 'bg-[var(--color-morno)]',
    explica: 'A conexão caiu e o sistema está tentando voltar sozinho.',
  },
  FALHOU: {
    rotulo: 'Falhou',
    cor: 'bg-[var(--color-alerta)]',
    explica: 'As tentativas de reconexão não deram certo. Precisa de você.',
  },
};

export function Canal() {
  const [mostrarQr, setMostrarQr] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['canal-status'],
    queryFn: () => get<StatusCanal>('/api/canal/status'),
    // O estado muda sozinho (QR expira, sessão cai): sem refetch a tela
    // mentiria até alguém apertar F5.
    refetchInterval: 5000,
  });

  const {
    data: qr,
    isFetching: buscandoQr,
    error: erroQr,
    refetch: recarregarQr,
  } = useQuery({
    queryKey: ['canal-qr'],
    // `imagem` e um data: URL PNG. A API desenha o codigo; a tela so exibe.
    queryFn: () => get<{ imagem: string; expiraEmSegundos: number }>('/api/canal/qr'),
    enabled: mostrarQr,
    // 5s, e nao 10s: cada QR vive 60s, e uma janela de dez segundos
    // significa olhar um codigo com ate 1/6 da vida ja gasta antes
    // mesmo de voce apontar a camera.
    refetchInterval: mostrarQr ? 5_000 : false,
    retry: false,
  });

  const estado = ESTADOS[data?.status ?? 'DESCONECTADO'] ?? ESTADOS.DESCONECTADO!;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-[var(--color-texto-suave)]">
          Conexão do canal e estado da sessão.
        </p>
      </div>

      {/* ---- A trava desta fase ---- */}
      {data && !data.envioRealPermitidoNaFase && (
        <Card className="border-[var(--color-info)]">
          <CardContent className="flex gap-3 pt-5">
            <ShieldCheck
              className="h-5 w-5 shrink-0 text-[var(--color-info)]"
              aria-hidden="true"
            />
            <div className="text-xs leading-relaxed text-[var(--color-texto-suave)]">
              <p className="font-medium text-[var(--color-texto)]">
                Envio real bloqueado nesta fase
              </p>
              <p className="mt-1">
                O sistema pode <strong>conectar</strong> e{' '}
                <strong>receber</strong> mensagens, mas não envia nada — e isso
                não depende de configuração. A trava está no código
                (<code>FASE_PERMITE_ENVIO_REAL</code>); mudá-la exige um commit,
                não uma variável de ambiente.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* ---- Status ---- */}
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2.5">
              <span
                className={`h-2.5 w-2.5 rounded-full ${estado.cor}`}
                aria-hidden="true"
              />
              <span className="text-sm font-medium" role="status" aria-live="polite">
                {isLoading ? 'Carregando…' : estado.rotulo}
              </span>
              {data?.canal === 'simulado' && (
                <Badge variant="info">canal simulado</Badge>
              )}
            </div>

            <p className="text-sm text-[var(--color-texto-suave)]">
              {data?.detalhe ?? estado.explica}
            </p>

            <dl className="divide-y divide-[var(--color-borda)] text-sm">
              {[
                { r: 'Número', v: data?.telefone ?? '—' },
                { r: 'Provedor', v: data?.provider ?? '—' },
                { r: 'Sessão desde', v: formatarDataHora(data?.sessaoDesde ?? null) },
                { r: 'Último evento', v: formatarDataHora(data?.ultimoEventoEm ?? null) },
                {
                  r: 'Tentativas de reconexão',
                  v: String(data?.tentativasReconexao ?? 0),
                },
              ].map((linha) => (
                <div key={linha.r} className="grid grid-cols-[160px_1fr] gap-2 py-1.5">
                  <dt className="text-xs text-[var(--color-texto-suave)]">
                    {linha.r}
                  </dt>
                  <dd>{linha.v}</dd>
                </div>
              ))}
            </dl>

            {data?.status === 'FALHOU' && (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--color-alerta)] bg-[var(--color-alerta-bg)] px-3 py-2">
                <TriangleAlert
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-alerta)]"
                  aria-hidden="true"
                />
                <p className="text-xs leading-relaxed text-[var(--color-alerta)]">
                  Reinicie o worker. Se voltar a falhar, apague a pasta da
                  sessão e escaneie o QR de novo.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---- QR ---- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-4 w-4" aria-hidden="true" />
              Conectar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.conectado ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <Smartphone
                  className="h-8 w-8 text-[var(--color-sucesso)]"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium">Sessão ativa</p>
                <p className="text-xs text-[var(--color-texto-suave)]">
                  Não é preciso escanear nada.
                </p>
              </div>
            ) : (
              <>
                {!mostrarQr ? (
                  <>
                    <p className="text-xs leading-relaxed text-[var(--color-texto-suave)]">
                      O QR Code dá acesso à sua conta e vale poucos segundos.
                      Ele só é carregado quando você pede.
                    </p>
                    <Button onClick={() => setMostrarQr(true)} disabled={!data?.temQr}>
                      <QrCode className="h-4 w-4" aria-hidden="true" />
                      Mostrar QR Code
                    </Button>
                    {!data?.temQr && (
                      <p className="text-xs text-[var(--color-texto-fraco)]">
                        Nenhum QR disponível agora. Ele aparece quando o canal
                        entra em “Aguardando QR Code”.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    {buscandoQr && !qr && (
                      <p className="flex items-center gap-2 py-8 text-sm text-[var(--color-texto-suave)]">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        Buscando o QR…
                      </p>
                    )}

                    {erroQr && (
                      <p className="text-sm text-[var(--color-alerta)]">
                        {erroQr instanceof ApiError
                          ? erroQr.message
                          : 'Não foi possível obter o QR'}
                      </p>
                    )}

                    {qr && (
                      <>
                        {/* Fundo branco fixo, e não a cor do tema: no tema
                            escuro um QR sobre fundo escuro não é lido pela
                            câmera. */}
                        <div className="flex justify-center rounded-lg bg-white p-3">
                          <img
                            src={qr.imagem}
                            alt="QR Code para conectar o WhatsApp"
                            width={280}
                            height={280}
                            className="h-auto w-full max-w-[280px]"
                          />
                        </div>
                        <p className="text-xs text-[var(--color-texto-suave)]">
                          Expira em {qr.expiraEmSegundos}s. No celular: WhatsApp →
                          Aparelhos conectados → Conectar aparelho.
                        </p>
                      </>
                    )}

                    <div className="flex gap-2">
                      <Button
                        variant="secundario"
                        size="sm"
                        onClick={() => void recarregarQr()}
                      >
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        Atualizar
                      </Button>
                      <Button
                        variant="fantasma"
                        size="sm"
                        onClick={() => setMostrarQr(false)}
                      >
                        Esconder
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
