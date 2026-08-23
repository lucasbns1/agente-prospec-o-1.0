/**
 * Seletor de publico da campanha.
 *
 * A tela tem DUAS decisoes: qual planilha, e se pula quem ja foi
 * contatado. Mais nada.
 *
 * Ela ja teve onze controles. Saiu tudo, a pedido de quem usa: a
 * combinacao deles produzia publico errado, e o contador mostrando 0 nao
 * dizia qual dos onze causou. A planilha ja e o recorte — filtrar por
 * cima e refazer, com dados piores, a escolha feita la fora.
 *
 * O contador continua sendo o centro: voce marca uma planilha e ve na
 * hora quantos leads entram.
 *
 * O contador chama `POST /api/campaigns/contar-leads`, que apenas conta
 * — nao grava nada e nao enfileira nada.
 */
import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Users, Loader2, FileSpreadsheet } from 'lucide-react';
import { get, post } from '@/lib/api';
import { Checkbox } from '@/components/ui/primitives';

export interface Filtros {
  exigirTelefone?: boolean;
  exigirSemSite?: boolean;
  exigirComSite?: boolean;
  exigirSemInstagram?: boolean;
  exigirComInstagram?: boolean;
  avaliacaoMinima?: number;
  totalAvaliacoesMinimo?: number;
  cidades?: string[];
  estados?: string[];
  categorias?: string[];
  tags?: string[];
  apenasNuncaContatados?: boolean;
  /** Planilhas classificadas ("psicólogos em Campinas"). */
  captureSessionIds?: string[];
  /** Planilhas sem classificação, escolhidas pelo nome do arquivo. */
  importIds?: string[];
}

interface Lote {
  id: string;
  rotulo: string;
  totalLeads: number;
}

/**
 * Onde os leads se perderam entre a planilha e a campanha.
 *
 * Cada número é "quantos sobraram DEPOIS deste corte" — e não "quantos
 * este corte pegou". Assim a conta não mente quando um lead cai por dois
 * motivos ao mesmo tempo.
 */
interface Funil {
  naPlanilha: number;
  aposExclusoesFixas: number;
  aposTelefone: number;
  total: number;
}

/** Uma linha do funil, só quando ela explica alguma perda. */
function Perda({ quantos, texto }: { quantos: number; texto: string }) {
  if (quantos <= 0) return null;
  return (
    <li className="flex justify-between gap-3">
      <span>{texto}</span>
      <span className="shrink-0 font-medium">−{quantos}</span>
    </li>
  );
}

