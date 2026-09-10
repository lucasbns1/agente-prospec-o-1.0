/**
 * Testes do adapter simulado.
 *
 * O que estes testes realmente protegem: a garantia de que o canal
 * simulado NUNCA envia mensagem real, por caminho nenhum. Ele e o que
 * roda em desenvolvimento e em teste, e uma unica mensagem escapando
 * dali chegaria num telefone de verdade.
 */
import { describe, expect, it, vi } from 'vitest';
import { FakeWhatsAppAdapter } from '../packages/integrations/src/whatsapp/fake-adapter.js';
import { criarWhatsAppAdapter } from '../packages/integrations/src/whatsapp/factory.js';
import { WhatsAppWebAdapter } from '../packages/integrations/src/whatsapp/whatsapp-web-adapter.js';
import {
  telefoneParaChatId,
  chatIdParaTelefone,
} from '../packages/integrations/src/whatsapp/adapter.js';

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
  /**
   * O EIXO "MODO" SAIU DA FACTORY.
   *
   * A factory tinha duas chaves: `WHATSAPP_CANAL` decidia se conectava,
   * `WHATSAPP_MODE` decidia se enviava. A segunda foi removida do
   * sistema — travava tudo por variavel de ambiente sem aparecer na
   * interface. Sobrou o canal.
   *
   * O invariante que importa continua o mesmo e esta em
   * `canal-adapter.test.ts`: com a fase travada, nada sai.
   */
  it('o canal simulado nunca envia de verdade', async () => {
    const adapter = await criarWhatsAppAdapter({ canal: 'simulado' });

    const r = await adapter.sendMessage('5519999998888', 'oi');
    expect(r.simulado).toBe(true);
    expect(r.whatsappMessageId).toBeNull();
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

// =============================================================================
// A TELA DE DIAGNÓSTICO NÃO PODE MENTIR O PROVEDOR
// =============================================================================

/**
 * O caso real: a sessão do Baileys caiu, e a tela de configuração do
 * canal mostrou "Provedor: whatsapp-web".
 *
 * O fallback era o literal `'whatsapp-web'` — sem conexão não há
 * `getInfo()`, e o rótulo cravado assumia. Numa tela de DIAGNÓSTICO,
 * onde a pessoa vai justamente quando algo quebrou, um rótulo errado
 * manda quem depura para o lado errado. Foi o que aconteceu: fui olhar
 * o `.env` atrás de um canal mal configurado que não existia.
 */
describe('saude() — qual provedor a tela mostra', () => {
  // Desconectado de propósito: é quando `getInfo()` devolve null e o
  // fallback passa a decidir sozinho.
  const provedorMudo = {
    getInfo: () => null,
    on: () => {},
    inicializar: async () => {},
    destroy: async () => {},
    enviar: async () => ({ id: 'x' }),
    numeroExiste: async () => false,
    mensagensDesde: async () => [],
    procurarEnviada: async () => null,
  } as never;

  it('sem conexão, mostra o canal configurado — não um literal', () => {
    const a = new WhatsAppWebAdapter({ provedor: provedorMudo, canal: 'baileys' });
    expect(a.saude().provider).toBe('baileys');
  });

  it('não inventa "whatsapp-web" quando o canal é outro', () => {
    const a = new WhatsAppWebAdapter({ provedor: provedorMudo, canal: 'baileys' });
    expect(a.saude().provider).not.toBe('whatsapp-web');
  });

  it('sem canal e sem conexão, assume a ignorância em vez de chutar', () => {
    // "desconhecido" e feio, e e a verdade. Um nome de biblioteca ali
    // seria bonito e mentiroso.
    const a = new WhatsAppWebAdapter({ provedor: provedorMudo });
    expect(a.saude().provider).toBe('desconhecido');
  });
});
