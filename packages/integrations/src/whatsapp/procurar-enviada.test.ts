/**
 * "A mensagem saiu?" — respondida pela conversa, não por suposição.
 *
 * ============================================================
 * O DEFEITO QUE ESTES TESTES TRANCAM
 * ============================================================
 * A primeira versão desta busca abria a conversa por
 * `getChatById(telefone + "@c.us")`. Numa conversa LID isso é o chat
 * ERRADO: o endereço real é `<identificador>@lid`, não o telefone.
 *
 * O resultado: a busca olhava um chat vazio, não achava nada, e o
 * sistema concluía "não saiu" — para uma mensagem que estava lá,
 * visível no celular do lead. A fila marcava FALHOU, a etapa não
 * avançava, e a mensagem seguinte nunca era agendada.
 *
 * Foi o MESMO engano que já tinha custado caro na entrada, quando toda
 * resposta caía em "contato desconhecido". Repetido na saída.
 *
 * Varrer procura a MENSAGEM, não a conversa — e por isso não depende do
 * formato do endereço.
 */
import { describe, expect, it } from 'vitest';
import { acharEnviada, type ConversaVarrida } from './procurar-enviada.js';

const AGORA = 1_800_000_000;

function conversa(
  mensagens: Array<{ id: string; fromMe: boolean; body: string; quando?: number }>,
  extras: { isGroup?: boolean; timestamp?: number } = {}
): ConversaVarrida {
  return {
    isGroup: extras.isGroup ?? false,
    timestamp: extras.timestamp ?? AGORA,
    mensagens: mensagens.map((m) => ({
      id: m.id,
      timestamp: m.quando ?? AGORA,
      fromMe: m.fromMe,
      body: m.body,
    })),
  };
}

describe('acharEnviada', () => {
  it('acha a mensagem que enviamos', () => {
    const chats = [conversa([{ id: 'wa-1', fromMe: true, body: 'Olá!' }])];
    expect(acharEnviada(chats, 'Olá!', AGORA - 10)).toBe('wa-1');
  });

  it('acha mesmo quando a conversa é LID — o caso que quebrava', () => {
    // A varredura não sabe nem pergunta qual é o endereço da conversa.
    // É exatamente por isso que ela funciona onde `getChatById` falhava.
    const chats = [
      conversa([{ id: 'outra', fromMe: true, body: 'mensagem de outra pessoa' }]),
      conversa([{ id: 'wa-lid-99', fromMe: true, body: 'Olá!' }]),
    ];
    expect(acharEnviada(chats, 'Olá!', AGORA - 10)).toBe('wa-lid-99');
  });

  it('não confunde uma resposta do lead com um envio nosso', () => {
    // Um eco ou encaminhamento com o mesmo texto não prova que NÓS
    // enviamos — e tratar como prova marcaria como enviada uma mensagem
    // que nunca saiu.
    const chats = [conversa([{ id: 'wa-2', fromMe: false, body: 'Olá!' }])];
    expect(acharEnviada(chats, 'Olá!', AGORA - 10)).toBeNull();
  });

  it('ignora mensagem anterior ao corte', () => {
    // Sem a janela, uma mensagem idêntica de uma campanha de meses atrás
    // seria confundida com a de agora.
    const chats = [
      conversa([{ id: 'velha', fromMe: true, body: 'Olá!', quando: AGORA - 5000 }]),
    ];
    expect(acharEnviada(chats, 'Olá!', AGORA - 10)).toBeNull();
  });

  it('ignora grupos', () => {
    const chats = [
      conversa([{ id: 'grupo-1', fromMe: true, body: 'Olá!' }], { isGroup: true }),
    ];
    expect(acharEnviada(chats, 'Olá!', AGORA - 10)).toBeNull();
  });

  it('pula conversa parada antes do corte sem abrir as mensagens', () => {
    const chats = [
      conversa([{ id: 'x', fromMe: true, body: 'Olá!' }], { timestamp: AGORA - 9999 }),
    ];
    expect(acharEnviada(chats, 'Olá!', AGORA - 10)).toBeNull();
  });

  it('exige texto exato', () => {
    // Comparação frouxa acharia "Olá! Tudo bem?" procurando "Olá!" e
    // confirmaria o envio errado.
    const chats = [conversa([{ id: 'wa-3', fromMe: true, body: 'Olá! Tudo bem?' }])];
    expect(acharEnviada(chats, 'Olá!', AGORA - 10)).toBeNull();
  });

  it('sem conversa nenhuma, devolve null', () => {
    // `null` é "não achei OU não deu para conferir" — nunca "com certeza
    // não saiu". Quem chama escolhe o caminho conservador.
    expect(acharEnviada([], 'Olá!', AGORA - 10)).toBeNull();
  });

  it('devolve a primeira que casar quando há duas iguais', () => {
    // Duas mensagens idênticas na janela são indistinguíveis. A pergunta
    // é "saiu alguma?", não "qual delas".
    const chats = [
      conversa([
        { id: 'wa-a', fromMe: true, body: 'Olá!' },
        { id: 'wa-b', fromMe: true, body: 'Olá!' },
      ]),
    ];
    expect(acharEnviada(chats, 'Olá!', AGORA - 10)).toBe('wa-a');
  });
});
