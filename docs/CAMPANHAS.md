# Campanhas

Quem recebe, o que recebe e quando recebe.

---

## O caminho inteiro

```
leads no CRM
     ↓
filtros da campanha        (SQL — corta o grosso)
     ↓
qualificação               (domínio — decide e explica o motivo)
     ↓
mensagem personalizada     (domínio — o texto de cada lead)
     ↓
agendamento                (domínio — quando cada uma sai)
     ↓
outbound_messages          (banco — a fila de verdade)
     ↓
despachante                (worker — "está na hora?")
     ↓
worker de envio            (DRY-RUN — nada sai)
```

Cada seta é uma função pura ou uma escrita no banco. Nenhuma delas fala
com o WhatsApp.

---

## Estados de uma campanha

| Estado | O que significa | Enfileira? |
|---|---|---|
| `RASCUNHO` | Recém-criada. Estado inicial de toda campanha. | Não |
| `ATIVA` | Em operação. | Sim |
| `PAUSADA` | Parada por você. **Cancela o que ainda não saiu.** | Não |
| `CONCLUIDA` | Terminou. | Não |
| `ARQUIVADA` | Fora do caminho. Cancela a fila. | Não |

Toda campanha nasce `RASCUNHO` **e** `dryRun: true`. Ativar exige um ato
explícito, e não pode acontecer sem pelo menos uma etapa ativa — uma
campanha "ativa" sem etapa ficaria parada sem dizer por quê.

**Pausar não é cosmético.** Ao pausar, toda mensagem `PENDENTE` ou
`AGENDADA` daquela campanha vira `CANCELADA`. Sem isso o worker
continuaria drenando a fila enquanto você acha que parou tudo.

---

## Filtros — quem entra

Configuráveis:

| Filtro | Efeito |
|---|---|
| `exigirTelefone` | Só leads com telefone normalizado |
| `exigirSemSite` / `exigirComSite` | Presença de site próprio |
| `exigirSemInstagram` / `exigirComInstagram` | Presença de Instagram |
| `cidades`, `estados`, `categorias`, `tags` | Listas |
| `avaliacaoMinima`, `totalAvaliacoesMinimo` | Nota no Google |
| `apenasNuncaContatados` | Exclui quem já recebeu mensagem |
| `maxLeads` | Teto de leads por enfileiramento |

### Duas exclusões que você não pode desligar

```
optOut = false
status NOT IN (OPT_OUT, AGUARDANDO_INTERVENCAO)
```

Elas são aplicadas em `montarWhere()` antes de qualquer filtro seu. Não
há flag para desativá-las. Quem pediu para sair, saiu; quem está
esperando você resolver alguma coisa não recebe automação por cima.

> Rede social **não** conta como site próprio. Um lead com só Instagram
> continua sendo alvo de "vocês ainda não têm um site".

---

## Etapas

Uma etapa é uma mensagem na sequência. Ela tem:

- `ordem` — posição na sequência (única por campanha);
- `texto` ou `templateId` — o conteúdo (um dos dois é obrigatório);
- `ativo` — desligar sem apagar;
- `enviarAutomaticamente`, `aguardarResposta`.

O editor salva o conjunto inteiro numa transação. Atualização parcial
poderia deixar duas etapas com a mesma `ordem` no meio do caminho e
violar a constraint.

A ordem enviada é sempre a posição atual na lista, não o campo `ordem`
antigo — senão remover uma etapa deixaria buracos (1, 3, 4).

---

## Prévia

`GET /api/campaigns/:id/preview`

**A prévia não grava nada.** Nenhuma linha em `outbound_messages`,
nenhum job, nenhuma mensagem. Ela existe para você ver o texto exato
antes de ele existir.

Ela devolve, por lead: a qualificação, o motivo em português, a mensagem
renderizada e — quando não deu para renderizar — o motivo do bloqueio.

Prévia individual: `GET /api/campaigns/:id/preview/:leadId`.

---

## Enfileirar

`POST /api/campaigns/:id/enfileirar`

Cria as linhas em `outbound_messages`. **Não envia.** Recusa se:

- a campanha não estiver `ATIVA`;
- não houver etapa ativa;
- a etapa não tiver texto nem template.

### Idempotência

A chave é `sha256(leadId | campaignId | campaignStepId)`, gravada numa
coluna `UNIQUE`. Enfileirar dez vezes cria uma linha.

