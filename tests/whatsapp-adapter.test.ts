/**
 * Testes do adapter em modo dry-run.
 *
 * O que estes testes realmente protegem: a garantia de que o sistema NAO
 * envia mensagem real por acidente. Um typo no .env nao pode virar 76
 * mensagens disparadas.
 */
import { describe, expect, it, vi } from 'vitest';
import { FakeWhatsAppAdapter } from '../packages/integrations/src/whatsapp/fake-adapter.js';
import {
  resolverModo,
  criarWhatsAppAdapter,
} from '../packages/integrations/src/whatsapp/factory.js';
import {
  telefoneParaChatId,
  chatIdParaTelefone,
} from '../packages/integrations/src/whatsapp/adapter.js';

describe('resolverModo — padrao seguro', () => {
  it('reconhece "live"', () => {
    expect(resolverModo('live')).toBe('live');
    expect(resolverModo('LIVE')).toBe('live');
    expect(resolverModo('  live  ')).toBe('live');
  });

  it('cai em dry-run para qualquer outro valor', () => {
    for (const v of ['dry-run', 'liv', 'true', '1', 'producao', '', undefined]) {
      expect(resolverModo(v)).toBe('dry-run');
    }
  });
});

describe('FakeWhatsAppAdapter', () => {
  it('nunca reporta envio real: sempre simulado, sem id do WhatsApp', async () => {
    const adapter = new FakeWhatsAppAdapter({ logger: () => {} });
    const r = await adapter.sendMessage('5519999998888', 'Boa tarde!');

    expect(r.sucesso).toBe(true);
    expect(r.simulado).toBe(true);
    expect(r.whatsappMessageId).toBeNull();
  });

  it('loga a simulacao com o telefone de destino', async () => {
    const logger = vi.fn();
    const adapter = new FakeWhatsAppAdapter({ logger });
    await adapter.sendMessage('5519999998888', 'Oi');

    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('SIMULACAO'),
      expect.objectContaining({ telefone: '5519999998888' })
    );
  });

  it('registra tudo que "seria enviado" para conferencia', async () => {
    const adapter = new FakeWhatsAppAdapter({ logger: () => {} });
    await adapter.sendMessage('551100000001', 'msg 1');
    await adapter.sendMessage('551100000002', 'msg 2');

    expect(adapter.enviadas).toHaveLength(2);
    expect(adapter.enviadas[0]?.telefone).toBe('551100000001');
    expect(adapter.enviadas[1]?.texto).toBe('msg 2');
  });

  it('conecta e desconecta emitindo os eventos certos', async () => {
    const adapter = new FakeWhatsAppAdapter({ logger: () => {} });
    const onReady = vi.fn();
    const onDisconnected = vi.fn();
    adapter.onReady(onReady);
    adapter.onDisconnected(onDisconnected);

    expect(adapter.getStatus().status).toBe('DESCONECTADO');

    await adapter.connect();
    expect(adapter.getStatus().status).toBe('CONECTADO');
    expect(onReady).toHaveBeenCalledOnce();

    await adapter.disconnect();
    expect(adapter.getStatus().status).toBe('DESCONECTADO');
    expect(onDisconnected).toHaveBeenCalledOnce();
  });

  it('permite simular uma resposta recebida, sem telefone envolvido', async () => {
    const adapter = new FakeWhatsAppAdapter({ logger: () => {} });
    const recebidas: string[] = [];
    adapter.onMessage((m) => {
      recebidas.push(m.texto);
    });

    await adapter.simularRespostaRecebida('5519999998888', 'pode mandar');

    expect(recebidas).toEqual(['pode mandar']);
  });
});

describe('criarWhatsAppAdapter', () => {
  it('devolve o adapter fake em dry-run', async () => {
    const adapter = await criarWhatsAppAdapter({ modo: 'dry-run' });
    expect(adapter.modo).toBe('dry-run');
  });

  /**
   * COMPORTAMENTO MUDOU NA FASE 6A.
   *
   * Antes, `modo: 'live'` derrubava a criacao do adapter — a unica
   * protecao disponivel era recusar a construcao. Agora existe a guarda
   * de fase, que bloqueia o ENVIO em vez do adapter, e isso e melhor:
   * permite conectar de verdade e RECEBER mensagens sem destravar o
   * envio junto, que e exatamente o que a Fase 6A precisa.
   *
   * O invariante que importa continua o mesmo, e esta testado em
   * `canal-adapter.test.ts`: com a fase travada, nada sai.
   */
  it('modo live nao derruba mais a criacao — quem bloqueia e a guarda', async () => {
    const adapter = await criarWhatsAppAdapter({ modo: 'live', canal: 'simulado' });

    // O adapter simulado se declara dry-run independentemente do modo
    // pedido: ele nao tem como enviar nada, e dizer 'live' seria mentir.
    expect(adapter.modo).toBe('dry-run');

    const r = await adapter.sendMessage('5519999998888', 'oi');
    expect(r.simulado).toBe(true);
  });

  it('canal simulado e o padrao — nao conecta em lugar nenhum', async () => {
    const adapter = await criarWhatsAppAdapter({});
    expect(adapter.getStatus().status).toBe('DESCONECTADO');
  });
});

describe('conversao de telefone e chatId', () => {
  it('telefone -> chatId', () => {
    expect(telefoneParaChatId('5519999998888')).toBe('5519999998888@c.us');
    expect(telefoneParaChatId('+55 (19) 99999-8888')).toBe('5519999998888@c.us');
  });

  it('chatId -> telefone', () => {
    expect(chatIdParaTelefone('5519999998888@c.us')).toBe('5519999998888');
  });
});
