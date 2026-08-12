/**
 * Primitivos de UI no padrao shadcn/ui.
 *
 * Escritos a mao em vez de gerados pelo CLI do shadcn: o CLI baixa
 * componentes de rede e escreve um registro proprio, e para a Fase 1
 * precisamos apenas de cinco primitivos. A convencao e identica (cva +
 * cn + Slot), entao rodar `npx shadcn@latest add <componente>` mais tarde
 * encaixa sem atrito.
 */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------- Button
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--color-marca)] text-white hover:bg-[var(--color-marca-clara)]',
        secundario:
          'bg-white text-[var(--color-texto)] border border-[var(--color-borda-forte)] hover:bg-[var(--color-fundo)]',
        fantasma:
          'text-[var(--color-texto-suave)] hover:bg-[var(--color-fundo)] hover:text-[var(--color-texto)]',
        perigo: 'bg-[var(--color-alerta)] text-white hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4',
        lg: 'h-11 px-6',
        icone: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

// ------------------------------------------------------------------ Card
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--color-borda)] bg-[var(--color-superficie)] shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pt-5 pb-3', className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'text-sm font-semibold tracking-tight text-[var(--color-texto)]',
        className
      )}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}

// ----------------------------------------------------------------- Badge
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        neutro: 'bg-[var(--color-fundo)] text-[var(--color-texto-suave)] border border-[var(--color-borda)]',
        frio: 'bg-[var(--color-frio-bg)] text-[var(--color-frio)]',
        morno: 'bg-[var(--color-morno-bg)] text-[var(--color-morno)]',
        quente: 'bg-[var(--color-quente-bg)] text-[var(--color-quente)]',
        sucesso: 'bg-[var(--color-sucesso-bg)] text-[var(--color-sucesso)]',
        alerta: 'bg-[var(--color-alerta-bg)] text-[var(--color-alerta)]',
        info: 'bg-[var(--color-info-bg)] text-[var(--color-info)]',
      },
    },
    defaultVariants: { variant: 'neutro' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Mapeia a temperatura do lead para a variante visual correspondente. */
export function variantePorTemperatura(
  t: string
): 'frio' | 'morno' | 'quente' | 'neutro' {
  if (t === 'FRIO') return 'frio';
  if (t === 'MORNO') return 'morno';
  if (t === 'QUENTE') return 'quente';
  return 'neutro';
}

// ----------------------------------------------------------------- Input
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-10 w-full rounded-lg border border-[var(--color-borda-forte)] bg-white px-3 text-sm',
      'placeholder:text-[var(--color-texto-fraco)]',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  />
));
Input.displayName = 'Input';

// ----------------------------------------------------------------- Label
export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        'block text-sm font-medium text-[var(--color-texto)] mb-1.5',
        className
      )}
      {...props}
    />
  );
}
