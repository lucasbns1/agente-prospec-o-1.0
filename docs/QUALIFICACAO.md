# Qualificação de leads

Este lead pode entrar numa campanha — e **por quê**?

O motivo não é opcional. `NAO_QUALIFICADO` sem explicação é inútil para
quem está olhando a tela.

---

## Os cinco vereditos

| Veredito | Significado | Reversível? |
|---|---|---|
| `NAO_AVALIADO` | Ainda não passou pela qualificação | — |
| `QUALIFICADO` | Pode entrar nesta campanha | — |
| `NAO_QUALIFICADO` | Não atende aos critérios **desta** campanha | Sim — pode ser perfeito para outra |
| `BLOQUEADO` | Nunca pode ser contatado | **Não.** Nenhuma configuração reverte |
| `REVISAR` | Algo parece errado; um humano precisa olhar | Sim |

A distinção entre `BLOQUEADO` e `NAO_QUALIFICADO` é o ponto central
deste módulo. Confundir os dois significa ou contatar quem pediu para
sair, ou descartar para sempre um lead que só não servia para uma
campanha específica.

---

## Ordem da avaliação

```
1. bloqueios      ← inegociáveis, vêm primeiro
2. revisar        ← dados insuficientes
3. critérios      ← os filtros da campanha
```

### 1. Bloqueios

Avaliados antes de tudo. Nenhum critério de campanha os contorna:

- `optOut = true` → **BLOQUEADO**
- `status` em `OPT_OUT`, `AGUARDANDO_INTERVENCAO`, `PAUSADO` → **BLOQUEADO**
- sem telefone normalizado → **BLOQUEADO**

### 2. Revisar

Sem nome **e** sem empresa → **REVISAR**. Não dá para escrever uma
mensagem decente, mas também não dá para afirmar que o lead é ruim — o
dado é que está faltando.

### 3. Critérios da campanha

Acumulam **todas** as falhas, não só a primeira. Se um lead falha em
três critérios, você vê os três — corrigir um de cada vez e re-testar
seria trabalho desperdiçado.

---

## Critérios disponíveis

| Critério | Efeito |
|---|---|
| `exigirTelefone` | Só com telefone |
| `exigirSemSite` | Só quem **não** tem site próprio |
| `exigirComSite` | Só quem tem |
| `exigirSemInstagram` / `exigirComInstagram` | Presença de Instagram |
| `avaliacaoMinima` | Nota mínima no Google |
| `totalAvaliacoesMinimo` | Número mínimo de avaliações |
| `cidades`, `estados`, `categorias`, `tags` | Listas |
| `apenasNuncaContatados` | Exclui quem já recebeu mensagem |

**Ausente ≠ `false`.** `exigirTelefone: false` significa "não me
importo", não "quero leads sem telefone". Um critério ausente
simplesmente não filtra nada.

### Rede social não é site próprio

`websiteStatus = REDE_SOCIAL` (Instagram, Facebook, Linktree) **passa**
no `exigirSemSite`. Um psicólogo que só tem Instagram continua sendo
exatamente o alvo de "vocês ainda não têm um site próprio".

Só `SITE_PROPRIO` conta como ter site.

---

## O motivo

Sempre em português, montado a partir dos critérios atendidos e das
falhas:

```
QUALIFICADO      "telefone válido + sem site + cidade Campinas"
NAO_QUALIFICADO  "tem site próprio; avaliação 3.2 abaixo de 4.0"
BLOQUEADO        "lead pediu opt-out"
REVISAR          "sem nome e sem empresa — não dá para personalizar"
```

Ele é gravado em `motivo_qualificacao` junto com `qualificado_em`, e
aparece na prévia e no detalhe do lead.

---

## Requalificar

`POST /api/campaigns/requalificar`

Recalcula a qualificação de um conjunto de leads. Útil depois de
importar, de corrigir dados em massa ou de mudar os critérios.

Não envia nada e não enfileira nada.

---

## Onde isso mora

`packages/domain/src/campaign/qualificacao.ts` — função pura, sem I/O.
Entram lead + critérios, sai o veredito com motivo. Testável sem banco.

O serviço de campanha aplica os filtros que dão para resolver em SQL
antes de chamar a qualificação: carregar 10 mil leads na memória para
descartar 9 mil seria desperdício. A qualificação fina — a que precisa
produzir um motivo legível — roda sobre o subconjunto.
