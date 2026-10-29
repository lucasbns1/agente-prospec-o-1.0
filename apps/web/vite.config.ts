import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // ============================================================
  // O VITE NAO LE O .env PARA A PROPRIA CONFIGURACAO
  // ============================================================
  // Ele carrega o `.env` para o CODIGO do navegador, e so as chaves com
  // prefixo `VITE_`. O arquivo de configuracao roda antes disso, com
  // `process.env` cru — entao `WEB_PORT=5174` no .env simplesmente nao
  // existia aqui.
  //
  // O efeito era o pior possivel numa copia separada: a API subia na
  // porta certa (3334) e a TELA subia na 5173, a mesma da copia
  // original. Duas telas na mesma porta — uma recusando subir, ou pior,
  // a pessoa achando que esta olhando a copia nova.
  //
  // `loadEnv` com prefixo vazio le o arquivo inteiro. A raiz e dois
  // niveis acima porque o .env mora na raiz do monorepo, e nao aqui.
  // `process.env` por ultimo, para variavel de terminal continuar
  // vencendo o arquivo — a mesma regra do resto do sistema.
  const env = {
    ...loadEnv(mode, path.resolve(__dirname, '../..'), ''),
    ...process.env,
  };

  return {
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
    port: Number(env.WEB_PORT ?? 5173),
    strictPort: true,
    // O proxy faz o navegador enxergar API e frontend na MESMA origem.
    // Isso resolve dois problemas de uma vez: nao precisamos afrouxar o
    // CORS, e o cookie de sessao (sameSite=lax) viaja normalmente.
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${env.API_PORT ?? 3333}`,
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
  };
});
