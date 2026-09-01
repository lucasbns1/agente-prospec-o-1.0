/**
 * A paciencia do arranque do WhatsApp.
 *
 * ============================================================
 * O DEFEITO QUE ESTES TESTES TRANCAM
 * ============================================================
 * O evento `ready` significa "a sessao autenticou", nao "a pagina
 * terminou de carregar". Chamar `getChats()` cedo demais estoura dentro
 * do Chromium com um erro opaco — literalmente `message: "r"`, porque o
 * codigo da pagina esta minificado.
 *
 * O orcamento original era 3 tentativas com 2s, 4s e 8s. Numa maquina
 * real, com uma conta cheia de conversas, a varredura da conexao falhou
 * DUAS vezes seguidas — sempre nesse ponto, sempre com o mesmo "r". O
 * sistema so se acertava cinco minutos depois, na periodica.
 *
 * ============================================================
 * O QUE ESTA EM JOGO ALEM DA VARREDURA
 * ============================================================
 * `confirmarEnvio` passa pela MESMA chamada. Uma falha dela no momento
 * do envio faz o sistema concluir "nao achei a mensagem" e marcar FALHOU
 * um envio que deu certo — exatamente o defeito que a confirmacao existe
 * para evitar. Por isso o orcamento e generoso: aqui, esperar demais nao
 * custa nada, e esperar de menos custa a verdade.
 *
 * Sem relogio de verdade: os temporizadores sao falsos, entao a suite
 * nao gasta dois minutos provando que ela sabe esperar dois minutos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getChatsComTentativas,
  ESPERA_MAXIMA_MS,
} from './provedor-whatsapp-web.js';

const silencio = (): void => {};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Um cliente que falha `falhas` vezes e depois entrega as conversas. */
function clienteQueFalha(falhas: number, conversas: unknown[] = []) {
  let chamadas = 0;
  return {
    chamadas: () => chamadas,
    getChats: async () => {
      chamadas += 1;
      if (chamadas <= falhas) {
        // O erro real do Chromium: uma letra, porque a pagina esta
        // minificada. Reproduzido aqui para o teste falar a lingua do
        // log que a pessoa vai ver.
        throw new Error('r');
      }
      return conversas;
    },
  };
}

describe('getChatsComTentativas', () => {
  it('devolve na primeira, sem esperar nada, quando a pagina ja esta pronta', async () => {
    const cliente = clienteQueFalha(0, [{ id: 'chat-1' }]);

    const chats = await getChatsComTentativas(cliente, silencio);

    expect(chats).toHaveLength(1);
    expect(cliente.chamadas()).toBe(1);
  });

  it('aguenta as tres falhas que derrubavam a versao anterior', async () => {
    const cliente = clienteQueFalha(3, [{ id: 'chat-1' }]);

    const promessa = getChatsComTentativas(cliente, silencio);
    await vi.runAllTimersAsync();

    // O caso exato do relato: falhou em 2s, 4s e 8s e o orcamento
    // acabou. Agora a quarta tentativa acontece.
    await expect(promessa).resolves.toHaveLength(1);
    expect(cliente.chamadas()).toBe(4);
  });

  it('tenta seis vezes antes de desistir', async () => {
    const cliente = clienteQueFalha(99);

    const promessa = getChatsComTentativas(cliente, silencio);
    // `catch` armado ANTES de avancar o relogio: sem isto a rejeicao
    // vira "unhandled" e derruba a suite.
    const resultado = promessa.catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    expect(await resultado).toBeInstanceOf(Error);
    expect(cliente.chamadas()).toBe(6);
  });

  it('propaga o erro de verdade, e nao um erro inventado', async () => {
    const cliente = clienteQueFalha(99);

    const promessa = getChatsComTentativas(cliente, silencio);
    const resultado = promessa.catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    // Quem le o log precisa ver o "r" do Chromium. Trocar por uma
    // mensagem propria esconderia a unica pista que existe.
    expect((await resultado as Error).message).toBe('r');
  });

  it('as esperas crescem, mas param de crescer no teto', async () => {
    const cliente = clienteQueFalha(99);
    const esperas: number[] = [];

    const promessa = getChatsComTentativas(
      cliente,
      (_m, dados) => {
        if (dados) esperas.push(dados.proximaEmMs as number);
      }
    );
    const resultado = promessa.catch(() => null);
    await vi.runAllTimersAsync();
    await resultado;

    // 5s, 10s, 20s, 30s, 30s — e 0 na ultima, que nao espera por nada.
    expect(esperas).toEqual([5000, 10_000, 20_000, ESPERA_MAXIMA_MS, ESPERA_MAXIMA_MS, 0]);

    // Dobrar sem teto chegaria a esperas de minutos entre tentativas sem
    // ganhar nada: a pagina do WhatsApp carrega em segundos, ou nao
    // carrega.
    expect(Math.max(...esperas)).toBe(ESPERA_MAXIMA_MS);
  });

  it('o orcamento total passa de um minuto e meio', async () => {
    const cliente = clienteQueFalha(99);
    const esperas: number[] = [];

    const promessa = getChatsComTentativas(cliente, (_m, dados) => {
      if (dados) esperas.push(dados.proximaEmMs as number);
    });
    const resultado = promessa.catch(() => null);
    await vi.runAllTimersAsync();
    await resultado;

    // O numero exato importa menos que a ordem de grandeza: os 14
    // segundos da versao anterior nao bastaram numa maquina real.
    const total = esperas.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(90_000);
  });
});