A gravação é `INSERT` direto com captura de `P2002` — **nunca**
`findUnique` seguido de `create`. Esse par não é atômico: sob
concorrência as duas chamadas leem "não existe" antes de qualquer uma
gravar, e as duas tentam criar. Só a constraint do banco resolve.

Verificado: 10 enfileiramentos simultâneos → 1 linha.

---

## API

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/campaigns` | Lista com resumo da fila |
| `POST` | `/api/campaigns` | Cria (nasce RASCUNHO + dry-run) |
| `GET` | `/api/campaigns/:id` | Detalhe com etapas |
| `PATCH` | `/api/campaigns/:id` | Edita |
| `POST` | `/api/campaigns/:id/status` | Muda estado |
| `PUT` | `/api/campaigns/:id/steps` | Substitui as etapas |
| `GET` | `/api/campaigns/:id/preview` | Prévia em massa |
| `GET` | `/api/campaigns/:id/preview/:leadId` | Prévia de um lead |
| `POST` | `/api/campaigns/:id/enfileirar` | Enfileira |
| `GET` | `/api/campaigns/:id/fila` | Vê a fila |
| `GET` | `/api/campaigns/:id/quadro` | Quem está em qual mensagem |
| `POST` | `/api/campaigns/contar-leads` | Quantos o filtro pega |
| `POST` | `/api/campaigns/requalificar` | Recalcula a qualificação |

---

## Telas

- `/campanhas` — lista, filtro por status, criação.
- `/campanhas/:id` — quatro abas: **Etapas**, **Público**, **Prévia**,
  **Fila**.

O seletor de público mostra um contador ao vivo de quantos leads o
filtro pega. Sem ele, montar o público seria adivinhação e o erro só
apareceria na prévia.

---

## O quadro — quem está em qual mensagem

- `/estado` — lista das campanhas, com menu de ações em cada uma.
- `/estado/:id` — o quadro.

```
┌──────────┬────────────┬────────────┬────────────┬──────────────┬─────────────┐
│ Na fila  │ Mensagem 1 │ Mensagem 2 │ Mensagem 3 │ Precisa de   │ Encerrados  │
│          │            │            │            │ você         │             │
│    12    │     40     │     8      │     3      │      5       │     22      │
└──────────┴────────────┴────────────┴────────────┴──────────────┴─────────────┘
```

Numa lista, "quantos pararam na mensagem 2" exige ler linha por linha.
Em colunas a resposta é a **forma** do quadro: uma coluna cheia no meio
significa que aquela mensagem não está destravando ninguém — visível de
longe, sem contar nada.

### Cada lead aparece em uma coluna só

É a regra que faz os números valerem alguma coisa. Um lead em
intervenção **também** tem uma etapa atual; se aparecesse nas duas
colunas, a soma passaria do total de leads e nenhum número da tela
poderia ser levado a sério.

A precedência, do mais forte para o mais fraco:

| # | Coluna | Quando |
|---|---|---|
| 1 | **Encerrados** | `CONCLUIDO`, `PARADO`, `OPT_OUT` |
| 2 | **Precisa de você** | `AGUARDANDO_INTERVENCAO`, `PAUSADO` |
| 3 | **Na fila** | sem etapa atual — a primeira mensagem não saiu |
| 4 | **Mensagem N** | andando normalmente |

Encerrado vem antes de intervenção de propósito: um lead que deu opt-out
depois de cair em intervenção não precisa mais de você — cobrar uma ação
sua sobre ele seria pedir que você procure quem pediu para não ser
procurado.

`PAUSADO` fica em "Precisa de você" porque um lead pausado exibido na
coluna da etapa **pareceria estar andando**, quando na verdade não anda
até você mexer.

### O número é a verdade; os cartões são uma amostra

O total no topo da coluna vem de uma contagem no banco e é exato. Os
cartões são os primeiros 20. Quando há mais, a coluna diz quantos
ficaram de fora em vez de fingir que aquilo é tudo.

> Colunas vazias **continuam aparecendo**. Uma etapa sem ninguém é
> informação: significa que a sequência trava antes dela. Sumir quando
> zera esconderia justamente o problema que você está procurando.

O quadro se atualiza sozinho a cada 15 segundos.

---

## Veja também

- [MENSAGENS.md](MENSAGENS.md) — como o texto de cada lead é montado
- [FILA.md](FILA.md) — agendamento, limites e dry-run
- [QUALIFICACAO.md](QUALIFICACAO.md) — quem é qualificado e por quê
