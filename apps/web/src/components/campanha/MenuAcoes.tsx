/**
 * Menu de tres pontinhos.
 *
 * Pequeno de proposito: o projeto nao usa biblioteca de componentes, e
 * um menu suspenso e uma das poucas coisas que precisa de comportamento
 * de teclado e foco para nao virar armadilha de acessibilidade.
 *
 * O que ele garante:
 *  - fecha no Esc e no clique fora (senao fica preso na tela)
 *  - devolve o foco ao botao ao fechar (senao o teclado "se perde")
 *  - marca acao destrutiva em vermelho, e ela nunca e a primeira
 */
import { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AcaoMenu {
  rotulo: string;
  icone?: React.ComponentType<{ className?: string }>;
  aoClicar: () => void;
  /** Pinta em vermelho. Use para o que nao tem volta fácil. */
  destrutiva?: boolean;
  desabilitada?: boolean;
  /** Aparece abaixo do rótulo. Bom para explicar por que está desabilitada. */
  ajuda?: string;
}

export function MenuAcoes({
  acoes,
  rotuloAcessivel = 'Ações',
}: {
  acoes: AcaoMenu[];
  rotuloAcessivel?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aberto) return;

    const aoClicarFora = (e: MouseEvent) => {
      if (!container.current?.contains(e.target as Node)) setAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false);
        // Sem isto o foco fica no nada depois de fechar pelo teclado.
        botao.current?.focus();
      }
    };

    document.addEventListener('mousedown', aoClicarFora);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicarFora);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto]);

  return (
    <div className="relative" ref={container}>
      <button
        ref={botao}
        type="button"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={rotuloAcessivel}
        onClick={() => setAberto((v) => !v)}
        className="rounded-lg p-1.5 text-[var(--color-texto-suave)] transition-colors hover:bg-[var(--color-fundo)] hover:text-[var(--color-texto)]"
      >
        <MoreVertical className="h-4 w-4" aria-hidden="true" />
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-xl border border-[var(--color-borda)] bg-white py-1 shadow-lg"
        >
          {acoes.map((a) => {
            const Icone = a.icone;
            return (
              <button
                key={a.rotulo}
                role="menuitem"
                type="button"
                disabled={a.desabilitada}
                onClick={() => {
                  setAberto(false);
                  a.aoClicar();
                }}
                className={cn(
                  'flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                  a.desabilitada
                    ? 'cursor-not-allowed text-[var(--color-texto-fraco)]'
                    : a.destrutiva
                      ? 'text-[var(--color-alerta)] hover:bg-[var(--color-alerta-bg)]'
                      : 'text-[var(--color-texto)] hover:bg-[var(--color-fundo)]'
                )}
              >
                {Icone && <Icone className="mt-0.5 h-4 w-4 shrink-0" />}
                <span className="min-w-0">
                  {a.rotulo}
                  {a.ajuda && (
                    <span className="block text-xs text-[var(--color-texto-fraco)]">
                      {a.ajuda}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
