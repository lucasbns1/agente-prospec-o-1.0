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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  QrCode, Loader2, RefreshCw, ShieldCheck, TriangleAlert, Smartphone,
} from 'lucide-react';
import { get, post, ApiError } from '@/lib/api';
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

interface NumerosCanal {
  ativo: '1' | '2';
  numeros: Array<{
    numero: '1' | '2';
    telefone: string | null;
    ativo: boolean;
    conectado: boolean;
  }>;
}

/**
 * Os dois números — e o botão que troca.
 *
 * ============================================================
 * UM DE CADA VEZ
 * ============================================================
 * Duas sessões disputando a mesma conta derrubam as duas, e o worker é
 * um processo só. Então não existe "os dois ligados": existe qual está
 * ligado agora.
 *
 * Cada número guarda a própria sessão em disco, então trocar não apaga
 * nada: você escaneia cada um UMA vez e depois alterna à vontade.
 *
 * ============================================================
 * O RÓTULO É O TELEFONE QUE CONECTOU, NÃO UM QUE ALGUÉM DIGITOU
 * ============================================================
 * Antes do primeiro login o botão diz só "Número 1". Depois passa a
 * mostrar o telefone que aquela sessão apresentou. Um rótulo digitado à
 * mão continuaria dizendo o número certo se o QR fosse lido com o
 * celular errado — e você só descobriria pela conversa do cliente.
 */
