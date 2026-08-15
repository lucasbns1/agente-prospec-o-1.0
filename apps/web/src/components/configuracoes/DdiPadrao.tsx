/**
 * O pais assumido quando a planilha nao traz codigo de pais.
 *
 * ============================================================
 * POR QUE ISTO PRECISA DE TELA
 * ============================================================
 * A configuracao ja existia no banco, mas nao havia como mexer nela sem
 * abrir o Postgres. Enquanto todas as listas eram brasileiras isso nao
 * incomodava — o padrao servia.
 *
 * Uma lista de Portugal muda o quadro. Sem trocar o DDI, so entram os
 * numeros que ja venham com "+351" na planilha; os que vierem como
 * "912345678" sao recusados por "telefone sem DDD". E o "+" e um
 * detalhe de formatacao da planilha, nao uma decisao de negocio.
 *
 * ============================================================
 * MUDAR AQUI NAO REESCREVE NADA
 * ============================================================
 * Vale para as PROXIMAS importacoes. Reescrever os telefones ja
 * gravados mudaria o destino de mensagens que talvez ja tenham saido —
 * e a conversa continuaria no numero antigo, que nao bateria mais com o
 * do CRM. Para mudar uma lista ja importada, reimporte.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, Globe } from 'lucide-react';
import { put, ApiError } from '@/lib/api';
import { Button, Input, Label } from '@/components/ui/primitives';

/**
 * Atalhos para os paises que voce de fato usa. A lista curta e
 * proposital: um seletor com 200 paises esconde os dois que importam.
 * O campo continua aceitando qualquer DDI digitado.
 */
const ATALHOS = [
  { ddi: '55', nome: 'Brasil' },
  { ddi: '351', nome: 'Portugal' },
] as const;

export function DdiPadrao({ atual }: { atual: string }): JSX.Element {
  const [valor, setValor] = useState(atual);
  const [aviso, setAviso] = useState<string | null>(null);
  const qc = useQueryClient();

  const salvar = useMutation({
    mutationFn: () =>
      put<{ aviso: string }>('/api/settings/ddi-padrao', { valor }),
    onSuccess: (r) => {
      setAviso(r.aviso);
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const invalido = !/^\d{1,3}$/.test(valor.trim());
  const mudou = valor.trim() !== atual;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-32">
          <Label htmlFor="ddi">DDI padrão</Label>
          <Input
            id="ddi"
            value={valor}
            inputMode="numeric"
            onChange={(e) => {
              setValor(e.target.value);
              setAviso(null);
            }}
          />
        </div>

        <div className="flex gap-2 pb-0.5">
          {ATALHOS.map((a) => (
            <Button
              key={a.ddi}
              type="button"
              variant="secundario"
              onClick={() => {
                setValor(a.ddi);
                setAviso(null);
              }}
            >
              <Globe className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {a.nome} (+{a.ddi})
            </Button>
          ))}
        </div>

        <Button
          type="button"
          disabled={invalido || !mudou || salvar.isPending}
          onClick={() => salvar.mutate()}
          className="pb-0.5"
        >
          {salvar.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          )}
          Salvar
        </Button>
      </div>

      {invalido && (
        <p className="text-sm text-[var(--color-alerta)]">
          O DDI é só o número do país, sem &quot;+&quot;. Ex: 55, 351, 1.
        </p>
      )}

      {salvar.isError && (
        <p className="text-sm text-[var(--color-erro)]">
          {salvar.error instanceof ApiError
            ? salvar.error.message
            : 'Não foi possível salvar.'}
        </p>
      )}

      {aviso && <p className="text-sm text-[var(--color-texto-suave)]">{aviso}</p>}

      <p className="text-xs text-[var(--color-texto-fraco)]">
        Usado só quando o telefone da planilha <strong>não</strong> traz o
        código do país. Números que já venham com <code>+351</code>,{' '}
        <code>00351</code> ou <code>+55</code> são respeitados como estão,
        independente deste valor.
      </p>
    </div>
  );
}
