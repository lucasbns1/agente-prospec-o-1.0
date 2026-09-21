/**
 * Um worker de cada vez.
 *
 * ============================================================
 * O QUE ISTO IMPEDE
 * ============================================================
 * Dois workers na mesma pasta de sessao conectam com a mesma
 * credencial. O WhatsApp derruba um, o derrubado reconecta e derruba o
 * outro. Na tela: `401 Connection Failure`, repetido, ate parar em
 * "Falhou" — e nada no erro diz que ha outro worker.
 */
import { describe, expect, it } from 'vitest';
import {
  assumirSessao,
  chaveDaTrava,
  renovarSessao,
  soltarSessao,
  type RedisDaTrava,
} from '../apps/worker/src/services/dono-da-sessao.js';

/** Redis de mentira com a semantica que importa: NX e prazo. */
function redisFalso(): RedisDaTrava & { dados: Map<string, string> } {
  const dados = new Map<string, string>();
  return {
    dados,
    async set(chave, valor, _modo, _segundos, _condicao) {
      if (dados.has(chave)) return null; // NX: nao sobrescreve
      dados.set(chave, valor);
      return 'OK';
    },
    async get(chave) {
      return dados.get(chave) ?? null;
    },
    async expire(chave) {
      return dados.has(chave) ? 1 : 0;
    },
    async del(chave) {
      return dados.delete(chave) ? 1 : 0;
    },
  };
}

describe('assumirSessao', () => {
  it('o primeiro worker assume', async () => {
    const redis = redisFalso();
    expect(await assumirSessao(redis, './data/whatsapp', 'worker-a')).toEqual({
      assumiu: true,
    });
  });

  /**
   * ESTE e o teste do defeito. Sem ele, o segundo worker sobe, conecta
   * na mesma credencial, e os dois passam a se derrubar.
   */
  it('o segundo worker NAO assume, e sabe de quem e a vez', async () => {
    const redis = redisFalso();
    await assumirSessao(redis, './data/whatsapp', 'worker-a');

    const r = await assumirSessao(redis, './data/whatsapp', 'worker-b');

    expect(r.assumiu).toBe(false);
    expect(r.dono).toBe('worker-a');
  });

  /**
   * A trava e por SESSAO. Os dois numeros tem pastas diferentes, entao
   * trocar de numero nao pode esbarrar na trava do outro.
   */
  it('sessoes diferentes nao disputam entre si', async () => {
    const redis = redisFalso();
    await assumirSessao(redis, './data/whatsapp', 'worker-a');

    const outro = await assumirSessao(redis, './data/whatsapp-numero-2', 'worker-a');

    expect(outro.assumiu).toBe(true);
    expect(chaveDaTrava('./data/whatsapp')).not.toBe(
      chaveDaTrava('./data/whatsapp-numero-2')
    );
  });

  /**
   * Reinicio rapido: o mesmo worker volta antes de a chave anterior
   * vencer. Nao e disputa, e recusar aqui deixaria a ferramenta parada
   * por um minuto a cada `Ctrl+C` seguido de `pnpm dev`.
   */
  it('o mesmo worker reassume a propria trava', async () => {
    const redis = redisFalso();
    await assumirSessao(redis, './data/whatsapp', 'worker-a');

    expect(await assumirSessao(redis, './data/whatsapp', 'worker-a')).toEqual({
      assumiu: true,
    });
  });
});

describe('renovarSessao', () => {
  it('renova enquanto a trava for nossa', async () => {
    const redis = redisFalso();
    await assumirSessao(redis, './data/whatsapp', 'worker-a');

    expect(await renovarSessao(redis, './data/whatsapp', 'worker-a')).toBe(true);
  });

  it('nao renova a trava de outro', async () => {
    const redis = redisFalso();
    await assumirSessao(redis, './data/whatsapp', 'worker-a');

    expect(await renovarSessao(redis, './data/whatsapp', 'worker-b')).toBe(false);
  });
});

describe('soltarSessao', () => {
  it('solta a propria trava no encerramento', async () => {
    const redis = redisFalso();
    await assumirSessao(redis, './data/whatsapp', 'worker-a');

    expect(await soltarSessao(redis, './data/whatsapp', 'worker-a')).toBe(true);
    expect(redis.dados.size).toBe(0);
  });

  /**
   * Um worker lento encerrando NAO pode apagar a chave de quem ja
   * assumiu — a briga recomecaria, com a diferenca de ninguem estar
   * olhando.
   */
  it('nao apaga a trava de outro worker ao encerrar', async () => {
    const redis = redisFalso();
    await assumirSessao(redis, './data/whatsapp', 'worker-novo');

    expect(await soltarSessao(redis, './data/whatsapp', 'worker-velho')).toBe(false);
    expect(redis.dados.get(chaveDaTrava('./data/whatsapp'))).toBe('worker-novo');
  });
});
