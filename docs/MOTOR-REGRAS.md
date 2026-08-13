# Motor de regras

Como o Prospector interpreta a resposta de um lead — **sem IA**.

---

## O que ele faz

```
"Tenho interesse sim, mas quanto custa?"
        ↓
normalização (acento, caixa, typo, abreviação, emoji)
        ↓
mapa de negação
        ↓
casamento contra o dicionário do banco
        ↓
detectadas: POSITIVO, PRECO
        ↓
precedência
        ↓
selecionada: PRECO
        ↓
regra configurada para PRECO
        ↓
{ ação: RESPONDER, templateId: "template_preco_01" }
```

O motor **nunca escreve uma resposta**. Ele devolve, no máximo, o id de
um template. O texto vive em `response_templates`, editável por você.

---

## As 8 categorias e a precedência

```
1. OPT_OUT       ← sempre vence
2. NEGATIVO
3. FALAR_DEPOIS
4. PRECO
5. DUVIDA
6. POSITIVO
7. INTERESSE
8. DESCONHECIDO  ← nunca age sozinho
```

A ordem vem de `settings['regras.precedencia']` — dá para mudar sem
tocar em código.

**As categorias secundárias nunca são descartadas.** O resultado sempre
traz `categoriasDetectadas` completo, e ele vai para o histórico do lead.

### Uma exceção contextual, e só uma

> "não quero agora, **mas** pode me chamar depois"

Detecta NEGATIVO + FALAR_DEPOIS. A precedência crua escolheria NEGATIVO
e encerraria a sequência — mas o lead disse explicitamente que quer ser
procurado de novo.

A exceção é estreita de propósito: só entre NEGATIVO e FALAR_DEPOIS, só
quando a retomada vem **depois** da recusa no texto, e **nunca** quando
há OPT_OUT.

---

## Dicionário

**495 termos** no seed, distribuídos assim:

| Categoria | Termos |
|---|---|
| PRECO | 91 |
| OPT_OUT | 90 |
| POSITIVO | 86 |
| FALAR_DEPOIS | 78 |
| NEGATIVO | 58 |
| DUVIDA | 52 |
| INTERESSE | 40 |
| **total** | **495** |

O banco tem **506** porque 11 termos do seed inicial da Fase 1 continuam
ativos lá. Eles não fazem mal (são variações já cobertas), mas se você
quiser deixar o banco idêntico ao dicionário do código:
`DELETE FROM response_keywords WHERE padrao = true;` seguido de
`pnpm db:seed`.

Cada termo tem: categoria, subtipo, tipo de casamento, peso, ativo,
escopo de etapa, idioma e observação. Tudo editável no banco.

### Pesos

O peso desempata termos **da mesma categoria** e alimenta a confiança.
Ele **não** participa da precedência entre categorias.

```
90-100  frase inequívoca   "não quero receber mais mensagens"
70-89   frase clara        "quanto custa"
50-69   expressão provável "pode mandar"
30-49   sinal fraco        "legal", "talvez"
10-29   pista tênue        "spam" solto
```

---

## Dois limiares de confiança

Esta é a peça que implementa a regra de ouro.

| Limiar | Padrão | O que controla |
|---|---|---|
| classificar | 30 | abaixo disso, a categoria vira DESCONHECIDO |
| **agir** | **50** | abaixo disso, ações que **enviam** viram intervenção |

Por que dois: registrar "isto parece POSITIVO" com confiança 35 é útil
para o CRM. Disparar a próxima mensagem da sequência por causa de um
"ok" solto é uma aposta — e mensagem enviada não volta atrás.

Ações que **não** enviam nada (SNOOZE, PARAR, AGUARDAR) não passam pelo
segundo limiar: elas só deixam o sistema mais silencioso.

---

## Negação

Sem tratar negação, `"não tenho interesse"` casaria com o termo
`interesse` e o lead viraria INTERESSE — o oposto do que ele disse.

**Escopo:** começa no marcador (`não`, `nunca`, `nem`, `sem`, `jamais`) e
termina em:
- conjunção adversativa (`mas`, `porém`, `contudo`…);
- **fronteira de oração** (vírgula, ponto);
- 4 tokens de distância.

O limite de 4 tokens importa: em `"não tenho interesse me chama amanhã"`,
sem vírgula, o `não` não pode negar o `me chama amanhã`.

Termos que **já contêm** a negação (`não quero`, `sem interesse`, `nem`)
são isentos — a negação faz parte do próprio termo.

---

## Normalização conservadora

