# Conversas e recebimento

O que acontece quando um lead responde.

---

## O caminho

```
WhatsApp
   ↓  canal.mensagem_recebida
   ↓  fila (process_incoming_message)
   ↓  idempotência por provider_message_id
   ↓  normalização do telefone → E.164
   ↓  identificação do lead        (não adivinha)
   ↓  gravação em messages
   ↓  motor de regras              (determinístico, sem IA)
   ↓  decisão + efeitos
   ↓  CRM atualizado + SSE
```

### Por que passa pela fila

O adapter entrega a mensagem dentro do callback de evento do
`whatsapp-web.js`. Processar ali seguraria o event loop do cliente do
WhatsApp durante consultas ao banco, classificação e escritas — uma
consulta lenta viraria atraso na conexão, e um erro não tratado
derrubaria a sessão.

Enfileirar desacopla: o canal coloca o envelope na fila e volta a
escutar.

---

## Idempotência, em duas camadas

1. **`jobId` no BullMQ** derivado do `provider_message_id`. Se o evento
   chegar duas vezes, o segundo é descartado antes de qualquer trabalho.
2. **`messages.whatsapp_message_id` UNIQUE.** É a garantia real: duas
   entregas simultâneas colidem no banco.

A camada 1 não substitui a 2 — ela evita trabalho; a 2 evita dado
duplicado.

> Jobs concluídos ficam retidos 24h. Reusar um `provider_message_id` de
> ontem faz a mensagem ser descartada como duplicata — é a dedupe
> funcionando, e é por isso que os testes usam ids únicos por execução.

---

## Identificação do lead: não adivinhar

| Situação | Resultado |
|---|---|
| Um lead com o telefone | É dele |
| Nenhum lead | `CONTATO_DESCONHECIDO` |
| Vários **ativos** | Para e pede revisão |
| Vários, só um ativo | Usa o ativo |
| Vários, todos encerrados | Usa o mais recente |

Escolher errado gravaria a resposta de uma pessoa no histórico de outra,
e a partir daí toda decisão seguinte (classificação, etapa, temperatura)
sai errada para as duas. Um "chute com 80% de acerto" produz 20% de
conversas cruzadas que ninguém percebe até ser tarde.

> **Nota honesta:** `leads.telefone_normalizado` é `UNIQUE`, então dois
> leads não conseguem compartilhar o mesmo telefone — o ramo "ambíguo" é
> hoje **inalcançável** por essa consulta. Ele existe e é testado como
> função pura porque é a defesa para o dia em que a identificação usar
> outra chave (um segundo telefone, ou casamento por nome+cidade).

### Contato desconhecido

Vai para a tabela `unknown_contacts` e aparece em `/conversas`.

Não criamos lead automaticamente: isso encheria o CRM de números que
você nunca prospectou. E não descartamos: se alguém responde de um
segundo número, ou se o telefone do lead está cadastrado errado, a
mensagem sumiria sem deixar rastro.

---

## Classificação

Usa o **motor de regras da Fase 3** — determinístico, sem IA. O canal só
fornece a mensagem; o resto do sistema continua igual.

O que fica gravado na `message`:

| Campo | Para quê |
|---|---|
| `categoria` | A categoria vencedora |
| `categoriasDetectadas` | Todas que casaram, antes da precedência |
| `subtipo` | Detalhamento (ex.: `opt_out_direto`) |
| `confianca` | 0–100 |
| `termosCasados` | Quais palavras dispararam |
| `textoNormalizado` | Depois de acento/caixa/pontuação |

A **confiança** é o que separa uma certeza de um chute que ficou abaixo
do limiar de ação. Sem ela na tela, "por que o sistema fez isso?" só
teria resposta no log.

---

## Efeitos

O motor devolve efeitos; o serviço os aplica. **Nenhum deles envia
mensagem.**

| Efeito | O que faz |
|---|---|
| `ALTERAR_STATUS` | Move o lead |
| `ALTERAR_TEMPERATURA` | FRIO / MORNO / QUENTE |
| `REGISTRAR_OPT_OUT` | Marca **e cancela a fila** |
| `CANCELAR_JOBS_PENDENTES` | Limpa a fila do lead |
| `CRIAR_TAREFA` | Vira item em `/tarefas` |
| `CRIAR_INTERVENCAO` | Notifica e trava a conversa |
| `AGENDAR_SNOOZE` | Adia a fila |
| `REGISTRAR_EVENTO` | Histórico |

Os efeitos de **envio** (`ENVIAR_TEMPLATE`, `AVANCAR_ETAPA`) são
reconhecidos e registrados no histórico, mas **não enfileiram nada**
nesta fase: criariam mensagens que existiriam só para serem bloqueadas
depois — ruído sem informação.

---

## Tela

- `/conversas` — caixa de entrada, ordenada por quem falou por último.
- `/conversas/:leadId` — a thread.

Cada resposta recebida mostra a categoria, o subtipo e a confiança ao
lado do texto.

### Simulada nunca aparece como enviada

Uma mensagem em dry-run é rotulada **SIMULAÇÃO DE ENVIO**, nunca
"Enviada". Uma simulação mostrada como enviada faria você acreditar que
falou com alguém que nunca recebeu nada — o pior erro possível numa
ferramenta de prospecção.

---

## Assumir e retomar

**Assumir conversa** reusa a rota da Fase 5 (`/api/leads/:id/status` →
`AGUARDANDO_INTERVENCAO`), que já cancela a fila do lead.

**Retomar automação** (`POST /api/conversas/:leadId/retomar-automacao`)
exige `confirmar: true` e verifica, antes:

1. o lead não está em opt-out;
2. não está `ENCERRADO` nem `CLIENTE`;
3. existe vínculo com uma campanha;
4. a campanha está `ATIVA`;
5. quantas mensagens já estão na fila — e **mantém** as existentes em vez
   de duplicar.

Voltar sem checar seria a forma mais fácil de mandar mensagem para quem
pediu para parar.

---

## Rotas

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/conversas` | Caixa de entrada |
| `GET` | `/api/conversas/:leadId` | A thread completa |
| `GET` | `/api/conversas/desconhecidos` | Quem não é lead |
| `POST` | `/api/conversas/desconhecidos/:id/resolver` | Marca como tratado |
| `POST` | `/api/conversas/:leadId/retomar-automacao` | Volta ao automático |

> Resolver um contato desconhecido **não** reprocessa a mensagem: aplicar
> efeitos com base num texto antigo mudaria etapa ou registraria opt-out
> por algo que já passou. O registro fica como histórico.

---

## Veja também

- [WHATSAPP.md](WHATSAPP.md) — a conexão e a trava de envio
- [MOTOR-REGRAS.md](MOTOR-REGRAS.md) — como a categoria é decidida
- [INTERVENCAO.md](INTERVENCAO.md) — o que fazer quando o sistema para
