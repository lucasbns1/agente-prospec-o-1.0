# Orquestração da cadência por IA (Fase 9)

## O que é, em uma frase

O Gemini lê o estado real de um lead numa campanha e diz qual deve ser a
próxima ação. Ele nunca envia nada, nunca afirma que algo foi enviado, e
nunca decide sozinho.

## A hierarquia

```
BANCO      = estado oficial
BACKEND    = executor
WHATSAPP   = transporte
ACK        = confirmação do transporte
GEMINI     = cérebro de decisão
```

O modelo não sobe nessa lista. Ele opina sobre um retrato que o banco
produziu, e a opinião passa por uma guarda determinística antes de virar
ação.

## Ligar e desligar

Três estados, no `.env`:

| `GEMINI_ENABLED` | `AI_ANALYSIS_ONLY` | O que acontece |
|---|---|---|
| `false` | (ignorado) | **Desligada.** Sistema idêntico ao de antes da Fase 9. Zero chamadas de rede, zero custo. |
| `true` | `true` | **Sombra.** A IA analisa e recomenda; quem comanda é o motor determinístico. As divergências vão para `ai_decisions`. |
| `true` | `false` | **Ativa.** As decisões da IA comandam — sempre filtradas pela guarda e pelas quatro barreiras de envio. |

**Sombra é o padrão, mesmo com a IA ligada.** Acender o modelo e dar o
comando a ele são duas decisões separadas.

### Quando sair do modo sombra

Depois de alguns dias rodando, olhe os dados:

```sql
SELECT acao_ia, acao_motor, COUNT(*)
FROM ai_decisions
WHERE divergiu
GROUP BY 1, 2
ORDER BY 3 DESC;
```

Se as divergências fizerem sentido — a IA pedindo intervenção onde o
motor ia mandar mensagem, por exemplo — vale a pena. Se ela estiver
querendo enviar onde o motor esperava, não vale.

Outras consultas úteis:

```sql
-- Quantas vezes a IA falhou e o motor assumiu
SELECT COUNT(*) FROM ai_decisions WHERE fallback;

-- O que a guarda barrou
SELECT motivo_rejeicao, COUNT(*) FROM ai_decisions
WHERE motivo_rejeicao IS NOT NULL GROUP BY 1;

-- Latência
SELECT AVG(latencia_ms), MAX(latencia_ms) FROM ai_decisions;
```

## Por evento, não por tick

O despachante roda a cada 15 segundos. Consultar a IA ali seria ~19.000
chamadas por hora com 80 leads, quase todas para responder "ainda não deu
a hora" — uma pergunta de aritmética.

A IA é consultada quando algo **acontece**:

| Gatilho | Onde | Modo |
|---|---|---|
| `MENSAGEM_RECEBIDA` | `inbound.ts`, depois de `aplicarEfeitos` | observador |
| `ETAPA_CONCLUIDA` | `outbound.ts`, depois do status persistido | normal |
| `ACK_FINAL` | quando chega ENTREGUE/LIDA | normal |
| `OPERADOR_LIBEROU` | liberação manual no quadro | normal |
| `ENVIO_FALHOU` | falha real de envio | normal |

Entre eventos, quem conta o tempo é o `scheduledAt` no banco e o poller —
como sempre foi.

### Por que `MENSAGEM_RECEBIDA` é observador

Naquele caminho, `processarMensagemRecebida` **já** rodou o motor de
regras e **já** aplicou os efeitos. Se o orquestrador executasse também, o
mesmo evento produziria a ação duas vezes.

Então ali ele entra só para comparar: lê o mesmo retrato, diz o que teria
feito, grava a divergência. Dar o comando desse caminho à IA é o passo
seguinte, e depende de olhar os dados do modo sombra primeiro.

## As camadas de proteção contra envio duplicado

São três, e cada uma foi verificada desligando as anteriores:

1. **A guarda** (`validar-decisao.ts`) — recusa a decisão antes de
   qualquer escrita. Impede que a decisão errada se repita a cada evento.
2. **O enfileirador** (`solicitarEnvioDeEtapa`) — consulta se a etapa já
   tem envio ocupando.
3. **A UNIQUE do banco** (`outbound_messages.idempotency_key`) — a
   garantia real sob concorrência.

Com 1 e 2 desligadas, 3 ainda barra. É por isso que a IA pedindo
`SEND_STEP(2)` cinco vezes produz uma mensagem.

## O que a guarda recusa

