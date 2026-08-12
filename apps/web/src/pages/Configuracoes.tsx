/**
 * Configurações — somente leitura na Fase 1.
 *
 * Esta tela existe desde ja com um proposito especifico: provar
 * visualmente que os dominios sociais e o dicionario do motor de regras
 * estao NO BANCO, e nao chumbados no codigo. Voce consegue conferir isso
 * antes mesmo de existir a tela de edicao (Fase 9).
 */
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { get } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui/primitives';

interface SettingsResp {
  settings: Array<{
    id: string;
    chave: string;
    valor: unknown;
    descricao: string | null;
    categoria: string;
    sistema: boolean;
  }>;
}

interface DominiosResp {
  dominios: Array<{ id: string; dominio: string; rotulo: string | null; ativo: boolean }>;
}

interface KeywordsResp {
  total: number;
  porCategoria: Record<
    string,
    Array<{ id: string; termo: string; matchTipo: string; peso: number; ativo: boolean }>
  >;
}

export function Configuracoes() {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => get<SettingsResp>('/api/settings'),
  });
  const dominios = useQuery({
    queryKey: ['settings', 'social-domains'],
    queryFn: () => get<DominiosResp>('/api/settings/social-domains'),
  });
  const keywords = useQuery({
    queryKey: ['settings', 'keywords'],
    queryFn: () => get<KeywordsResp>('/api/settings/keywords'),
  });

  const porCategoria = settings.data?.settings.reduce<
    Record<string, SettingsResp['settings']>
  >((acc, s) => {
    (acc[s.categoria] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Configurações</h1>
        <p className="mt-0.5 text-sm text-[var(--color-texto-suave)]">
          Tudo abaixo vive no banco de dados e será editável na Fase 9.
          Nenhum destes valores está escrito no código.
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-[var(--color-borda)] bg-white px-3 py-2 text-xs text-[var(--color-texto-suave)]">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        Somente leitura nesta fase.
      </div>

      {/* Domínios sociais */}
      <Card>
        <CardHeader>
          <CardTitle>Domínios que não contam como site próprio</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {dominios.data?.dominios.map((d) => (
              <Badge key={d.id} variant={d.ativo ? 'info' : 'neutro'}>
                {d.dominio}
                {d.rotulo ? ` · ${d.rotulo}` : ''}
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--color-texto-fraco)]">
            Um domínio fora desta lista nunca é tratado como rede social
            automaticamente — só entra aqui por decisão sua.
          </p>
        </CardContent>
      </Card>

      {/* Dicionário do motor de regras */}
      <Card>
        <CardHeader>
          <CardTitle>
            Motor de regras — {keywords.data?.total ?? 0} termos configurados
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(keywords.data?.porCategoria ?? {}).map(([cat, termos]) => (
            <div key={cat}>
              <div className="mb-1.5 text-xs font-semibold tracking-wide text-[var(--color-texto-suave)]">
                {cat} <span className="font-normal">({termos.length})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {termos.map((t) => (
                  <span
                    key={t.id}
                    title={`${t.matchTipo} · peso ${t.peso}`}
                    className="rounded border border-[var(--color-borda)] bg-[var(--color-fundo)] px-2 py-0.5 text-xs text-[var(--color-texto-suave)]"
                  >
                    {t.termo}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-[var(--color-texto-fraco)]">
            A classificação é 100% determinística: nenhuma IA participa desta
            decisão, nem agora nem depois.
          </p>
        </CardContent>
      </Card>

      {/* Demais configurações */}
      {Object.entries(porCategoria ?? {}).map(([categoria, itens]) => (
        <Card key={categoria}>
          <CardHeader>
            <CardTitle className="capitalize">{categoria}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-[var(--color-borda)]">
              {itens.map((s) => (
                <div key={s.id} className="grid gap-1 py-2.5 sm:grid-cols-[240px_1fr]">
                  <dt className="font-mono text-xs text-[var(--color-texto-suave)]">
                    {s.chave}
                  </dt>
                  <dd>
                    <div className="font-mono text-xs">{JSON.stringify(s.valor)}</div>
                    {s.descricao && (
                      <div className="mt-0.5 text-xs text-[var(--color-texto-fraco)]">
                        {s.descricao}
                      </div>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
