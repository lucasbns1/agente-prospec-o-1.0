import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Padrao shadcn/ui: junta classes e resolve conflitos do Tailwind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatarNumero(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n);
}

export function formatarDataHora(iso: string | Date | null): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
