/**
 * Painel de acoes do lead — a intervencao manual.
 *
 * ============================================================
 * NADA AQUI ENVIA MENSAGEM
 * ============================================================
 * "Assumir a conversa" significa que VOCE vai falar com a pessoa, pelo
 * seu WhatsApp. Este painel apenas registra o que aconteceu e destrava o
 * lead — que ate a Fase 4 ficava preso num status sem saida.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Check, Ban, StickyNote, Thermometer, ArrowRightLeft, Undo2,
} from 'lucide-react';
import { post, ApiError } from '@/lib/api';
import {
  Button, Badge, Textarea, Select, Label,
} from '@/components/ui/primitives';

const STATUS_MANUAIS = [
  { valor: 'PRONTO', rotulo: 'Pronto para prospecção' },
  { valor: 'EM_CONVERSA', rotulo: 'Em conversa' },
  { valor: 'AGENDADO', rotulo: 'Agendado' },
  { valor: 'PAUSADO', rotulo: 'Pausado' },
  { valor: 'OPORTUNIDADE', rotulo: 'Oportunidade' },
  { valor: 'CLIENTE', rotulo: 'Cliente' },
  { valor: 'ENCERRADO', rotulo: 'Encerrado' },
];

const DESTINOS_INTERVENCAO = [
  { valor: 'EM_CONVERSA', rotulo: 'Em conversa — eu assumi' },
  { valor: 'AGENDADO', rotulo: 'Agendado — combinamos depois' },
  { valor: 'OPORTUNIDADE', rotulo: 'Oportunidade — vai fechar' },
  { valor: 'CLIENTE', rotulo: 'Cliente — fechou' },
  { valor: 'PAUSADO', rotulo: 'Pausado — deixar quieto' },
  { valor: 'ENCERRADO', rotulo: 'Encerrado — não vai dar' },
];

interface Props {
  lead: {
    id: string;
    status: string;
    temperatura: string;
    optOut: boolean;
    proximaAcao: string | null;
  };
}

function useInvalidar(leadId: string) {
  const queryClient = useQueryClient();
  return (): void => {
    void queryClient.invalidateQueries({ queryKey: ['leads', leadId] });
    void queryClient.invalidateQueries({ queryKey: ['leads'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['tarefas'] });
  };
}

function Erro({ de }: { de: unknown }) {
  if (!de) return null;
  return (
    <p className="text-xs text-[var(--color-alerta)]">
      {de instanceof ApiError ? de.message : 'Não foi possível concluir a ação'}
    </p>
  );
}

// ------------------------------------------------------- resolver intervencao
function ResolverIntervencao({ lead }: Props) {
  const invalidar = useInvalidar(lead.id);
  const [destino, setDestino] = useState('EM_CONVERSA');
  const [nota, setNota] = useState('');

  const resolver = useMutation({
    mutationFn: () =>
      post<{ tarefasConcluidas: number }>(
        `/api/leads/${lead.id}/resolver-intervencao`,
        { novoStatus: destino, nota: nota.trim() || undefined }
      ),
    onSuccess: invalidar,
  });

  return (
    <div className="rounded-lg border border-[var(--color-alerta)] bg-[var(--color-alerta-bg)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="alerta">Aguardando você</Badge>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-[var(--color-texto-suave)]">
        O sistema parou esta conversa de propósito e não vai retomá-la
        sozinho. Fale com a pessoa pelo seu WhatsApp e registre aqui o que
        aconteceu.
        {lead.proximaAcao && (
          <>
            {' '}
            Motivo: <strong>{lead.proximaAcao}</strong>
          </>
        )}
      </p>

      <div className="space-y-3">
        <div>
          <Label htmlFor="destino">Depois desta conversa, o lead fica</Label>
          <Select
            id="destino"
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
          >
            {DESTINOS_INTERVENCAO.map((d) => (
              <option key={d.valor} value={d.valor}>
                {d.rotulo}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="nota-intervencao">O que aconteceu (opcional)</Label>
          <Textarea
            id="nota-intervencao"
            rows={3}
            value={nota}
            placeholder="Ex.: liguei, ela pediu para mandar o orçamento por e-mail"
            onChange={(e) => setNota(e.target.value)}
          />
        </div>

        <Button onClick={() => resolver.mutate()} disabled={resolver.isPending}>
          {resolver.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-4 w-4" aria-hidden="true" />
          )}
          Resolver intervenção
        </Button>

        {resolver.isSuccess && (
          <p className="text-xs text-[var(--color-sucesso)]">
            Resolvida
            {resolver.data.tarefasConcluidas > 0 &&
              ` · ${resolver.data.tarefasConcluidas} tarefa(s) concluída(s)`}
            .
          </p>
        )}
        <Erro de={resolver.isError ? resolver.error : null} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ opt-out
function BlocoOptOut({ lead }: Props) {
  const invalidar = useInvalidar(lead.id);
  const [revertendo, setRevertendo] = useState(false);
  const [motivo, setMotivo] = useState('');

  const reverter = useMutation({
    mutationFn: () =>
      post(`/api/leads/${lead.id}/opt-out/reverter`, {
        confirmar: true,
        motivo: motivo.trim(),
      }),
    onSuccess: () => {
      invalidar();
      setRevertendo(false);
      setMotivo('');
    },
  });

  return (
    <div className="rounded-lg border border-[var(--color-borda-forte)] bg-[var(--color-fundo)] p-4">
      <p className="text-sm font-medium">Este lead pediu para não ser contatado.</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--color-texto-suave)]">
        Nenhuma campanha alcança este lead, e isso não é configurável. As
        mensagens que estavam na fila foram canceladas.
      </p>

      {!revertendo ? (
        <Button
          variant="fantasma"
          size="sm"
          className="mt-3"
          onClick={() => setRevertendo(true)}
        >
          <Undo2 className="h-4 w-4" aria-hidden="true" />
          Foi um engano — reverter
        </Button>
      ) : (
        <div className="mt-3 space-y-2">
          <Label htmlFor="motivo-reverter">
            Por que está revertendo? (fica registrado)
          </Label>
          <Textarea
            id="motivo-reverter"
            rows={2}
            value={motivo}
            placeholder="Ex.: marquei o lead errado"
            onChange={(e) => setMotivo(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="perigo"
              size="sm"
              disabled={motivo.trim().length < 3 || reverter.isPending}
              onClick={() => reverter.mutate()}
            >
              {reverter.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Confirmar reversão
            </Button>
            <Button variant="secundario" size="sm" onClick={() => setRevertendo(false)}>
              Cancelar
            </Button>
          </div>
          <Erro de={reverter.isError ? reverter.error : null} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- painel
export function AcoesLead({ lead }: Props) {
  const invalidar = useInvalidar(lead.id);
  const [nota, setNota] = useState('');
  const [confirmandoOptOut, setConfirmandoOptOut] = useState(false);

  const mudarStatus = useMutation({
    mutationFn: (status: string) => post(`/api/leads/${lead.id}/status`, { status }),
    onSuccess: invalidar,
  });

  const mudarTemperatura = useMutation({
    mutationFn: (temperatura: string) =>
      post(`/api/leads/${lead.id}/temperatura`, { temperatura }),
    onSuccess: invalidar,
  });

  const anotar = useMutation({
    mutationFn: () => post(`/api/leads/${lead.id}/nota`, { texto: nota.trim() }),
    onSuccess: () => {
      invalidar();
      setNota('');
    },
  });

  const registrarOptOut = useMutation({
    mutationFn: () => post(`/api/leads/${lead.id}/opt-out`, {}),
    onSuccess: () => {
      invalidar();
      setConfirmandoOptOut(false);
    },
  });

  if (lead.optOut) {
    return (
      <section className="space-y-4">
        <h3 className="text-xs font-semibold tracking-wide text-[var(--color-texto-suave)]">
          AÇÕES
        </h3>
        <BlocoOptOut lead={lead} />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h3 className="text-xs font-semibold tracking-wide text-[var(--color-texto-suave)]">
        AÇÕES
      </h3>

      {lead.status === 'AGUARDANDO_INTERVENCAO' && <ResolverIntervencao lead={lead} />}

      {/* Status */}
      <div>
        <Label htmlFor="status-lead" className="flex items-center gap-1.5">
          <ArrowRightLeft className="h-3 w-3" aria-hidden="true" />
          Status
        </Label>
        <Select
          id="status-lead"
          value={STATUS_MANUAIS.some((s) => s.valor === lead.status) ? lead.status : ''}
          disabled={mudarStatus.isPending}
          onChange={(e) => mudarStatus.mutate(e.target.value)}
        >
          {/* O status atual pode ser um que o sistema controla (ex.:
              AGUARDANDO_RESPOSTA). Ele aparece como opção inerte para a
              caixa não mentir mostrando outro valor. */}
          {!STATUS_MANUAIS.some((s) => s.valor === lead.status) && (
            <option value="">
              {lead.status.charAt(0) +
                lead.status.slice(1).toLowerCase().replace(/_/g, ' ')}{' '}
              (definido pelo sistema)
            </option>
          )}
          {STATUS_MANUAIS.map((s) => (
            <option key={s.valor} value={s.valor}>
              {s.rotulo}
            </option>
          ))}
        </Select>
        <Erro de={mudarStatus.isError ? mudarStatus.error : null} />
      </div>

      {/* Temperatura */}
      <div>
        <Label className="flex items-center gap-1.5">
          <Thermometer className="h-3 w-3" aria-hidden="true" />
          Temperatura
        </Label>
        <div className="flex gap-1.5">
          {['FRIO', 'MORNO', 'QUENTE'].map((t) => (
            <Button
              key={t}
              size="sm"
              variant={lead.temperatura === t ? 'primary' : 'secundario'}
              disabled={mudarTemperatura.isPending}
              onClick={() => mudarTemperatura.mutate(t)}
            >
              {t.charAt(0) + t.slice(1).toLowerCase()}
            </Button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-[var(--color-texto-suave)]">
          A temperatura é independente do status: um lead quente pode estar
          pausado.
        </p>
      </div>

      {/* Nota */}
      <div>
        <Label htmlFor="nota-lead" className="flex items-center gap-1.5">
          <StickyNote className="h-3 w-3" aria-hidden="true" />
          Anotar
        </Label>
        <Textarea
          id="nota-lead"
          rows={2}
          value={nota}
          placeholder="O que você combinou com esta pessoa"
          onChange={(e) => setNota(e.target.value)}
        />
        <Button
          size="sm"
          className="mt-2"
          disabled={nota.trim() === '' || anotar.isPending}
          onClick={() => anotar.mutate()}
        >
          {anotar.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          Salvar nota
        </Button>
      </div>

      {/* Opt-out */}
      <div className="border-t border-[var(--color-borda)] pt-4">
        {!confirmandoOptOut ? (
          <Button
            variant="fantasma"
            size="sm"
            onClick={() => setConfirmandoOptOut(true)}
          >
            <Ban className="h-4 w-4" aria-hidden="true" />
            Registrar opt-out
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-[var(--color-texto-suave)]">
              Isto cancela as mensagens na fila e tira o lead de todas as
              campanhas, agora e no futuro. Dá para reverter, mas com
              justificativa registrada.
            </p>
            <div className="flex gap-2">
              <Button
                variant="perigo"
                size="sm"
                disabled={registrarOptOut.isPending}
                onClick={() => registrarOptOut.mutate()}
              >
                {registrarOptOut.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                Confirmar opt-out
              </Button>
              <Button
                variant="secundario"
                size="sm"
                onClick={() => setConfirmandoOptOut(false)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
