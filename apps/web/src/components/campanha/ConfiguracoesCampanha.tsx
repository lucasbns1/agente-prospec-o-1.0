/**
 * Quando e em que ritmo a campanha roda.
 *
 * Estes campos so existiam no formulario de CRIACAO. Depois de criada,
 * mudar o horario exigia SQL — e a primeira coisa que se descobre ao
 * enfileirar de madrugada e que a janela padrao vai ate as 20h.
 *
 * ============================================================
 * MUDAR AQUI NAO REAGENDA O QUE JA ESTA NA FILA
 * ============================================================
 * O horario de cada mensagem e calculado no enfileiramento e congelado.
 * A tela diz isso na cara: descobrir sozinho, vendo a fila parada, custa
 * uma noite.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, Clock } from 'lucide-react';
import { patch, ApiError } from '@/lib/api';
import { Button, Input, Label, Checkbox } from '@/components/ui/primitives';
import { CampoDuracao } from './CampoDuracao';

const DIAS = [
  { valor: 1, rotulo: 'Seg' },
  { valor: 2, rotulo: 'Ter' },
  { valor: 3, rotulo: 'Qua' },
  { valor: 4, rotulo: 'Qui' },
  { valor: 5, rotulo: 'Sex' },
  { valor: 6, rotulo: 'Sáb' },
  { valor: 0, rotulo: 'Dom' },
];

export interface ConfigCampanha {
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
  /** true = simulacao. A barreira #3 das quatro. */
  dryRun: boolean;
}

