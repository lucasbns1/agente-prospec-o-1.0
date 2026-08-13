/**
 * O caso que motivou este arquivo esta em "conversa LID": o WhatsApp
 * entregou `75866486894727@lid` e o sistema tratou isso como telefone.
 * Nenhum lead era reconhecido.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  resolverTelefoneDaMensagem,
  ehEnderecoLid,
  type MensagemBruta,
} from './telefone-da-mensagem.js';

const TELEFONE = '5519999998888';
const LID = '75866486894727';

describe('ehEnderecoLid', () => {
  it('reconhece @lid', () => {
    expect(ehEnderecoLid(`${LID}@lid`)).toBe(true);
  });

  it('não confunde com @c.us', () => {
    expect(ehEnderecoLid(`${TELEFONE}@c.us`)).toBe(false);
  });

  it('tolera valores estranhos', () => {
    expect(ehEnderecoLid(null)).toBe(false);
    expect(ehEnderecoLid(undefined)).toBe(false);
    expect(ehEnderecoLid(123)).toBe(false);
  });
});

describe('resolverTelefoneDaMensagem', () => {
  describe('conversa normal (@c.us)', () => {
    it('tira o número do próprio from', async () => {
      const r = await resolverTelefoneDaMensagem({ from: `${TELEFONE}@c.us` });
      expect(r).toEqual({ telefone: TELEFONE, fonte: 'from', ehLid: false });
    });

    it('nem consulta o contato quando o from já resolve', async () => {
      const getContact = vi.fn();
      await resolverTelefoneDaMensagem({ from: `${TELEFONE}@c.us`, getContact });
      // A consulta é a fonte mais cara. Não deve rodar à toa.
      expect(getContact).not.toHaveBeenCalled();
    });
  });

  describe('conversa LID', () => {
    const from = `${LID}@lid`;

    it('NÃO usa o LID como telefone', async () => {
      const r = await resolverTelefoneDaMensagem({ from });
      expect(r.telefone).toBeNull();
      expect(r.fonte).toBe('nenhuma');
      expect(r.ehLid).toBe(true);
    });

    it('usa senderPn quando existe', async () => {
      const r = await resolverTelefoneDaMensagem({
        from,
        _data: { senderPn: TELEFONE },
      });
      expect(r).toEqual({ telefone: TELEFONE, fonte: 'senderPn', ehLid: true });
    });

    it('aceita senderPn no formato JID', async () => {
      const r = await resolverTelefoneDaMensagem({
        from,
        _data: { senderPn: `${TELEFONE}@c.us` },
      });
      expect(r.telefone).toBe(TELEFONE);
    });

    it('cai para author quando é @c.us', async () => {
      const r = await resolverTelefoneDaMensagem({
        from,
        author: `${TELEFONE}@c.us`,
      });
      expect(r).toEqual({ telefone: TELEFONE, fonte: 'author', ehLid: true });
    });

    it('ignora author que também é LID', async () => {
      const r = await resolverTelefoneDaMensagem({
        from,
        author: `${LID}@lid`,
      });
      expect(r.telefone).toBeNull();
    });

    it('cai para o contato quando nada mais resolve', async () => {
      const r = await resolverTelefoneDaMensagem({
        from,
        getContact: async () => ({ number: TELEFONE }),
      });
      expect(r).toEqual({ telefone: TELEFONE, fonte: 'contato', ehLid: true });
    });

    it('cai para o id do contato', async () => {
      const r = await resolverTelefoneDaMensagem({
        from,
        getContact: async () => ({ id: { _serialized: `${TELEFONE}@c.us` } }),
      });
      expect(r).toEqual({ telefone: TELEFONE, fonte: 'contato_id', ehLid: true });
    });

    it('respeita a ordem: senderPn antes do contato', async () => {
      const getContact = vi.fn(async () => ({ number: '5511777776666' }));
      const r = await resolverTelefoneDaMensagem({
        from,
        _data: { senderPn: TELEFONE },
        getContact,
      });
      expect(r.telefone).toBe(TELEFONE);
      expect(getContact).not.toHaveBeenCalled();
    });
  });

  describe('nunca devolve algo que não é telefone', () => {
    it('recusa o LID mesmo vindo em senderPn', async () => {
      // 14 dígitos: comprido demais para número com código de país.
      const r = await resolverTelefoneDaMensagem({
        from: `${LID}@lid`,
        _data: { senderPn: LID },
      });
      expect(r.telefone).toBeNull();
    });

    it('recusa valores curtos demais', async () => {
      const r = await resolverTelefoneDaMensagem({
        from: '123@c.us',
        getContact: async () => ({ number: '456' }),
      });
      expect(r.telefone).toBeNull();
    });

    it('recusa texto sem dígitos suficientes', async () => {
      const r = await resolverTelefoneDaMensagem({
        from: 'status@broadcast',
        getContact: async () => ({ number: 'não informado' }),
      });
      expect(r.telefone).toBeNull();
    });
  });

  describe('robustez', () => {
    it('getContact que lança não derruba o recebimento', async () => {
      // Uma exceção aqui não pode matar a sessão do WhatsApp.
      const r = await resolverTelefoneDaMensagem({
        from: `${LID}@lid`,
        getContact: async () => {
          throw new Error('sessão instável');
        },
      });
      expect(r.telefone).toBeNull();
      expect(r.fonte).toBe('nenhuma');
    });

    it('getContact que devolve null', async () => {
      const r = await resolverTelefoneDaMensagem({
        from: `${LID}@lid`,
        getContact: async () => null,
      });
      expect(r.telefone).toBeNull();
    });

    it('mensagem vazia não quebra', async () => {
      const r = await resolverTelefoneDaMensagem({} as MensagemBruta);
      expect(r).toEqual({ telefone: null, fonte: 'nenhuma', ehLid: false });
    });
  });
});