| Transformação | Exemplo |
|---|---|
| acentos e caixa | `NÃO QUERO` → `nao quero` |
| pontuação | `Pare!!!` → `pare` |
| alongamento | `simmmm` → `sim` |
| abreviação | `vc`, `qto`, `blz`, `pfv` |
| typo | `naum`→`nao`, `enteresse`→`interesse` |

### O que NÃO fazemos

**Fuzzy matching por distância de edição.** Ele confundiria `nao` com
`sao`, `mao`, `pao` — e um falso positivo aqui manda a mensagem errada.

**Colapsar letras dobradas.** Só mexemos em sequências de **3 ou mais**
caracteres iguais. O português tem centenas de palavras com letra dobrada
legítima (`interessado`, `passa`, `disso`, `correndo`) e nenhuma lista de
exceções daria conta do idioma.

---

## Emojis

| Emoji | Resultado |
|---|---|
| 👍 👌 ✅ isolado | POSITIVO (confiança 50) |
| 👎 🚫 ❌ isolado | NEGATIVO |
| 😂 ❤️ 🙏 🔥 isolado | **DESCONHECIDO** |
| junto de texto | não interfere; vale o texto |

😂 pode ser deboche. ❤️ pode ser educação. 🙏 pode ser "obrigado, mas
não". Nenhum deles é base para disparar mensagem.

---

## Sinais auxiliares

Registrados sempre, mas **não decidem a categoria sozinhos**:

`pedidoHumano` · `pedidoAudio` · `pedidoSite` · `pedidoInstagram` ·
`pedidoPortfolio` · `pedidoLocalizacao` · `pedidoHorario` ·
`pedidoPrazo` · `mencionaConcorrente` · `suspeitaGolpe` · `reclamacao` ·
`objecao` · `contemUrl` · `telefonesMencionados` · `emojis`

Dois deles **forçam intervenção** independentemente da categoria:

- **`suspeitaGolpe`** — "como conseguiram meu número?" Uma resposta
  automática aqui seria pior que o silêncio.
- **`pedidoHumano`** — a pessoa pediu para falar com gente.

---

## Garantias que não podem falhar

### 1. Opt-out é inviolável

Vem **antes** de qualquer regra configurada. Não existe configuração no
painel capaz de fazer o sistema continuar mandando mensagem para quem
pediu para parar.

Ao detectar OPT_OUT: registra opt-out, cancela jobs pendentes, para a
sequência, muda status para `OPT_OUT`, esfria o lead.

Lead **já** em opt-out nunca recebe efeito de envio, responda o que
responder.

### 2. DESCONHECIDO nunca responde e nunca avança

Cria intervenção, cria tarefa, marca `AGUARDANDO_INTERVENCAO`, notifica.
Nunca envia, nunca adivinha.

### 3. Sem template, não se inventa resposta

Regra manda RESPONDER mas não há template ativo → `missing_template` →
intervenção. Nenhum texto improvisado sai do motor.

### 4. Sem regra configurada → intervenção

Categoria detectada sem regra correspondente não vira ação padrão.

### 5. Mídia não é interpretada

Imagem, áudio, documento, sticker, vídeo → intervenção direta.

---

## Testes

**441 testes** só do motor:

| Arquivo | Testes | Cobre |
|---|---|---|
| `motor-classificacao.test.ts` | 379 | matriz de frases, precedência, negação, emojis, typos, falsos positivos |
| `motor-decisao.test.ts` | 62 | opt-out, intervenção, snooze, templates, regra de ouro |

Os testes rodam contra o **dicionário real** — o mesmo que o seed grava
no banco — e não contra um dicionário de mentira montado para passar.

### Falsos positivos cobertos

```
"simples"    não casa "sim"
"parece"     não casa "pare"
"parabens"   não casa "para"
"okapi"      não casa "ok"
"nossa"      não casa "nos"
"não gostei" não vira INTERESSE
```

---

## Uma divergência com o briefing

A seção 30 do briefing pede que `"não quero, mas quanto custa?"` seja
classificado como **OPT_OUT**. O motor classifica como **NEGATIVO**.

Motivo: a seção 7 do mesmo briefing lista `"não quero"` como NEGATIVO, e
a frase não contém nenhum pedido de remoção. Tratar toda recusa como
opt-out bloquearia permanentemente um lead que estava apenas perguntando
o preço — e opt-out é irreversível.

As outras três frases da seção 30 têm pedido explícito de remoção e são
classificadas como OPT_OUT normalmente.

**Se você preferir o comportamento literal do briefing**, é uma linha no
dicionário: cadastrar `"nao quero"` também como OPT_OUT.