| Motivo | Situação |
|---|---|
| `LEAD_EM_OPT_OUT` | lead pediu para parar; nenhuma ação de envio passa |
| `CAMPANHA_NAO_ATIVA` | campanha em RASCUNHO, PAUSADA, etc. |
| `AGUARDANDO_LIBERACAO` | a sequência espera você; a IA não destrava |
| `ETAPA_NAO_INFORMADA` | pediu envio sem dizer qual etapa |
| `ETAPA_INEXISTENTE` | pediu a etapa 9 numa campanha de 3 |
| `ETAPA_JA_ENVIADA` | a etapa já tem envio ocupando |
| `PULO_DE_ETAPA` | pediu a 3 quando a próxima era a 2 |
| `ETAPA_MANUAL` | a etapa exige liberação → vira intervenção |
| `SEQUENCIA_TERMINOU` | todas as etapas já têm envio |
| `RETRY_SEM_FALHA` | pediu reenvio de algo que não falhou |

**Opt-out é a única barreira que vale nos dois sentidos:** um lead em
opt-out nunca recebe envio, e nenhuma decisão da IA reverte isso — nem
com confiança 100, nem com `RESUME`, nem com intent de aceite. Reativar é
uma ação manual sua.

## Quando o Gemini falha

Timeout, JSON inválido, resposta vazia, API fora do ar, chave errada: em
todos os casos o motor determinístico (`decidirSemIA`) assume e a cadência
continua. Fica registrado:

- no log, como `AI_ANALYSIS_FAILED` (com modelo, latência, erro — **nunca
  a chave**);
- em `ai_decisions`, com `fallback = true`.

Uma campanha não para porque um modelo remoto ficou indisponível.

## A chave

Lida **somente pelo processo do worker**, a partir do `.env` da raiz. Não
vai para a API, não vai para o frontend, não é gravada no banco, não
aparece em log e não entra no prompt.

`gemini.ts` é o único arquivo que importa a SDK do Google, e não é
exportado do índice do package — mesma disciplina do
`provedor-whatsapp-web.ts`. Com a IA desligada, a SDK nunca é carregada.

## Custo

Uma chamada por evento real, algo como 3–5 por lead ao longo de uma
campanha inteira. Com `gemini-2.5-flash` e `temperature: 0`.

O modo sombra **paga** por essas chamadas — ele economiza risco, não
dinheiro.

## Arquivos

**Puro, sem I/O** (`packages/domain/src/ai/`):

| Arquivo | Papel |
|---|---|
| `decisao-ia.ts` | o contrato; Zod `.strict()` recusa campo extra e enum inventado |
| `contexto.ts` | o retrato lido do banco; `proximaEtapaEsperada` é aritmética |
| `mapear-intent.ts` | os 14 intents → as 8 categorias do enum do Postgres |
| `validar-decisao.ts` | **a guarda** |
| `prompt.ts` | montagem do prompt; sem segredo, sem `Date.now()` |

**Com I/O**:

| Arquivo | Papel |
|---|---|
| `packages/integrations/src/ai/gemini.ts` | o único que fala com o Google |
| `packages/integrations/src/ai/factory.ts` | import dinâmico da SDK |
| `apps/worker/src/services/contexto-cadencia.ts` | lê o banco |
| `apps/worker/src/services/acoes-cadencia.ts` | executa; nenhuma envia |
| `apps/worker/src/services/orquestrador.ts` | o ciclo + `decidirSemIA` |
| `apps/worker/src/services/gatilhos-ia.ts` | os gatilhos |
| `apps/worker/src/services/notificar.ts` | notificação idempotente |

## O que NÃO mudou

As quatro barreiras de envio (`FASE_PERMITE_ENVIO_REAL` → `WHATSAPP_MODE`
→ `Campaign.dryRun` → `OutboundMessage.dryRun`), `decidirDryRun()`, o
caminho de transporte do `outbound.ts`, `avaliarAck()`, o motor de
classificação, o adapter do WhatsApp, QR e sessão.

Mesmo que a IA retorne `SEND_STEP`, o envio passa por todas elas.

## Os 14 intents e as 8 categorias

O sistema tem `RespostaCategoria` como enum do **PostgreSQL**, usado por
quatro tabelas. Expandi-lo obrigaria a mexer nas regras de todas as
campanhas já configuradas. Então o intent granular fica gravado cru em
`messages.ai_intent` e o motor recebe as 8 que conhece:

```
INTERESSE, ACEITE, NEGOCIACAO, AGENDAMENTO  → POSITIVO
PRECO                                        → PRECO
DUVIDA, INFORMACAO, SUPORTE, OBJECAO         → DUVIDA
NEGATIVO                                     → NEGATIVO
OPT_OUT                                      → OPT_OUT
SPAM, DESCONHECIDO, INTERVENCAO              → DESCONHECIDO
```

`OBJECAO → DUVIDA` é a escolha menos óbvia e a que mais muda
comportamento: "achei caro" é conversa, não recusa. Em `NEGATIVO`, a regra
`PARAR` encerraria leads que estavam a uma resposta de fechar.
