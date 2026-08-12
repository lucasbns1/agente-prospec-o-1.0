import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // O SSE avisa quando algo muda, entao nao precisamos de polling
      // nem de refetch a cada foco de janela.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: (falhas, erro) => {
        // 401 significa "nao logado" — repetir nao resolve.
        if (erro instanceof Error && 'status' in erro && erro.status === 401) {
          return false;
        }
        return falhas < 2;
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
