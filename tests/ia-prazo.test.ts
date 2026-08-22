/**
 * O prazo da chamada ao Gemini — e o erro que chega depois dele.
 *
 * ============================================================
 * O QUE ISTO PROTEGE
 * ============================================================
 * Relatado em uso real, na notificação:
 *
 *   "A IA nao respondeu (Tempo esgotado (30000ms)) e a proxima acao
 *    seria SEND_STEP. A cadencia parou para voce decidir."
 *
 * A cadência parar está certo — é o fallback recusando-se a mandar
 * mensagem sozinho. O problema era a mensagem: ela descreve o sintoma e
 * esconde a causa.
 *
 * Quando o prazo vence, a chamada NÃO para. Ela continua e, quase
 * sempre, falha segundos depois com o motivo de verdade — limite da API,
 * rede fora, modelo indisponível. Essa rejeição tardia ia para o vazio, e
 * quem olhava a notificação não tinha como saber se o problema era a
 * cota, a internet ou um modelo lento.
 *
 * Nada aqui toca a rede: `comPrazo` recebe uma promessa qualquer, e é
 * isso que torna o comportamento testável de verdade.
 */
import { describe, expect, it } from 'vitest';
import { comPrazo } from '../packages/integrations/src/ai/gemini.js';

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('comPrazo', () => {
  it('devolve o valor quando a promessa responde a tempo', async () => {
    await expect(comPrazo(Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  it('propaga a falha imediata sem esperar o prazo', async () => {
    // Uma recusa da API que chega rápido tem que aparecer como ela é, e
    // não virar "tempo esgotado".
    await expect(
      comPrazo(Promise.reject(new Error('API key not valid')), 5_000)
    ).rejects.toThrow('API key not valid');
  });

  it('desiste no prazo quando a promessa demora', async () => {
    const lenta = espera(1_000).then(() => 'tarde demais');
    await expect(comPrazo(lenta, 30)).rejects.toThrow(/Tempo esgotado \(30ms\)/);
  });

  it('ENTREGA o erro que chega depois do prazo', async () => {
    // O caso do relato. A decisão já foi tomada com "tempo esgotado"; o
    // motivo real chega em seguida e não pode se perder.
    const tardios: unknown[] = [];
    const lenta = espera(40).then(() => {
      throw new Error('429 RESOURCE_EXHAUSTED: quota excedida');
    });

    await expect(
      comPrazo(lenta, 10, (err) => tardios.push(err))
    ).rejects.toThrow(/Tempo esgotado/);

    // Ainda não chegou: a decisão sai na hora, sem esperar por isto.
    expect(tardios).toHaveLength(0);

    await espera(80);

    expect(tardios).toHaveLength(1);
    expect(String(tardios[0])).toContain('RESOURCE_EXHAUSTED');
  });

  it('não chama o aviso quando a promessa venceu a corrida', async () => {
    // Se a resposta chegou a tempo, não há erro tardio nenhum — chamar o
    // aviso aqui encheria o log de ruído.
    const tardios: unknown[] = [];
    await comPrazo(Promise.resolve('ok'), 5_000, (e) => tardios.push(e));

    await espera(30);
    expect(tardios).toHaveLength(0);
  });

  it('uma falha rápida também não vira aviso tardio', async () => {
    const tardios: unknown[] = [];
    await expect(
      comPrazo(Promise.reject(new Error('recusada')), 5_000, (e) => tardios.push(e))
    ).rejects.toThrow('recusada');

    await espera(30);
    expect(tardios).toHaveLength(0);
  });
});
