/**
 * Desenha o QR Code como imagem.
 *
 * ============================================================
 * POR QUE ISTO EXISTE
 * ============================================================
 * O que o `whatsapp-web.js` entrega no evento `qr` e uma STRING —
 * o conteudo que precisa ser codificado, nao a figura. Mostrar essa
 * string na tela nao serve para nada: ninguem escaneia texto com a
 * camera. Ela precisa virar a matriz de quadradinhos.
 *
 * Fica aqui, e nao na API, porque `qrcode` ja e dependencia deste
 * pacote. Colocar na API criaria uma dependencia repetida so para
 * desenhar a mesma coisa.
 *
 * ============================================================
 * O RESULTADO E UMA CREDENCIAL
 * ============================================================
 * A imagem carrega exatamente a mesma informacao da string: quem a
 * enxergar dentro da validade (~60s) conecta na conta. Ela NAO pode
 * ir para log, disco ou qualquer lugar que sobreviva a tela.
 */
import QRCode from 'qrcode';

/** Lado da imagem, em pixels. Suficiente para escanear na tela. */
const LARGURA_PX = 320;

/**
 * Converte o conteudo do QR numa imagem PNG embutida (`data:` URL).
 *
 * Devolve `data:image/png;base64,...`, pronto para o `src` de um `<img>`.
 * Assim a imagem nunca vira arquivo: ela existe apenas no corpo da
 * resposta e na memoria do navegador, e some quando a aba fecha.
 */
export async function renderizarQrComoImagem(qr: string): Promise<string> {
  return QRCode.toDataURL(qr, {
    width: LARGURA_PX,
    // Margem minima. O padrao da especificacao e 4 modulos; 2 basta para
    // a camera isolar o codigo e evita desperdicar area util da tela.
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      // Preto no branco, sempre — inclusive no tema escuro. Inverter as
      // cores quebra o reconhecimento em boa parte dos leitores.
      dark: '#000000',
      light: '#ffffff',
    },
  });
}
