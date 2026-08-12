import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';

export interface Usuario {
  id: string;
  email: string;
  nome: string;
}

export function useUsuario() {
  return useQuery({
    queryKey: ['usuario'],
    queryFn: () => get<{ usuario: Usuario }>('/api/auth/me'),
    // 401 e uma resposta esperada (nao logado), nao um erro de rede:
    // repetir a chamada so atrasaria o redirecionamento para o login.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dados: { email: string; senha: string }) =>
      post<{ usuario: Usuario }>('/api/auth/login', dados),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ ok: boolean }>('/api/auth/logout'),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