function EscolhaDeNumero(): JSX.Element {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['canal-numeros'],
    queryFn: () => get<NumerosCanal>('/api/canal/numeros'),
    refetchInterval: 10_000,
  });

  const trocar = useMutation({
    mutationFn: (numero: '1' | '2') =>
      post<{
        numero: string;
        trocou: boolean;
        campanhasPausadas: number;
        detalhe: string;
      }>('/api/canal/numero', { numero }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['canal-numeros'] });
      void queryClient.invalidateQueries({ queryKey: ['canal-status'] });
      void queryClient.invalidateQueries({ queryKey: ['campanhas'] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Qual número está conectado</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {(data?.numeros ?? [{ numero: '1' as const, telefone: null, ativo: true, conectado: false }, { numero: '2' as const, telefone: null, ativo: false, conectado: false }]).map(
            (n) => (
              <button
                key={n.numero}
                type="button"
                onClick={() => trocar.mutate(n.numero)}
                disabled={trocar.isPending || n.ativo}
                aria-pressed={n.ativo}
                className={
                  'rounded-lg border p-3 text-left transition disabled:cursor-default ' +
                  (n.ativo
                    ? 'border-[var(--color-primaria)] bg-[var(--color-fundo)]'
                    : 'border-[var(--color-borda)] hover:border-[var(--color-primaria)]')
                }
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Número {n.numero}</span>
                  {n.ativo && (
                    <Badge variant={n.conectado ? 'sucesso' : 'info'}>
                      {n.conectado ? 'conectado' : 'ativo'}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-[var(--color-texto-suave)]">
                  {n.telefone ?? 'ainda não conectou nenhuma vez'}
                </p>
              </button>
            )
          )}
        </div>

        <p className="text-xs text-[var(--color-texto-suave)]">
          Só um número fica conectado por vez — dois ao mesmo tempo derrubariam
          os dois. Cada um guarda a própria sessão, então trocar não apaga nada
          e não pede QR de novo depois da primeira vez.
        </p>

        <p className="text-xs text-[var(--color-texto-suave)]">
          <strong>Ao trocar, as campanhas ativas são pausadas.</strong> Quem
          recebeu a abordagem de um número e o follow-up de outro não vê
          continuidade nenhuma — vê um desconhecido. Reative quando quiser.
        </p>

        {trocar.isPending && (
          <p className="flex items-center gap-2 text-xs text-[var(--color-texto-suave)]">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Pedindo a troca ao worker…
          </p>
        )}

        {trocar.isSuccess && trocar.data.trocou && (
          <p className="text-xs text-[var(--color-texto-suave)]">
            Trocando para o número {trocar.data.numero}.{' '}
            {trocar.data.campanhasPausadas > 0 &&
              `${trocar.data.campanhasPausadas} campanha(s) pausada(s). `}
            {trocar.data.detalhe}
          </p>
        )}

        {trocar.isError && (
          <p className="text-xs text-[var(--color-alerta)]">
            {trocar.error instanceof ApiError
              ? trocar.error.message
              : 'Não foi possível trocar de número'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Refazer a conexão — e, quando preciso, pedir um QR novo.
 *
 * ============================================================
 * EM "FALHOU" NÃO EXISTE QR PARA MOSTRAR
 * ============================================================
 * Depois de cinco tentativas o sistema desiste; numa falha de
 * autenticação ele desiste de primeira. Ninguém está tentando conectar,
 * então ninguém está pedindo código — e o botão "Mostrar QR Code"
 * responde "nenhum QR disponível", que é verdade e não ajuda.
 *
 * A saída era reiniciar o worker pelo terminal. Agora é um botão.
 */
function RefazerConexao({ falhou }: { falhou: boolean }): JSX.Element {
  const queryClient = useQueryClient();

  const reconectar = useMutation({
    mutationFn: (novoQr: boolean) =>
      post<{ pedido: boolean; novoQr: boolean; detalhe: string }>(
        '/api/canal/reconectar',
        { novoQr }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['canal-status'] });
      void queryClient.invalidateQueries({ queryKey: ['canal-qr'] });
    },
  });

  return (
    <div className="space-y-2 border-t border-[var(--color-borda)] pt-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secundario"
          onClick={() => reconectar.mutate(false)}
          disabled={reconectar.isPending}
        >
          {reconectar.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Tentar conectar de novo
        </Button>

        <Button
          variant="secundario"
          onClick={() => reconectar.mutate(true)}
          disabled={reconectar.isPending}
        >
          <QrCode className="mr-2 h-4 w-4" aria-hidden="true" />
          Gerar QR Code novo
        </Button>
      </div>

      <p className="text-xs text-[var(--color-texto-suave)]">
        <strong>Tentar de novo</strong> reusa a sessão salva — é o primeiro a
        tentar. <strong>Gerar QR novo</strong> descarta a credencial deste
        número e faz o WhatsApp pedir o código outra vez; o histórico de
        mensagens e o mapa de contatos ficam intactos.
      </p>

      {falhou && (
        <p className="text-xs text-[var(--color-texto-suave)]">
          Como a falha foi de autenticação, reusar a sessão salva tende a
          repetir a recusa — aqui o QR novo costuma ser o caminho.
        </p>
      )}

      {reconectar.isSuccess && (
        <p className="text-xs text-[var(--color-texto-suave)]">
          {reconectar.data.detalhe}
        </p>
      )}

      {reconectar.isError && (
        <p className="text-xs text-[var(--color-alerta)]">
          {reconectar.error instanceof ApiError
            ? reconectar.error.message
            : 'Não foi possível pedir a reconexão'}
        </p>
      )}
    </div>
  );
}

/**
 * Conectar digitando um código, em vez de apontar a câmera.
 *
 * ============================================================
 * O QR FALHA SEM DIZER POR QUÊ
 * ============================================================
 * Ele vence entre a tela e a câmera, o brilho atrapalha, a câmera não
 * pega, os quatro aparelhos conectados estão ocupados. Quando não
 * fecha, não há o que depurar: a tela mostra o mesmo quadrado de novo,
 * e você fica tentando.
 *
 * O código é o MESMO pareamento por outro caminho — oito caracteres
 * digitados no celular. Sem câmera, sem pressa, e quando dá errado o
 * erro é uma frase.
 */
function PorCodigo(): JSX.Element {
  const [telefone, setTelefone] = useState('');
  const [pedido, setPedido] = useState(false);

  const pedir = useMutation({
    mutationFn: (numero: string) =>
      post<{ pedido: boolean }>('/api/canal/codigo', { telefone: numero }),
    onSuccess: () => setPedido(true),
  });

  const { data: codigo, error: erroCodigo } = useQuery({
    queryKey: ['canal-codigo'],
    queryFn: () =>
      get<{ codigo: string; expiraEmSegundos: number }>('/api/canal/codigo'),
    enabled: pedido,
    // O worker leva alguns segundos para pedir o código ao WhatsApp.
    // Para de perguntar assim que houver resposta — código ou erro; o
    // erro também vem por aqui, e insistir nele seria pedir de novo a
    // mesma recusa a cada dois segundos.
    refetchInterval: (consulta) =>
      consulta.state.data || consulta.state.error ? false : 2000,
    retry: false,
  });

  return (
    <div className="space-y-2 border-t border-[var(--color-borda)] pt-4">
      <p className="text-xs font-medium">Ou conecte digitando um código</p>
      <p className="text-xs text-[var(--color-texto-suave)]">
        Sem câmera. O WhatsApp pede o código no próprio celular que vai ser
        conectado.
      </p>

      <div className="flex gap-2">
        <input
          type="tel"
          inputMode="numeric"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          placeholder="5511968662120"
          aria-label="Número do celular com DDI"
          className="w-full rounded-md border border-[var(--color-borda)] bg-transparent px-2 py-1.5 text-sm"
        />
        <Button
          variant="secundario"
          onClick={() => pedir.mutate(telefone)}
          disabled={pedir.isPending || telefone.replace(/\D/g, '').length < 10}
        >
          {pedir.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            'Pedir'
          )}
        </Button>
      </div>

      {pedido && !codigo && !erroCodigo && (
        <p className="flex items-center gap-2 text-xs text-[var(--color-texto-suave)]">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Pedindo o código ao WhatsApp…
        </p>
      )}

      {codigo?.codigo && (
        <div className="rounded-lg border border-[var(--color-primaria)] p-3 text-center">
          <p className="font-mono text-2xl tracking-[0.3em]">{codigo.codigo}</p>
          <p className="mt-2 text-xs text-[var(--color-texto-suave)]">
            No celular: WhatsApp → Aparelhos conectados → Conectar aparelho →
            <strong> Conectar com número de telefone</strong>. Digite este
            código.
          </p>
        </div>
      )}

      {erroCodigo && (
        <p className="text-xs text-[var(--color-alerta)]">
          {erroCodigo instanceof ApiError
            ? erroCodigo.message
            : 'Não foi possível obter o código'}
        </p>
      )}
    </div>
  );
}

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

      <EscolhaDeNumero />

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

                    <PorCodigo />
                    <RefazerConexao falhou={data?.status === 'FALHOU'} />
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

                    {/* O caminho alternativo fica AO LADO do QR, e não
                        escondido atrás dele: quando o QR não fecha, é
                        justamente olhando para ele que você precisa da
                        outra opção. */}
                    <PorCodigo />
                    <RefazerConexao falhou={data?.status === 'FALHOU'} />
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