export function ConfiguracoesCampanha({
  campanhaId,
  valor,
}: {
  campanhaId: string;
  valor: ConfigCampanha;
}) {
  const queryClient = useQueryClient();
  const [c, setC] = useState<ConfigCampanha>(valor);

  const salvar = useMutation({
    mutationFn: (dados: ConfigCampanha) =>
      patch(`/api/campaigns/${campanhaId}`, dados),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campanha', campanhaId] });
    },
  });

  const mudar = (patchC: Partial<ConfigCampanha>): void =>
    setC({ ...c, ...patchC });

  const alternarDia = (dia: number): void => {
    const tem = c.diasPermitidos.includes(dia);
    mudar({
      diasPermitidos: tem
        ? c.diasPermitidos.filter((d) => d !== dia)
        : [...c.diasPermitidos, dia].sort(),
    });
  };

  const horarioInvertido = c.horarioFim <= c.horarioInicio;
  const semDia = c.diasPermitidos.length === 0;
  const delayInvertido =
    c.delayEntreLeadsMaxSegundos < c.delayEntreLeadsMinSegundos ||
    c.delayMaxSegundos < c.delayMinSegundos;

  const impedido = horarioInvertido || semDia || delayInvertido;

  return (
    <div className="space-y-6">
      {/* ---- Janela ---- */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-[var(--color-texto-suave)]" aria-hidden="true" />
          <h3 className="text-sm font-medium">Quando pode enviar</h3>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="hi">Das</Label>
            <Input
              id="hi"
              type="time"
              value={c.horarioInicio}
              onChange={(e) => mudar({ horarioInicio: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="hf">Até</Label>
            <Input
              id="hf"
              type="time"
              value={c.horarioFim}
              onChange={(e) => mudar({ horarioFim: e.target.value })}
            />
          </div>
        </div>

        {horarioInvertido && (
          <p className="text-sm text-[var(--color-alerta)]">
            O horário final precisa ser depois do inicial.
          </p>
        )}

        <div>
          <Label>Dias da semana</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {DIAS.map((d) => {
              const marcado = c.diasPermitidos.includes(d.valor);
              return (
                <button
                  key={d.valor}
                  type="button"
                  aria-pressed={marcado}
                  onClick={() => alternarDia(d.valor)}
                  className={
                    marcado
                      ? 'rounded-lg border border-[var(--color-marca)] bg-[var(--color-marca)] px-3 py-1.5 text-sm text-white'
                      : 'rounded-lg border border-[var(--color-borda)] px-3 py-1.5 text-sm text-[var(--color-texto-suave)] hover:bg-[var(--color-fundo)]'
                  }
                >
                  {d.rotulo}
                </button>
              );
            })}
          </div>
          {semDia && (
            <p className="mt-1.5 text-sm text-[var(--color-alerta)]">
              Sem nenhum dia marcado, nada sai nunca.
            </p>
          )}
        </div>

        <p className="text-xs text-[var(--color-texto-suave)]">
          Fora da janela a mensagem é <strong>adiada</strong>, nunca
          descartada — perder o lead porque a fila virou a noite seria pior.
        </p>
      </section>

      {/* ---- Ritmo ---- */}
      <section className="space-y-3 border-t border-[var(--color-borda)] pt-5">
        <h3 className="text-sm font-medium">Ritmo</h3>

        <div className="grid gap-3 sm:grid-cols-2">
          <CampoDuracao
            id="dlmin"
            rotulo="Intervalo entre leads — mín."
            segundos={c.delayEntreLeadsMinSegundos}
            onChange={(v) => mudar({ delayEntreLeadsMinSegundos: v })}
          />
          <CampoDuracao
            id="dlmax"
            rotulo="Intervalo entre leads — máx."
            segundos={c.delayEntreLeadsMaxSegundos}
            onChange={(v) => mudar({ delayEntreLeadsMaxSegundos: v })}
          />
          <CampoDuracao
            id="demin"
            rotulo="Intervalo entre etapas — mín."
            segundos={c.delayMinSegundos}
            onChange={(v) => mudar({ delayMinSegundos: v })}
          />
          <CampoDuracao
            id="demax"
            rotulo="Intervalo entre etapas — máx."
            segundos={c.delayMaxSegundos}
            onChange={(v) => mudar({ delayMaxSegundos: v })}
          />
        </div>

        {delayInvertido && (
          <p className="text-sm text-[var(--color-alerta)]">
            O intervalo máximo precisa ser maior ou igual ao mínimo.
          </p>
        )}

        <p className="text-xs text-[var(--color-texto-suave)]">
          O intervalo é sorteado dentro da faixa. Ele existe para não
          disparar tudo no mesmo minuto — o padrão que mais chama atenção
          de sistema antispam. Para <strong>testar</strong>, use{' '}
          <strong>0,1 min</strong> (6 segundos) e a fila anda na sua frente.
        </p>
      </section>

      {/* ---- Limites ---- */}
      <section className="space-y-3 border-t border-[var(--color-borda)] pt-5">
        <h3 className="text-sm font-medium">Limites</h3>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="ld">Por dia</Label>
            <Input
              id="ld"
              type="number"
              min={1}
              value={c.limiteDiarioEnvios}
              onChange={(e) => mudar({ limiteDiarioEnvios: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label htmlFor="lh">Por hora</Label>
            <Input
              id="lh"
              type="number"
              min={1}
              value={c.limiteHorarioEnvios}
              onChange={(e) => mudar({ limiteHorarioEnvios: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label htmlFor="ml">Máx. de leads (0 = sem teto)</Label>
            <Input
              id="ml"
              type="number"
              min={0}
              value={c.maxLeads}
              onChange={(e) => mudar({ maxLeads: Number(e.target.value) })}
            />
          </div>
        </div>

        <p className="text-xs text-[var(--color-texto-suave)]">
          Só envio <strong>real</strong> consome os limites. Simulação e
          falha não contam — senão testar queimaria a cota do dia.
        </p>
      </section>

      {/* ---- A barreira da campanha ---- */}
      <section className="space-y-3 border-t border-[var(--color-borda)] pt-5">
        <h3 className="text-sm font-medium">Modo de envio</h3>

        <div
          className={
            c.dryRun
              ? 'rounded-lg border border-[var(--color-borda)] bg-[var(--color-fundo)] p-3'
              : 'rounded-lg border border-[var(--color-alerta)] bg-[var(--color-alerta-bg)] p-3'
          }
        >
          <Checkbox
            rotulo="Simulação — nada é enviado de verdade (recomendado)"
            checked={c.dryRun}
            onChange={(e) => {
              // Desligar a simulação é a única mudança desta tela que
              // pode fazer uma mensagem chegar a um desconhecido.
              if (!e.target.checked) {
                const ok = window.confirm(
                  'Desligar a simulação desta campanha.\n\n' +
                    'As mensagens enfileiradas A PARTIR DE AGORA poderão ser ' +
                    'enviadas de verdade, se as outras barreiras também ' +
                    'estiverem abertas.\n\n' +
                    'Mensagem entregue não tem como voltar atrás. Continuar?'
                );
                if (!ok) return;
              }
              mudar({ dryRun: e.target.checked });
            }}
          />

          {!c.dryRun && (
            <p className="mt-2 text-sm text-[var(--color-alerta)]">
              Esta campanha está liberada para envio real. Ela ainda depende
              das outras barreiras — a trava de fase no código e o{' '}
              <code>WHATSAPP_MODE</code> no <code>.env</code>.
            </p>
          )}
        </div>

        <p className="text-xs text-[var(--color-texto-suave)]">
          Vale só para o que for enfileirado <strong>depois</strong> de
          salvar. As mensagens já na fila mantêm o modo com que nasceram —
          liberar a campanha não transforma em envio real o que já estava
          agendado.
        </p>
      </section>

      {salvar.error && (
        <p className="text-sm text-[var(--color-alerta)]">
          {salvar.error instanceof ApiError
            ? salvar.error.message
            : 'Não foi possível salvar'}
        </p>
      )}

      {salvar.isSuccess && (
        <div className="rounded-lg border border-[var(--color-borda)] bg-[var(--color-fundo)] p-3">
          <p className="text-sm font-medium">Configurações salvas.</p>
          <p className="mt-0.5 text-sm text-[var(--color-texto-suave)]">
            Isto vale para o que for enfileirado <strong>a partir de
            agora</strong>. As mensagens que já estão na fila mantêm o
            horário calculado no enfileiramento — para reagendá-las, pause
            a campanha e enfileire de novo.
          </p>
        </div>
      )}

      <Button onClick={() => salvar.mutate(c)} disabled={salvar.isPending || impedido}>
        {salvar.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Salvando…
          </>
        ) : (
          <>
            <Save className="h-4 w-4" aria-hidden="true" />
            Salvar configurações
          </>
        )}
      </Button>
    </div>
  );
}
