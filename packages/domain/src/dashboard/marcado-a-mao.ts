/**
 * "Ja mandei para este, na mao."
 *
 * ============================================================
 * O PEDIDO
 * ============================================================
 * "Colocar um botao de marcado como mandado em cada lead e atualizar a
 * lista — porque ai eu mando."
 *
 * A lista "nao responderam a mensagem 1 ou 2" e uma fila de trabalho: a
 * pessoa passa por ela abrindo o WhatsApp e escrevendo na mao. Sem uma
 * forma de riscar o que ja foi feito, ela reescreve para os mesmos leads
 * na proxima vez que abrir a tela — e nao ha nada mais rapido para
 * queimar um numero do que mandar a mesma coisa duas vezes.
 *
 * ============================================================
 * POR QUE ISTO NAO E UMA COLUNA NOVA NO LEAD
 * ============================================================
 * O fato ja tem onde morar: a trilha do lead. Um evento
 * `MENSAGEM_ENVIADA` com esta origem diz o que aconteceu, quando, e por
 * quem — e aparece no historico junto com todo o resto, que e onde voce
 * vai procurar depois.
 *
 * Uma coluna `contatadoManualmenteEm` guardaria menos (so a ultima vez),
 * exigiria migracao, e criaria uma segunda fonte de verdade sobre a
 * mesma coisa.
 *
 * ============================================================
 * O QUE ELE NAO E
 * ============================================================
 * Nao e uma mensagem. Nada foi enviado pelo sistema, nenhuma linha entra
 * em `messages`, e o funil de envios nao muda. E voce dizendo "cuidei
 * deste" — uma anotacao, e e assim que a descricao do evento a nomeia.
 */

/**
 * A origem que marca o evento.
 *
 * A consulta de "nao responderam" filtra por ela, entao ela e um
 * contrato entre a gravacao e a leitura — nao um rotulo solto.
 */
export const ORIGEM_MARCADO_A_MAO = 'marcado-a-mao';

/** A descricao que aparece na trilha do lead. */
export const DESCRICAO_MARCADO_A_MAO =
  'Você marcou que mandou mensagem para este lead pelo WhatsApp';
