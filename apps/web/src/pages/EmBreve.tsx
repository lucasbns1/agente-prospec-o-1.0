/**
 * Placeholder das telas que chegam nas proximas fases.
 *
 * Existe de proposito em vez de esconder o item do menu: a navegacao
 * inteira ja fica visivel e testavel, e cada tela diz em qual fase entra.
 */
import { Construction } from 'lucide-react';
import { Card } from '@/components/ui/primitives';

export function EmBreve({
  titulo,
  fase,
  descricao,
}: {
  titulo: string;
  fase: string;
  descricao: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>
        <p className="mt-0.5 text-sm text-[var(--color-texto-suave)]">{descricao}</p>
      </div>

      <Card>
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <Construction
            className="h-8 w-8 text-[var(--color-texto-fraco)]"
            aria-hidden="true"
          />
          <p className="text-sm font-medium">Esta tela entra na {fase}</p>
          <p className="max-w-md text-xs text-[var(--color-texto-fraco)]">
            A Fase 1 entrega a fundação: monorepo, banco, API, worker, filas,
            autenticação e tempo real. As telas de negócio vêm em seguida.
          </p>
        </div>
      </Card>
    </div>
  );
}
