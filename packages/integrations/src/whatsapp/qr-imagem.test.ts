/**
 * O que estes testes protegem: que o QR sai como IMAGEM.
 *
 * O defeito que motivou o arquivo era exatamente este — a string crua
 * chegando na tela, onde nao serve para nada porque ninguem escaneia
 * texto com a camera.
 */
import { describe, it, expect } from 'vitest';
import { renderizarQrComoImagem } from './qr-imagem.js';

// Formato real de um QR do WhatsApp Web: campos separados por virgula.
const QR_EXEMPLO =
  '2@abcDEF123+/ghi,jklMNO456==,pqrSTU789==,1';

describe('renderizarQrComoImagem', () => {
  it('devolve um data: URL de PNG', async () => {
    const imagem = await renderizarQrComoImagem(QR_EXEMPLO);
    expect(imagem.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('produz uma imagem com conteudo de verdade', async () => {
    const imagem = await renderizarQrComoImagem(QR_EXEMPLO);
    const base64 = imagem.slice('data:image/png;base64,'.length);

    // Um PNG de 320px com uma matriz de QR nao cabe em poucas centenas de
    // bytes. O limite baixo pega o caso de "gerou uma imagem vazia".
    expect(base64.length).toBeGreaterThan(500);

    // Assinatura de PNG: os bytes 0x89 'P' 'N' 'G' viram "iVBORw0KGgo" em
    // base64. Garante que e um PNG mesmo, e nao outra coisa rotulada.
    expect(base64.startsWith('iVBORw0KGgo')).toBe(true);
  });

  it('nao vaza o conteudo do QR em texto dentro da resposta', async () => {
    const imagem = await renderizarQrComoImagem(QR_EXEMPLO);
    // A credencial fica codificada nos pixels, nunca legivel na string.
    expect(imagem).not.toContain(QR_EXEMPLO);
    expect(imagem).not.toContain('2@abcDEF123');
  });

  it('QRs diferentes produzem imagens diferentes', async () => {
    const [a, b] = await Promise.all([
      renderizarQrComoImagem(QR_EXEMPLO),
      renderizarQrComoImagem('2@zzzYYY999+/xxx,wwwVVV888==,1'),
    ]);
    expect(a).not.toBe(b);
  });

  it('e deterministico: o mesmo QR gera a mesma imagem', async () => {
    // Importa porque a tela refaz a busca a cada 10s enquanto o QR esta
    // aberto: se a imagem mudasse a cada chamada, ela piscaria sem motivo.
    const [a, b] = await Promise.all([
      renderizarQrComoImagem(QR_EXEMPLO),
      renderizarQrComoImagem(QR_EXEMPLO),
    ]);
    expect(a).toBe(b);
  });
});
