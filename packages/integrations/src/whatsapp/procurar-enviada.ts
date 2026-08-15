/**
 * Achar, nas conversas, uma mensagem que NOS enviamos.
 *
 * ============================================================
 * POR QUE ISTO EXISTE
 * ============================================================
 * `sendMessage` as vezes entrega a mensagem e nunca resolve a promessa.
 * Quando isso acontece, a unica pergunta que importa e "saiu ou nao?" —
 * e o WhatsApp sabe a resposta: a mensagem esta na conversa.
 *
 * Supor custou caro. O sistema marcava FALHOU dizendo "PODE ter saido",
 * a sequencia parava numa falha inexistente, e a etapa seguinte nunca
 * era agendada. Tres rodadas de teste real morreram assim.
 *
 * ============================================================
 * POR QUE VARRER, E NAO ABRIR A CONVERSA PELO ID
 * ============================================================
 * A primeira versao fazia `getChatById(telefone + "@c.us")`. Numa
 * conversa LID isso e o chat ERRADO: o endereco real e
 * `<identificador>@lid`, nao o telefone. A busca olhava um chat vazio,
 * nao achava nada, e concluia "nao saiu" — para uma mensagem visivel no
 * celular do lead.
 *
 * Foi o mesmo engano que ja tinha custado caro na ENTRADA, quando toda
 * resposta caia em "contato desconhecido". Varrer procura a MENSAGEM,
 * nao a conversa, e por isso nao depende do formato do endereco.
 *
 * Esta funcao e pura: entra uma lista de conversas, sai um id ou `null`.
 * A parte que fala com a biblioteca fica no provedor.
 */

/** O minimo que se precisa saber de uma mensagem para reconhece-la. */
export interface MensagemDaConversa {
  id: string;
  /** Segundos desde a epoca — o formato do whatsapp-web.js. */
  timestamp: number;
  fromMe: boolean;
  body: string;
}

export interface ConversaVarrida {
  isGroup: boolean;
  /** Timestamp da ultima mensagem. Serve para pular conversa parada. */
  timestamp: number;
  mensagens: MensagemDaConversa[];
}

/**
 * Procura uma mensagem nossa com este texto, a partir de `corteSegundos`.
 *
 * A comparacao e por texto EXATO + janela de tempo, e nao por id, porque
 * o id e justamente o que nao voltou.
 *
 * Duas mensagens identicas dentro da janela sao indistinguiveis — mas a
 * pergunta que se esta fazendo e "saiu alguma?", nao "qual delas". A
 * janela e de segundos, entao a chance de confundir com outra campanha e
 * remota.
 */
export function acharEnviada(
  conversas: ConversaVarrida[],
  texto: string,
  corteSegundos: number
): string | null {
  for (const conversa of conversas) {
    // Grupo nao e prospeccao. E varrer grupos traria dezenas de
    // mensagens que nao tem nada a ver com o que se procura.
    if (conversa.isGroup) continue;

    // Conversa parada antes do corte nao pode conter a mensagem — e
    // buscar dentro dela seria trabalho jogado fora.
    if (conversa.timestamp < corteSegundos) continue;

    for (const m of conversa.mensagens) {
      // `fromMe` e o filtro central: uma resposta do lead com o mesmo
      // texto (um eco, um encaminhamento) nao prova que NOS enviamos.
      if (!m.fromMe) continue;
      if (m.timestamp < corteSegundos) continue;
      if (m.body !== texto) continue;
      return m.id;
    }
  }
  return null;
}
