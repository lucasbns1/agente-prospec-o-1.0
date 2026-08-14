/**
 * Seletor de publico da campanha.
 *
 * O contador de leads e o ponto central desta tela: voce mexe num
 * filtro e ve na hora quantos leads sobram. Sem isso a escolha do
 * publico vira adivinhacao, e so apareceria errada na previa.
 *
 * O contador chama `POST /api/campaigns/contar-leads`, que apenas conta
 * — nao grava nada e nao enfileira nada.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Users, Loader2, FileSpreadsheet } from 'lucide-react';
import { get, post } from '@/lib/api';
import { Input, Label, Checkbox } from '@/components/ui/primitives';

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

/** "Campinas, Santos" => ["Campinas", "Santos"]. Vazio vira undefined. */
function listaDeTexto(texto: string): string[] | undefined {
  const itens = texto
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return itens.length > 0 ? itens : undefined;
}

function textoDeLista(lista: string[] | undefined): string {
  return (lista ?? []).join(', ');
}

export function FiltrosLead({
  valor,
  aoMudar,
}: {
  valor: Filtros;
  aoMudar: (f: Filtros) => void;
}) {
  const [cidades, setCidades] = useState(textoDeLista(valor.cidades));
  const [estados, setEstados] = useState(textoDeLista(valor.estados));
  const [categorias, setCategorias] = useState(textoDeLista(valor.categorias));

  const contar = useMutation({
    mutationFn: (f: Filtros) => post<{ total: number }>('/api/campaigns/contar-leads', f),
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

  /** Marca um par mutuamente exclusivo sem deixar os dois ligados. */
  const exclusivo = (
    campo: keyof Filtros,
    oposto: keyof Filtros,
    marcado: boolean
  ): void =>
    mudar({
      [campo]: marcado ? true : undefined,
      ...(marcado ? { [oposto]: undefined } : {}),
    } as Partial<Filtros>);

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

      <div className="grid gap-3 sm:grid-cols-2">
        <Checkbox
          rotulo="Só leads com telefone"
          checked={valor.exigirTelefone === true}
          onChange={(e) => mudar({ exigirTelefone: e.target.checked || undefined })}
        />
        <Checkbox
          rotulo="Só nunca contatados"
          checked={valor.apenasNuncaContatados === true}
          onChange={(e) =>
            mudar({ apenasNuncaContatados: e.target.checked || undefined })
          }
        />
        <Checkbox
          rotulo="Só quem NÃO tem site próprio"
          checked={valor.exigirSemSite === true}
          onChange={(e) => exclusivo('exigirSemSite', 'exigirComSite', e.target.checked)}
        />
        <Checkbox
          rotulo="Só quem TEM site próprio"
          checked={valor.exigirComSite === true}
          onChange={(e) => exclusivo('exigirComSite', 'exigirSemSite', e.target.checked)}
        />
        <Checkbox
          rotulo="Só quem NÃO tem Instagram"
          checked={valor.exigirSemInstagram === true}
          onChange={(e) =>
            exclusivo('exigirSemInstagram', 'exigirComInstagram', e.target.checked)
          }
        />
        <Checkbox
          rotulo="Só quem TEM Instagram"
          checked={valor.exigirComInstagram === true}
          onChange={(e) =>
            exclusivo('exigirComInstagram', 'exigirSemInstagram', e.target.checked)
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="f-cidades">Cidades</Label>
          <Input
            id="f-cidades"
            value={cidades}
            placeholder="Campinas, Santos"
            onChange={(e) => {
              setCidades(e.target.value);
              mudar({ cidades: listaDeTexto(e.target.value) });
            }}
          />
        </div>
        <div>
          <Label htmlFor="f-estados">Estados (UF)</Label>
          <Input
            id="f-estados"
            value={estados}
            placeholder="SP, RJ"
            onChange={(e) => {
              setEstados(e.target.value);
              mudar({ estados: listaDeTexto(e.target.value) });
            }}
          />
        </div>
        <div>
          <Label htmlFor="f-categorias">Categorias</Label>
          <Input
            id="f-categorias"
            value={categorias}
            placeholder="Psicólogo, Clínica"
            onChange={(e) => {
              setCategorias(e.target.value);
              mudar({ categorias: listaDeTexto(e.target.value) });
            }}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="f-aval">Avaliação mínima</Label>
          <Input
            id="f-aval"
            type="number"
            min={0}
            max={5}
            step={0.1}
            value={valor.avaliacaoMinima ?? ''}
            placeholder="Qualquer"
            onChange={(e) =>
              mudar({
                avaliacaoMinima:
                  e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          />
        </div>
        <div>
          <Label htmlFor="f-total">Mínimo de avaliações</Label>
          <Input
            id="f-total"
            type="number"
            min={0}
            value={valor.totalAvaliacoesMinimo ?? ''}
            placeholder="Qualquer"
            onChange={(e) =>
              mudar({
                totalAvaliacoesMinimo:
                  e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          />
        </div>
      </div>

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
          <strong>{contar.data?.total ?? 0}</strong> leads correspondem a estes
          filtros
        </p>
      </div>

      <p className="text-xs leading-relaxed text-[var(--color-texto-suave)]">
        Leads que pediram para sair (opt-out) e leads aguardando sua
        intervenção nunca entram — isso não é configurável.
      </p>
    </div>
  );
}
