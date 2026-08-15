import { Input, Label } from '@/components/ui/primitives';
import { paraMinutos, paraSegundos, descrever } from './duracao';

/**
 * Campo de duracao em MINUTOS, guardado em SEGUNDOS.
 *
 * ============================================================
 * POR QUE NAO E SO TROCAR O ROTULO
 * ============================================================
 * O banco guarda segundos, e vai continuar guardando: o agendamento, os
 * testes e o despachante todos falam em segundos, e converter no fundo
 * significaria mexer em tudo isso para ganhar nada.
 *
 * O que muda e a UNIDADE QUE VOCE DIGITA. Ninguem pensa "quero 180
 * segundos entre as mensagens" — pensa "quero 3 minutos". Digitar 180
 * quando se quer 3 e um convite a errar por um fator de 60, e errar
 * para MENOS aqui significa disparar rapido demais.
 *
 * ============================================================
 * O PROBLEMA DA CONVERSAO E O ARREDONDAMENTO
 * ============================================================
 * 90 segundos sao 1,5 minutos. Se o campo so aceitasse inteiros, abrir
 * a tela e salvar sem tocar em nada transformaria 90 em 60 ou em 120 —
 * uma configuracao mudada sem ninguem pedir.
 *
 * Por isso o passo e 0,5 e a conversao preserva o valor: enquanto voce
 * nao editar o campo, o que estava gravado continua gravado.
 */
export function CampoDuracao({
  id,
  rotulo,
  segundos,
  onChange,
  ajuda,
}: {
  id: string;
  rotulo: string;
  segundos: number;
  onChange: (segundos: number) => void;
  ajuda?: string;
}): JSX.Element {
  const minutos = paraMinutos(segundos);

  return (
    <div>
      <Label htmlFor={id}>{rotulo}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          min={0}
          step={0.5}
          value={Number.isInteger(minutos) ? minutos : minutos.toFixed(1)}
          onChange={(e) => onChange(paraSegundos(Number(e.target.value)))}
        />
        <span className="shrink-0 text-sm text-[var(--color-texto-suave)]">
          min
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--color-texto-suave)]">
        {ajuda ?? descrever(segundos)}
      </p>
    </div>
  );
}