export function FiltrosLead({
  valor,
  aoMudar,
}: {
  valor: Filtros;
  aoMudar: (f: Filtros) => void;
}) {
  const contar = useMutation({
    mutationFn: (f: Filtros) =>
      post<{ total: number; funil: Funil }>('/api/campaigns/contar-leads', f),
  });

  const { data: lotes } = useQuery({
    queryKey: ['lotes'],
    queryFn: () => get<{ sessoes: Lote[]; arquivos: Lote[] }>('/api/imports/lotes'),
  });

  /** Liga/desliga um lote sem apagar os outros já escolhidos. */
  const alternarLote = (
    campo: 'captureSessionIds' | 'importIds',
    id: string,
    marcado: boolean
  ): void => {
    const atual = valor[campo] ?? [];
    const novo = marcado ? [...atual, id] : atual.filter((x) => x !== id);
    // Lista vazia vira `undefined`: um array vazio no filtro significaria
    // "nenhum lote serve" e zeraria o público sem querer.
    mudar({ [campo]: novo.length > 0 ? novo : undefined } as Partial<Filtros>);
  };

  // Recontagem com atraso: sem isso cada tecla digitada em "cidades"
  // viraria uma consulta ao banco.
  useEffect(() => {
    const t = setTimeout(() => contar.mutate(valor), 400);
    return () => clearTimeout(t);
    // `contar` e estavel o suficiente; depender dele reiniciaria o timer
    // a cada resposta e criaria um laco de consultas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(valor)]);

  const mudar = (patch: Partial<Filtros>): void => aoMudar({ ...valor, ...patch });

  const totalLotes =
    (lotes?.sessoes.length ?? 0) + (lotes?.arquivos.length ?? 0);
  const nenhumLoteEscolhido =
    !valor.captureSessionIds?.length && !valor.importIds?.length;

  return (
    <div className="space-y-5">
      {/* Lotes primeiro: escolher a planilha é a decisão mais grossa do
          público. Os filtros abaixo refinam dentro do que foi escolhido. */}
      {totalLotes > 0 && (
        <div className="space-y-2 rounded-lg border border-[var(--color-borda)] p-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet
              className="h-4 w-4 text-[var(--color-texto-suave)]"
              aria-hidden="true"
            />
            <span className="text-sm font-medium">Planilhas</span>
          </div>

          <p className="text-xs text-[var(--color-texto-suave)]">
            {nenhumLoteEscolhido
              ? 'Nenhuma escolhida — a campanha considera todos os leads.'
              : 'A campanha usa só os leads das planilhas marcadas.'}
          </p>

          <div className="space-y-1.5 pt-1">
            {lotes?.sessoes.map((s) => (
              <Checkbox
                key={s.id}
                rotulo={`${s.rotulo} (${s.totalLeads})`}
                checked={valor.captureSessionIds?.includes(s.id) ?? false}
                onChange={(e) =>
                  alternarLote('captureSessionIds', s.id, e.target.checked)
                }
              />
            ))}

            {lotes?.arquivos.map((a) => (
              <Checkbox
                key={a.id}
                rotulo={`${a.rotulo} (${a.totalLeads}) — sem classificação`}
                checked={valor.importIds?.includes(a.id) ?? false}
                onChange={(e) => alternarLote('importIds', a.id, e.target.checked)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ============================================================
          SÓ UMA CAIXA, DE PROPÓSITO
          ============================================================
          Havia aqui seis caixas e cinco campos de texto — cidade,
          estado, categoria, avaliação mínima, com/sem site, com/sem
          Instagram. Saíram a pedido de quem usa, depois de a combinação
          deles produzir público errado mais de uma vez.

          O motivo é que eles se sobrepunham à escolha da planilha e
          brigavam entre si em silêncio: marcar "só quem NÃO tem site" e
          escolher uma planilha em que a coluna de site veio vazia zerava
          o público sem dizer por quê. O contador mostrava 0 e não havia
          como saber qual dos onze controles causou.

          A planilha já é o recorte: ela foi montada com o nicho e a
          cidade certos. Filtrar de novo por cima é refazer, com dados
          piores, a escolha que já foi feita lá fora.

          Sobrou "só nunca contatados", que não recorta o público por
          característica — evita falar duas vezes com a mesma pessoa. */}
      <Checkbox
        rotulo="Só nunca contatados"
        checked={valor.apenasNuncaContatados === true}
        onChange={(e) =>
          mudar({ apenasNuncaContatados: e.target.checked || undefined })
        }
      />

      <div className="flex items-center gap-2 rounded-lg bg-[var(--color-fundo)] px-4 py-3">
        {contar.isPending ? (
          <Loader2
            className="h-4 w-4 animate-spin text-[var(--color-texto-suave)]"
            aria-hidden="true"
          />
        ) : (
          <Users className="h-4 w-4 text-[var(--color-marca)]" aria-hidden="true" />
        )}
        <p className="text-sm" aria-live="polite">
          <strong>{contar.data?.total ?? 0}</strong> leads entram nesta campanha
        </p>
      </div>

      {/* ============================================================
          O ZERO PRECISA SE EXPLICAR
          ============================================================
          A tela mostrava "0 leads" e parava ali. O zero pode vir de
          quatro lugares — opt-out, falta de telefone, já contatado, ou
          planilha errada — e nenhum aparecia. Ajustar o público virava
          tentativa e erro.

          Só aparece quando houve perda: com todos entrando, esta caixa
          seria ruído. */}
      {contar.data &&
        (contar.data.total === 0 ||
          contar.data.funil.naPlanilha > contar.data.total) && (
        <div className="rounded-lg border border-[var(--color-borda)] px-4 py-3 text-xs text-[var(--color-texto-suave)]">
          <p className="mb-1.5">
            Partindo de <strong>{contar.data.funil.naPlanilha}</strong> lead(s)
            {nenhumLoteEscolhido ? ' no CRM' : ' nas planilhas marcadas'}:
          </p>

          {/* O caso que ainda deixava um zero sem explicacao: a planilha
              marcada nao casa com lead nenhum. Acontece quando os leads
              dela foram apagados, ou quando a mesma lista foi importada
              duas vezes e a segunda so gerou duplicados. */}
          {contar.data.funil.naPlanilha === 0 && (
            <p className="text-[var(--color-alerta)]">
              {nenhumLoteEscolhido
                ? 'Não há nenhum lead no CRM.'
                : 'As planilhas marcadas não têm nenhum lead no CRM. O número ao lado do nome conta os leads da importação; se eles foram apagados depois, ele fica desatualizado.'}
            </p>
          )}

          <ul className="space-y-1">
            <Perda
              quantos={
                contar.data.funil.naPlanilha - contar.data.funil.aposExclusoesFixas
              }
              texto="pediram para sair, ou aguardam sua intervenção"
            />
            <Perda
              quantos={
                contar.data.funil.aposExclusoesFixas - contar.data.funil.aposTelefone
              }
              texto="estão sem telefone"
            />
            <Perda
              quantos={contar.data.funil.aposTelefone - contar.data.total}
              texto={
                valor.apenasNuncaContatados
                  ? 'já receberam mensagem antes'
                  : 'não passaram nos demais critérios'
              }
            />
          </ul>
        </div>
      )}

      <p className="text-xs leading-relaxed text-[var(--color-texto-suave)]">
        Leads que pediram para sair (opt-out) e leads aguardando sua
        intervenção nunca entram — isso não é configurável. Lead sem
        telefone também fica de fora: não há para onde mandar.
      </p>
    </div>
  );
}
