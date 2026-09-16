/**
 * Qual numero de WhatsApp o worker deve conectar — e a troca em si.
 *
 * ============================================================
 * A ESCOLHA MORA NO BANCO
 * ============================================================
 * Ela e feita por um botao na tela e precisa sobreviver a reinicio sem
 * ninguem editar arquivo nenhum. Por isso `settings`, e nao variavel de
 * ambiente.
 *
 * ============================================================
 * QUEM TROCA E O WORKER, SEMPRE
 * ============================================================
 * A API nao abre conexao com o WhatsApp: se abrisse, seriam duas
 * sessoes disputando a mesma conta e o WhatsApp derrubaria as duas. Ela
 * grava a escolha e PUBLICA um pedido; quem executa e este arquivo, no
 * processo que de fato segura a sessao.
 */
import { prisma } from '@prospector/database';
import {
  CHAVE_SETTING_NUMERO_ATIVO,
  CHAVE_SETTING_TELEFONES,
  numeroAtivoDeSetting,
  type NumeroWhatsApp,
} from '@prospector/shared';

export async function lerNumeroAtivo(): Promise<NumeroWhatsApp> {
  try {
    const s = await prisma.setting.findUnique({
      where: { chave: CHAVE_SETTING_NUMERO_ATIVO },
    });
    return numeroAtivoDeSetting(s?.valor);
  } catch {
    // Banco indisponivel na subida nao pode virar "conecta no numero 2".
    // O padrao e o numero que ja estava em uso.
    return '1';
  }
}

/**
 * Grava o telefone que o numero mostrou ao autenticar.
 *
 * E isto que rotula os botoes da tela. O telefone NAO e digitado por
 * ninguem de proposito: um rotulo escrito a mao continuaria dizendo o
 * numero certo se o QR fosse lido com o celular errado, e voce so
 * descobriria pela conversa do cliente.
 *
 * Falhar aqui nao pode derrubar a conexao — e um rotulo.
 */
export async function gravarTelefoneDoNumero(
  numero: NumeroWhatsApp,
  telefone: string | null
): Promise<void> {
  if (!telefone) return;

  try {
    const atual = await prisma.setting.findUnique({
      where: { chave: CHAVE_SETTING_TELEFONES },
    });

    const mapa: Record<string, string> =
      atual?.valor && typeof atual.valor === 'object' && !Array.isArray(atual.valor)
        ? Object.fromEntries(
            Object.entries(atual.valor as Record<string, unknown>).filter(
              (par): par is [string, string] => typeof par[1] === 'string'
            )
          )
        : {};

    if (mapa[numero] === telefone) return;
    mapa[numero] = telefone;

    await prisma.setting.upsert({
      where: { chave: CHAVE_SETTING_TELEFONES },
      create: {
        chave: CHAVE_SETTING_TELEFONES,
        valor: mapa,
        categoria: 'whatsapp',
        sistema: true,
        descricao: 'Telefone que cada número mostrou ao autenticar',
      },
      update: { valor: mapa },
    });
  } catch {
    // Silencioso: o rotulo da tela nao vale uma conexao.
  }
}
