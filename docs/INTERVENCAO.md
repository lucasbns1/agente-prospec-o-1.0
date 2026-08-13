# Intervenção manual

Quando o sistema para, **você** assume.

---

## Por que o sistema para

Parar é uma decisão de projeto, não uma falha. O sistema para quando:

| Situação | O que ele faz |
|---|---|
| Não entendeu a resposta | Status `AGUARDANDO_INTERVENCAO`, cria tarefa, notifica |
| Confiança abaixo do limiar para agir | Não responde, não avança |
| Categoria sem template | Não inventa resposta — registra `missing_template` |
| Variável obrigatória faltando | Não envia mensagem truncada |

**Regra de ouro:** na dúvida entre responder e não responder, ele escolhe
**não responder**. Segurança acima de automação.

O custo disso é que alguém precisa destravar. Essa é a Fase 5.

---

## Nada aqui envia mensagem

"Assumir a conversa" significa que **você** vai falar com a pessoa, pelo
seu WhatsApp. A tela registra o que aconteceu e destrava o lead — ela não
manda nada.

---

## Resolver uma intervenção

No detalhe do lead, quando o status é `AGUARDANDO_INTERVENCAO`, aparece o
bloco **Aguardando você**. Você escolhe para onde o lead vai depois da
conversa e, opcionalmente, escreve o que aconteceu.

`POST /api/leads/:id/resolver-intervencao`

O que acontece junto:

1. O lead muda para o status escolhido.
2. `proximaAcao` é limpa — ela descrevia a intervenção que acabou de ser
   resolvida.
3. A nota entra em `observacoes`, com carimbo de data.
4. As tarefas `RESPOSTA_NAO_RECONHECIDA` e `RESPONDER_CLIENTE` daquele
   lead são concluídas — deixá-las abertas faria o contador do dashboard
   mentir.
5. As notificações `INTERVENCAO_NECESSARIA` do lead são marcadas como
   lidas.
6. Um `LeadEvent` do tipo `INTERVENCAO_RESOLVIDA` é gravado.

A rota recusa (422) se o lead não estiver aguardando intervenção.

---

## Toda ação deixa rastro

Cada rota desta fase grava um `LeadEvent` com `origem: "usuario"`. Sem
isso, daqui a três meses ninguém saberia por que um lead mudou de
status — e *"quem mudou isso?"* é a primeira pergunta quando algo dá
errado.

O histórico é append-only: nunca é reescrito nem apagado.

---

## Sair do automático cancela a fila

Mover o lead para `PAUSADO`, `ENCERRADO`, `CLIENTE` ou
`AGUARDANDO_INTERVENCAO` cancela as mensagens dele que ainda estavam
`PENDENTE`/`AGENDADA`.

Sem isso, o sistema mandaria a próxima etapa da campanha por cima da
conversa que você acabou de assumir.

---

## Status × temperatura

São **independentes**, de propósito:

- **Status** = onde o lead está no processo (`EM_CONVERSA`, `PAUSADO`, …)
- **Temperatura** = quão perto de fechar (`FRIO`, `MORNO`, `QUENTE`)

Um lead quente pode estar pausado — ele quer, mas pediu para falar mês
que vem. Juntar os dois campos perderia essa informação.

Alguns status são definidos pelo sistema (`AGUARDANDO_RESPOSTA`,
`EM_CAMPANHA`). Eles aparecem no seletor como opção inerte, para a caixa
não mentir mostrando outro valor.

---

## Opt-out

### Registrar

`POST /api/leads/:id/opt-out`

- Marca `optOut` e `optOutEm`, status vira `OPT_OUT`.
- **Cancela a fila do lead.** Opt-out sem cancelar a fila seria uma
  promessa quebrada: a pessoa pediu para parar e receberia a próxima
  etapa mesmo assim.
- Grava `OPT_OUT_REGISTRADO`.

A partir daí o lead não é alcançado por nenhuma campanha — `montarWhere`
o exclui sempre, e isso não é configurável.

Opt-out **não** entra pela rota de status: ela recusa com
`USE_ROTA_OPT_OUT`. É a única mudança de status que o sistema trata como
promessa feita a outra pessoa.

### Reverter

`POST /api/leads/:id/opt-out/reverter`

Exige `confirmar: true` **e** uma justificativa de pelo menos 3
caracteres. Sem os dois, a rota recusa e nada muda.

> **A decisão aqui:** um clique errado não pode condenar um lead para
> sempre, então reverter é possível. Mas desfazer um opt-out precisa ter
> dono — por isso a confirmação, a justificativa obrigatória, o
> `LeadEvent` com o texto "OPT-OUT REVERTIDO" e um `warn` no log.
>
> O lead volta como `PAUSADO`, nunca direto para a campanha: retomar o
> envio automático tem que ser um segundo ato consciente.

---

## Rotas

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/leads/:id/status` | Muda o status (recusa `OPT_OUT`) |
| `POST` | `/api/leads/:id/temperatura` | Muda a temperatura |
| `POST` | `/api/leads/:id/resolver-intervencao` | Destrava o lead |
| `POST` | `/api/leads/:id/nota` | Anota, com carimbo de data |
| `POST` | `/api/leads/:id/proxima-acao` | Define o próximo passo |
| `POST` | `/api/leads/:id/opt-out` | Registra opt-out |
| `POST` | `/api/leads/:id/opt-out/reverter` | Reverte, com justificativa |

---

## Veja também

- [DASHBOARD.md](DASHBOARD.md) — como o lead chega até você
- [MOTOR-REGRAS.md](MOTOR-REGRAS.md) — por que o sistema parou
