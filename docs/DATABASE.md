# Banco de dados

> **ESTE DOCUMENTO PRECISA DA SUA REVISÃO ANTES DA MIGRATION RODAR NA SUA
> MÁQUINA.** Leia as decisões de modelagem abaixo. Se algo estiver errado,
> eu ajusto o schema e regenero a migration — nada foi executado no seu
> computador ainda.

PostgreSQL 16 + Prisma 6. O banco é a fonte de verdade do sistema.

---

## Contagem de tabelas

Você pediu 16 entidades. O schema tem **19**. As três a mais e o motivo:

| Tabela extra | Por que existe |
|---|---|
| `sessions` | Login por cookie precisa de sessão persistida. Sem ela, reiniciar a API deslogaria você. |
| `social_domains` | Você pediu que a lista de domínios sociais fosse **configurável pelo painel**. Uma tabela permite CRUD direto; um JSON solto dentro de `settings` não. |
| `response_keywords` | Mesma razão: você pediu para "abrir o painel e alterar/adicionar palavras de cada categoria". Uma tabela por termo permite editar, desativar e pesquisar. |

Se preferir, `social_domains` e `response_keywords` podem virar chaves JSON
dentro de `settings` — mas a tela de configuração fica bem pior. **Recomendo
manter como tabelas.**

---

## Enums

### `LeadStatus` — onde o lead está no processo
`NOVO` · `IMPORTADO` · `PRONTO` · `EM_CAMPANHA` · `AGUARDANDO_RESPOSTA` ·
`AGENDADO` · `ATENCAO_NECESSARIA` · `ENCERRADO` · `OPORTUNIDADE` · `CLIENTE`

> `AGENDADO` foi acrescentado à sua lista original para suportar o snooze
> do "falar depois".

### `Temperatura` — quão perto de comprar
`FRIO` · `MORNO` · `QUENTE`

**Independente do status.** Um lead pode ser `EM_CAMPANHA` + `MORNO`, ou
`OPORTUNIDADE` + `QUENTE`. A temperatura sobe **e desce** livremente, e toda
mudança gera uma linha em `lead_events`.

### `WebsiteStatus`
`NAO_INFORMADO` · `REDE_SOCIAL` · `SITE_PROPRIO` · `INVALIDO` · `NAO_VERIFICADO`

A regra "tem site próprio?" é exatamente `status == SITE_PROPRIO`.
Todo o resto conta como sem site. Guardamos `NAO_INFORMADO` separado de
`REDE_SOCIAL` para você conseguir filtrar "quem só tem Instagram".

### `RespostaCategoria` — em ordem de precedência
`OPT_OUT` → `NEGATIVO` → `FALAR_DEPOIS` → `PRECO` → `DUVIDA` → `POSITIVO`
→ `INTERESSE` → `DESCONHECIDO`

A ordem real é lida de `settings['regras.precedencia']` — o enum só
documenta o padrão.

### `MessageStatus`
`PENDENTE` · `ENVIANDO` · `ENVIADA` · `ENTREGUE` · `LIDA` · `FALHOU` ·
**`SIMULADA`** · `CANCELADA`

`SIMULADA` é um estado terminal próprio do dry-run. **Não conta para o
limite diário** — só `ENVIADA`, `ENTREGUE` e `LIDA` contam.

### Demais enums
`MatchTipo`, `StepAction`, `SnoozeUnidade`, `CampaignStatus`,
`LeadCampaignStatus`, `MessageDirection`, `TaskStatus`, `TaskPriority`,
`TaskType`, `NotificationLevel`, `NotificationType`, `JobStatus`,
`ImportStatus`, `ImportRowStatus`, `DedupeCriterio`, `LeadEventType`.

---

## As 19 tabelas

### Autenticação
| Tabela | Papel |
|---|---|
| `users` | Usuário do sistema. Senha em Argon2id. |
| `sessions` | Sessões ativas. Guarda o **SHA-256** do token, nunca o token. |

### Configuração
| Tabela | Papel |
|---|---|
| `settings` | Chave/valor JSON: delays, limite diário, precedência, dry-run. |
| `social_domains` | Domínios que não contam como site próprio. |
| `response_keywords` | Dicionário do motor de regras. 96 termos no seed. |

### Captura e importação
| Tabela | Papel |
|---|---|
| `capture_sessions` | Uma rodada: "Psicólogos / Campinas / SP". |
| `imports` | Um arquivo enviado + mapeamento de colunas + resumo. |
| `import_rows` | Cada linha **crua** do arquivo, com o erro ou o motivo da duplicidade. |

### Lead
| Tabela | Papel |
|---|---|
| `leads` | O registro central do CRM. |
| `website_checks` | Histórico das verificações de site. |
| `lead_events` | Log append-only de tudo que aconteceu com o lead. |

### Campanhas
| Tabela | Papel |
|---|---|
| `campaigns` | Nome, nicho, cidade, delays, limite diário. |
| `campaign_steps` | **O texto de cada mensagem.** Nunca no código. |
| `campaign_step_rules` | O que fazer para cada categoria de resposta. |
| `lead_campaigns` | Vínculo lead ↔ campanha. **Guarda a etapa atual.** |

