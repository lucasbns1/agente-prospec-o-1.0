/**
 * Cliente HTTP.
 *
 * `credentials: 'include'` em todas as chamadas: e o que faz o cookie de
 * sessao viajar. Sem isso o login parece funcionar mas toda chamada
 * seguinte volta 401.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codigo: string = 'ERRO',
    readonly detalhes?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RespostaErro {
  erro?: { codigo?: string; mensagem?: string; detalhes?: unknown };
}

export async function api<T>(caminho: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(caminho, {
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    ...init,
  });

  if (!resposta.ok) {
    let corpo: RespostaErro = {};
    try {
      corpo = (await resposta.json()) as RespostaErro;
    } catch {
      // resposta sem JSON — mantem o objeto vazio
    }
    throw new ApiError(
      corpo.erro?.mensagem ?? `Erro ${resposta.status}`,
      resposta.status,
      corpo.erro?.codigo ?? 'ERRO',
      corpo.erro?.detalhes
    );
  }

  if (resposta.status === 204) return undefined as T;
  return (await resposta.json()) as T;
}

export const get = <T>(caminho: string): Promise<T> => api<T>(caminho);

export const post = <T>(caminho: string, corpo?: unknown): Promise<T> =>
  api<T>(caminho, {
    method: 'POST',
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });

export const put = <T>(caminho: string, corpo?: unknown): Promise<T> =>
  api<T>(caminho, {
    method: 'PUT',
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });

export const patch = <T>(caminho: string, corpo?: unknown): Promise<T> =>
  api<T>(caminho, {
    method: 'PATCH',
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });

/** `del` e nao `delete`: a palavra e reservada em JavaScript. */
export const del = <T>(caminho: string, corpo?: unknown): Promise<T> =>
  api<T>(caminho, {
    method: 'DELETE',
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
