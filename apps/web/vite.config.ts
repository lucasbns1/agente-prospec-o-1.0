import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // O proxy faz o navegador enxergar API e frontend na MESMA origem.
    // Isso resolve dois problemas de uma vez: nao precisamos afrouxar o
    // CORS, e o cookie de sessao (sameSite=lax) viaja normalmente.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3333',
        changeOrigin: true,
        // SSE precisa de streaming: sem isso a resposta fica em buffer e
        // os eventos so chegam quando a conexao encerra.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform';
            }
          });
        },
      },
    },
  },
});