### Conversas
| Tabela | Papel |
|---|---|
| `conversations` | Thread de WhatsApp com um lead. |
| `messages` | Cada mensagem enviada ou recebida. |

### Operação
| Tabela | Papel |
|---|---|
| `tasks` | O que precisa da sua ação. |
| `notifications` | Alertas do sino. |
| `jobs` | Espelho auditável dos jobs do BullMQ. |

---

## Decisões de modelagem que você precisa aprovar

### 1. Dados originais preservados lado a lado com os normalizados

`leads` tem `nomeOriginal`, `telefoneOriginal`, `enderecoOriginal` e
`websiteOriginal` — exatamente como vieram da planilha — junto com os
campos tratados.

**Por quê:** se a normalização errar, você consegue ver o que veio de fato e
corrigir. Sem isso, um bug no parser destruiria o dado original para sempre.

### 2. A etapa atual mora em `lead_campaigns`, não em `leads`

Você listou `etapa_atual` dentro do lead. Movi para o vínculo
lead↔campanha.

**Por quê:** um lead pode passar por várias campanhas ao longo do tempo. Se a
etapa ficasse no lead, entrar na segunda campanha apagaria o histórico da
primeira. `leads.campaignId` continua existindo como atalho para "campanha
ativa agora".

### 3. Idempotência por constraint, não por lógica

- `messages.idempotencyKey` — `UNIQUE`
- `messages.whatsappMessageId` — `UNIQUE`
- `jobs.idempotencyKey` — `UNIQUE`

**Por quê:** o worker grava a chave **antes** de chamar o WhatsApp. Se um
retry rodar a mesma unidade de trabalho, o INSERT colide e o envio é
abortado. O BullMQ sozinho **não** garante execução única — a garantia vem
do banco. Isso foi testado: 3 jobs com a mesma chave → 1 execução, 1 linha.

### 4. Deduplicação com apoio de índice

- `leads.telefoneNormalizado` — `UNIQUE` (prioridade 1)
- índice composto `(nomeCompleto, cidade)` (prioridades 2 e 3)

O Postgres permite múltiplos `NULL` em coluna `UNIQUE`, então leads sem
telefone não colidem entre si — que é o comportamento desejado.

### 5. `lead_events` é append-only

Nunca sofre UPDATE nem DELETE. É a base do histórico completo que você pediu
(requisitos 11 e 27), incluindo **toda** mudança de temperatura, com origem e
motivo.

### 6. `jobs` duplica o que já está no Redis

**Por quê:** o Redis é a fila de **execução**; o Postgres é o **histórico
auditável**. Se o Redis for limpo, perdemos a fila mas não a memória do que
foi feito — e a chave de idempotência sobrevive.

### 7. Bairro nunca é deduzido

`leads.bairro` é `NULL` sempre que a origem não trouxer o bairro
explicitamente. O export do Google Maps raramente separa isso. Um bairro
errado numa mensagem é pior que nenhum bairro — por isso `{{bairro}}` vazio
**bloqueia o envio** e cria uma tarefa de revisão.

---

## Índices

| Tabela | Índices |
|---|---|
| `leads` | status, temperatura, websiteStatus, cidade, bairro, categoria, campaignId, optOut, ultimaInteracaoEm, (nomeCompleto, cidade) |
| `messages` | (conversationId, createdAt), leadId, status, direcao, **enviadaEm** |
| `lead_campaigns` | status, **proximoEnvioEm**, **snoozeAte** |
| `lead_events` | (leadId, createdAt), tipo |
| `tasks` | (status, prioridade), leadId, prazo |
| `jobs` | (fila, status), agendadoPara |

`messages.enviadaEm` suporta a contagem do limite diário.
`lead_campaigns.proximoEnvioEm` e `snoozeAte` suportam a varredura do worker
por trabalho pendente — sem eles, cada ciclo faria full scan.

---

## Constraints únicas

| Constraint | Protege contra |
|---|---|
| `leads.telefoneNormalizado` | lead duplicado |
| `messages.idempotencyKey` | enviar a mesma mensagem duas vezes |
| `messages.whatsappMessageId` | processar a mesma resposta duas vezes |
| `jobs.idempotencyKey` | executar o mesmo trabalho duas vezes |
| `lead_campaigns (leadId, campaignId)` | lead entrar 2x na mesma campanha |
| `campaign_steps (campaignId, ordem)` | duas MSG 3 na mesma campanha |
| `campaign_step_rules (stepId, categoria)` | duas regras conflitantes |
| `response_keywords (categoria, termo, stepId)` | termo duplicado |
| `import_rows (importId, numeroLinha)` | reprocessar linha |
| `users.email`, `sessions.tokenHash`, `settings.chave`, `social_domains.dominio` | duplicidade |

---

## Comandos

```bash
pnpm db:migrate        # aplica migrations (desenvolvimento)
pnpm db:migrate:deploy # aplica migrations (produção)
pnpm db:seed           # popula configurações padrão
pnpm db:studio         # inspeção visual
pnpm db:reset          # APAGA TUDO e recria
```

O schema completo, com comentários linha a linha, está em
`packages/database/prisma/schema.prisma`.
