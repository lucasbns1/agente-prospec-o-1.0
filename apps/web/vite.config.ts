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
    // ============================================================
    // A PORTA E A API VEM DO AMBIENTE
    // ============================================================
    // Uma segunda copia da ferramenta (Brasil num lado, Portugal no
    // outro) precisa de porta propria E de API propria. Com os dois
    // fixos, abrir outra tela em 5174 nao cria sistema nenhum: ela
    // apontaria para a MESMA API em 3333, falando com o mesmo worker e
    // o mesmo numero de WhatsApp. Duas janelas, um sistema so.
    //
    // `strictPort` existe pelo mesmo motivo: sem ele, o Vite pega a
    // proxima porta livre em silencio quando a pedida esta ocupada — e
    // voce acha que subiu a copia nova quando subiu outra tela da
    // antiga.
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    // O proxy faz o navegador enxergar API e frontend na MESMA origem.
    // Isso resolve dois problemas de uma vez: nao precisamos afrouxar o
    // CORS, e o cookie de sessao (sameSite=lax) viaja normalmente.
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 3333}`,
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
