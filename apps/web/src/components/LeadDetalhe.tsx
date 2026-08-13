/**
 * Painel lateral com o detalhe do lead.
 *
 * Mostra os dados normalizados, os originais quando divergem, e o
 * historico completo de eventos — que e append-only no banco e nunca
 * e reescrito.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, ExternalLink, Star, MapPin, Phone, Globe, Clock } from 'lucide-react';
import { get } from '@/lib/api';
import { Badge, Button, variantePorTemperatura } from '@/components/ui/primitives';
import { formatarDataHora } from '@/lib/utils';

interface Evento {
  id: string;
  tipo: string;
  descricao: string;
  origem: string;
  createdAt: string;
}

interface LeadCompleto {
  id: string;
  nomeCompleto: string | null;
  nomeOriginal: string | null;
  primeiroNome: string | null;
  empresa: string | null;
  nomeContato: string | null;
  categoria: string | null;
  telefone: string | null;
  telefoneNormalizado: string | null;
  telefoneOriginal: string | null;
  email: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  enderecoOriginal: string | null;
  websiteUrl: string | null;
  websiteStatus: string;
  websiteOriginal: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  avaliacao: number | null;
  totalAvaliacoes: number | null;
  status: string;
  temperatura: string;
  optOut: boolean;
  ultimaCategoria: string | null;
  ultimaInteracaoEm: string | null;
  proximaAcao: string | null;
  origem: string | null;
  fonteUrl: string | null;
  observacoes: string | null;
  createdAt: string;
  events: Evento[];
  campaign: { id: string; nome: string } | null;
  import: { id: string; nomeArquivo: string; createdAt: string } | null;
  leadCampaigns: Array<{
    id: string;
    status: string;
    campaign: { id: string; nome: string };
    etapaAtual: { id: string; ordem: number; nome: string | null } | null;
  }>;
}

function Campo({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-1.5">
      <dt className="text-xs text-[var(--color-texto-suave)]">{rotulo}</dt>
      <dd className="text-sm">
        {valor ?? <span className="text-[var(--color-texto-fraco)]">—</span>}
      </dd>
    </div>
  );
}

export function LeadDetalhe({
  leadId,
  onFechar,
}: {
  leadId: string;
  onFechar: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['leads', leadId],
    queryFn: () => get<{ lead: LeadCompleto }>(`/api/leads/${leadId}`),
  });

  // Esc fecha o painel — navegacao por teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onFechar]);

  const lead = data?.lead;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/20"
      onClick={onFechar}
      role="dialog"
      aria-modal="true"
      aria-label="Detalhe do lead"
    >
      <div
        className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-[var(--color-borda)] bg-white px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">
              {isLoading ? 'Carregando…' : (lead?.nomeCompleto ?? 'Lead sem nome')}
            </h2>
            {lead && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge variant={variantePorTemperatura(lead.temperatura)}>
                  {lead.temperatura.toLowerCase()}
                </Badge>
                <Badge variant="neutro">
                  {lead.status.charAt(0) + lead.status.slice(1).toLowerCase().replace(/_/g, ' ')}
                </Badge>
                {lead.optOut && <Badge variant="alerta">opt-out</Badge>}
                {lead.websiteStatus !== 'SITE_PROPRIO' && (
                  <Badge variant="info">sem site próprio</Badge>
                )}
              </div>
            )}
          </div>
          <Button variant="fantasma" size="icone" onClick={onFechar} aria-label="Fechar">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        {lead && (
          <div className="space-y-6 px-5 py-5">
            {/* Contato */}
            <section>
              <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[var(--color-texto-suave)]">
                <Phone className="h-3 w-3" aria-hidden="true" /> CONTATO
              </h3>
              <dl className="divide-y divide-[var(--color-borda)]">
                <Campo rotulo="Telefone" valor={lead.telefone} />
                <Campo
                  rotulo="Normalizado"
                  valor={
                    lead.telefoneNormalizado ? (
                      <code className="text-xs">{lead.telefoneNormalizado}</code>
                    ) : (
                      <span className="text-[var(--color-morno)]">
                        não utilizável para envio
                      </span>
                    )
                  }
                />
                <Campo rotulo="E-mail" valor={lead.email} />
                <Campo rotulo="Primeiro nome" valor={
                  lead.primeiroNome ?? (
                    <span className="text-[var(--color-morno)]">
                      não extraído — bloqueia mensagens com {'{{primeiro_nome}}'}
                    </span>
                  )
                } />
              </dl>
            </section>

            {/* Localização */}
            <section>
              <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[var(--color-texto-suave)]">
                <MapPin className="h-3 w-3" aria-hidden="true" /> LOCALIZAÇÃO
              </h3>
              <dl className="divide-y divide-[var(--color-borda)]">
                <Campo rotulo="Endereço" valor={
                  lead.logradouro
                    ? `${lead.logradouro}${lead.numero ? `, ${lead.numero}` : ''}`
                    : null
                } />
                <Campo rotulo="Bairro" valor={lead.bairro} />
                <Campo rotulo="Cidade" valor={lead.cidade} />
                <Campo rotulo="Estado" valor={lead.estado} />
                <Campo rotulo="CEP" valor={lead.cep} />
                <Campo rotulo="Categoria" valor={lead.categoria} />
              </dl>
            </section>

            {/* Presença digital */}
            <section>
              <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[var(--color-texto-suave)]">
                <Globe className="h-3 w-3" aria-hidden="true" /> PRESENÇA DIGITAL
              </h3>
              <dl className="divide-y divide-[var(--color-borda)]">
                <Campo rotulo="Website" valor={
                  lead.websiteUrl ? (
                    <a
                      href={lead.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[var(--color-marca-clara)] underline"
                    >
                      {lead.websiteUrl.replace(/^https?:\/\//, '').slice(0, 40)}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : null
                } />
                <Campo rotulo="Status do site" valor={
                  <span className={lead.websiteStatus === 'SITE_PROPRIO' ? '' : 'text-[var(--color-info)]'}>
                    {lead.websiteStatus.replace(/_/g, ' ').toLowerCase()}
                  </span>
                } />
                <Campo rotulo="Instagram" valor={lead.instagramUrl} />
                <Campo rotulo="Facebook" valor={lead.facebookUrl} />
                <Campo rotulo="Avaliação" valor={
                  lead.avaliacao !== null ? (
                    <span className="inline-flex items-center gap-1">
                      <Star className="h-3 w-3 fill-[var(--color-morno)] text-[var(--color-morno)]" aria-hidden="true" />
                      <span className="num">{lead.avaliacao}</span>
                      {lead.totalAvaliacoes !== null && (
                        <span className="text-xs text-[var(--color-texto-suave)]">
                          ({lead.totalAvaliacoes} avaliações)
                        </span>
                      )}
                    </span>
                  ) : null
                } />
              </dl>
            </section>

            {/* Origem */}
            <section>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-[var(--color-texto-suave)]">
                ORIGEM
              </h3>
              <dl className="divide-y divide-[var(--color-borda)]">
                <Campo rotulo="Fonte" valor={lead.origem} />
                <Campo rotulo="Arquivo" valor={lead.import?.nomeArquivo} />
                <Campo rotulo="URL da fonte" valor={
                  lead.fonteUrl ? (
                    <a href={lead.fonteUrl} target="_blank" rel="noopener noreferrer"
                       className="text-[var(--color-marca-clara)] underline">
                      abrir
                    </a>
                  ) : null
                } />
                <Campo rotulo="Importado em" valor={formatarDataHora(lead.createdAt)} />
                <Campo rotulo="Nome original" valor={
                  lead.nomeOriginal !== lead.nomeCompleto ? (
                    <code className="text-xs">{lead.nomeOriginal}</code>
                  ) : null
                } />
              </dl>
            </section>

            {/* Campanha */}
            <section>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-[var(--color-texto-suave)]">
                CAMPANHA
              </h3>
              <dl className="divide-y divide-[var(--color-borda)]">
                <Campo rotulo="Campanha" valor={lead.campaign?.nome} />
                <Campo rotulo="Etapa atual" valor={
                  lead.leadCampaigns[0]?.etapaAtual
                    ? `MSG ${lead.leadCampaigns[0].etapaAtual.ordem}`
                    : null
                } />
                <Campo rotulo="Última resposta" valor={lead.ultimaCategoria} />
                <Campo rotulo="Última interação" valor={
                  lead.ultimaInteracaoEm ? formatarDataHora(lead.ultimaInteracaoEm) : null
                } />
                <Campo rotulo="Próxima ação" valor={lead.proximaAcao} />
                <Campo rotulo="Observações" valor={lead.observacoes} />
              </dl>
            </section>

            {/* Histórico */}
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[var(--color-texto-suave)]">
                <Clock className="h-3 w-3" aria-hidden="true" /> HISTÓRICO ({lead.events.length})
              </h3>
              <ol className="space-y-2.5 border-l border-[var(--color-borda)] pl-4">
                {lead.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span
                      className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-[var(--color-borda-forte)]"
                      aria-hidden="true"
                    />
                    <div className="text-sm">{e.descricao}</div>
                    <div className="text-xs text-[var(--color-texto-fraco)]">
                      {formatarDataHora(e.createdAt)} · {e.tipo.toLowerCase().replace(/_/g, ' ')}
                    </div>
                  </li>
                ))}
                {lead.events.length === 0 && (
                  <li className="text-sm text-[var(--color-texto-fraco)]">
                    Nenhum evento registrado.
                  </li>
                )}
              </ol>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
