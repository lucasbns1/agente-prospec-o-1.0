import { useForm } from 'react-hook-form';
import { Radar } from 'lucide-react';
import { Button, Card, Input, Label } from '@/components/ui/primitives';
import { useLogin } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';

interface FormLogin {
  email: string;
  senha: string;
}

export function Login() {
  const login = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormLogin>();

  const mensagemErro =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? 'Não foi possível entrar. A API está rodando?'
        : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-fundo)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-marca)]">
            <Radar className="h-4.5 w-4.5 text-white" aria-hidden="true" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Prospector</span>
        </div>

        <Card className="p-6">
          <h1 className="text-base font-semibold">Entrar</h1>
          <p className="mt-0.5 mb-5 text-sm text-[var(--color-texto-suave)]">
            Acesso local ao seu sistema de prospecção.
          </p>

          <form
            onSubmit={handleSubmit((dados) => login.mutate(dados))}
            className="space-y-4"
            noValidate
          >
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'erro-email' : undefined}
                {...register('email', { required: 'Informe o e-mail' })}
              />
              {errors.email && (
                <p id="erro-email" role="alert" className="mt-1 text-xs text-[var(--color-alerta)]">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors.senha}
                aria-describedby={errors.senha ? 'erro-senha' : undefined}
                {...register('senha', { required: 'Informe a senha' })}
              />
              {errors.senha && (
                <p id="erro-senha" role="alert" className="mt-1 text-xs text-[var(--color-alerta)]">
                  {errors.senha.message}
                </p>
              )}
            </div>

            {mensagemErro && (
              <div
                role="alert"
                className="rounded-lg border border-[var(--color-alerta)] bg-[var(--color-alerta-bg)] px-3 py-2 text-sm text-[var(--color-alerta)]"
              >
                {mensagemErro}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-xs text-[var(--color-texto-fraco)]">
          Sistema local. Usuário criado por <code>pnpm db:seed</code>.
        </p>
      </div>
    </div>
  );
}
