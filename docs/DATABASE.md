# Banco de dados

> **ESTE DOCUMENTO PRECISA DA SUA REVISÃO ANTES DA MIGRATION RODAR NA SUA
> MÁQUINA.** Leia as decisões de modelagem abaixo. Se algo estiver errado,
> eu ajusto o schema e regenero a migration — nada foi executado no seu
> computador ainda.
>
> **Revisado na auditoria pós-Fase 1.** 10 correções aplicadas; ver
> [Correções da auditoria](#correções-da-auditoria) no final.

PostgreSQL 16 + Prisma 6. O banco é a fonte de verdade do sistema.

---

## Contagem de tabelas

**São 20 tabelas, não 19.** O relatório da Fase 1 dizia 19 — eu contei
errado. A contagem verificada no banco está abaixo.

Você listou 17 entidades no documento original (`users`, `leads`,
`campaigns`, `campaign_steps`, `campaign_step_rules`, `lead_campaigns`,
`conversations`, `messages`, `lead_events`, `tasks`, `notifications`,
`jobs`, `settings`, `capture_sessions`, `imports`, `import_rows`,
`website_checks`). Todas existem. As **3 a mais**:

| Tabela extra | Por que existe |
|---|---|
| `sessions` | Login por cookie precisa de sessão persistida. Sem ela, reiniciar a API deslogaria você. |
| `social_domains` | Você pediu que a lista de domínios sociais fosse **configurável pelo painel**. Uma tabela permite CRUD direto; um JSON solto dentro de `settings` não. |
| `response_keywords` | Mesma razão: você pediu para "abrir o painel e alterar/adicionar palavras de cada categoria". Uma tabela por termo permite editar, desativar, pesquisar e ter escopo por etapa. |

Se preferir, `social_domains` e `response_keywords` podem virar chaves JSON
dentro de `settings` — mas a tela de configuração fica bem pior. **Recomendo
manter como tabelas.**

---

## Enums

### `LeadStatus` — onde o lead está no processo
`NOVO` · `IMPORTADO` · `PRONTO` · `EM_CAMPANHA` · `AGUARDANDO_RESPOSTA` ·
`EM_CONVERSA` · `AGUARDANDO_INTERVENCAO` · `AGENDADO` · `PAUSADO` ·
`ENCERRADO` · `OPT_OUT` · `OPORTUNIDADE` · `CLIENTE`

Cobre integralmente a lista do requisito 15. `AGUARDANDO_INTERVENCAO` é o
estado central da regra crítica de resposta: o sistema entra nele quando não
reconhece uma resposta, e **nunca sai dele sozinho**.

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

## As 20 tabelas

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

### 4. Deduplicação garantida pelo banco nas três prioridades

- `leads.telefoneNormalizado` — `UNIQUE` (prioridade 1)
- `leads.chaveDedupe` — `UNIQUE` (prioridades 2 e 3)
- índice composto `(nomeCompleto, cidade)` para a busca

O Postgres aceita vários `NULL` numa coluna `UNIQUE`. Isso é o que queremos
para o telefone — leads sem telefone não devem colidir *por causa do
telefone*. Mas significa que, **só com essa constraint**, dois leads com o
mesmo nome e endereço e sem telefone entrariam os dois.

Por isso existe `chaveDedupe`: um hash determinístico calculado na
importação, na ordem telefone → nome+endereço → nome+cidade. Com ele, as
prioridades 2 e 3 passam a ser garantidas pelo banco, e não apenas pela
lógica da aplicação — que pode ter bug ou ser contornada por uma inserção
manual.

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

---

## Correções da auditoria

Auditoria feita após a Fase 1, comparando o schema com o documento completo
de requisitos. Foram encontrados **10 problemas**, todos corrigidos antes de
qualquer código de negócio ser escrito.

### 1. `LeadStatus` não cobria a lista do requisito 15
Faltavam `EM_CONVERSA`, `PAUSADO` e `OPT_OUT`, e `ATENCAO_NECESSARIA` tinha
nome diferente do que você especificou.
**Correção:** renomeado para `AGUARDANDO_INTERVENCAO` e os três status
acrescentados.

### 2. `ImportRow.leadDuplicadoId` era uma FK fantasma
Coluna sem `@relation`: nada impedia apontar para um lead inexistente, e
apagar um lead deixaria a referência quebrada em silêncio — a auditoria da
importação mentiria.
**Correção:** relação explícita `LinhaDuplicouLead` com `onDelete: SetNull`.

### 3. Deduplicação sem telefone não era garantida pelo banco
`telefoneNormalizado` é `UNIQUE`, mas o Postgres aceita vários `NULL`. Dois
leads com o mesmo nome e endereço, ambos sem telefone, **entrariam os dois**.
**Correção:** coluna `chaveDedupe` `UNIQUE`, preenchida na importação com um
hash determinístico (telefone → nome+endereço → nome+cidade). As prioridades
2 e 3 passam a ser garantidas pelo banco, não pela aplicação.

### 4. Não guardávamos qual regra foi acionada (requisito 12)
`Message.termosCasados` dizia quais palavras casaram, mas não qual
configuração de campanha decidiu a ação.
**Correção:** `Message.campaignStepRuleId` com FK para `CampaignStepRule`.

### 5. Faltava a URL da fonte (requisito 6)
**Correção:** `Lead.fonteUrl` (ficha no Google Maps) e
`CaptureSession.fonteUrl` (a busca que originou a captura).

### 6. Faltavam dados brutos no próprio lead (requisito 6)
Os dados crus só existiam em `ImportRow`. Apagar uma importação antiga
deixaria o lead sem origem rastreável.
**Correção:** `Lead.dadosBrutos` (JSON) e `Lead.importadoEm`.

### 7. Faltava "próxima ação" (requisito 6)
**Correção:** `Lead.proximaAcao` e `Lead.proximaAcaoEm`, com índice.

### 8. Dashboard não tinha como contar "negativos" e "interessados"
Só dava para saber varrendo `messages` a cada carregamento.
**Correção:** `Lead.ultimaCategoria` denormalizada e indexada.

### 9. Domínios sociais não cobriam subdomínios
`m.facebook.com` precisava ser cadastrado à mão, e `br.instagram.com`
passaria como site próprio.
**Correção:** `SocialDomain.incluirSubdominios`. Um domínio desconhecido
continua **nunca** virando rede social automaticamente — o casamento só
ocorre contra esta lista.

### 10. Notificações não tinham ordem de prioridade
Ordenar "o que importa primeiro" exigiria um `CASE` sobre o tipo em toda
consulta.
**Correção:** `Notification.prioridade` (menor = primeiro), com
`INTERVENCAO_NECESSARIA = 1`, e índice `(lida, prioridade, createdAt)`.

---

## Bug encontrado fora do schema

A auditoria também expôs uma **corrida no padrão de idempotência** do worker.

O código fazia `findUnique` e depois `create`. Esse par **não é atômico**:
com dois workers (ou um restart mal feito deixando dois processos), ambos
leem "não existe" e tentam criar. A constraint `UNIQUE` impedia a linha
duplicada — mas o segundo `create` lançava `P2002` **não tratado**, e um job
que estoura é reenfileirado pelo BullMQ. Na Fase 7 isso significaria tentar
reenviar uma mensagem que já saiu.

**Correção:** `INSERT` direto com `try/catch` em `P2002`, tratando a colisão
como "já processado". A decisão fica com o banco, único ponto onde a
operação é realmente atômica.

**Verificado:** 6 jobs simultâneos com a mesma chave e 2 workers competindo →
1 execução, 5 bloqueios limpos, 0 falhas, 1 linha no banco.
