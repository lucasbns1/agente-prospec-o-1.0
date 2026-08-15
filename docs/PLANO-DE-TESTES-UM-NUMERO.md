# Plano de testes com um número só

Reset de fábrica, um número de teste, e uma bateria em ordem. Cada teste
tem **o que fazer**, **o que tem de acontecer** e **onde conferir**.

A ordem não é arbitrária: cada teste depende do anterior ter passado. Se
o T1 falhar, o T2 não tem como funcionar — não adianta pular.

---

## Antes de tudo: o reset

```powershell
cd $HOME\Documents\prospector
git pull

# 1) Ver o que SERIA apagado (não apaga nada)
pnpm reset:fabrica

# 2) Apagar de verdade
pnpm reset:fabrica -- --confirmo
```

**Apaga:** leads, importações, campanhas, etapas, fila, conversas,
mensagens, histórico, tarefas, notificações, contatos desconhecidos.

**Não apaga:** seu usuário, o dicionário de palavras-chave, os templates
de resposta, as configurações e a sessão do WhatsApp. Você não vai
precisar ler o QR de novo.

Depois: importe `docs/exemplos/lead-de-teste.csv`. Já está pronto com o
seu número:

```csv
nome,telefone,cidade,bairro,estado,categoria,responsavel
Studio Teste Prospector,11984110705,São Paulo,Centro,SP,Teste,
```

Conferido: `11984110705` normaliza para **`5511984110705`** (DDD 11,
celular). Troque `Studio Teste Prospector` pelo nome que você quiser ver
na mensagem.

A coluna `responsavel` está **vazia de propósito**. Assim o sistema trata
"Studio Teste Prospector" como **estabelecimento, não pessoa** — e a
mensagem não pode sair como "Oi, Studio!". Isso também é um teste.

O número conectado é `5511968662120` e o de destino é `5511984110705`.
São diferentes; se fossem o mesmo, o WhatsApp trataria como recado para
si mesmo e nada do fluxo funcionaria.

---

## As três coisas que estamos testando

Você pediu para eu classificar. São três capacidades diferentes, e elas
falham por motivos diferentes:

| | Capacidade | O que quebra quando falha |
|---|---|---|
| **A** | **Enviar** — a mensagem sai e chega | fila, janela, delay, adapter, LID |
| **B** | **Analisar** — a resposta é classificada certo | dicionário, confiança, precedência |
| **C** | **Avisar** — você é notificado no momento certo | notificações, SSE, etapa com aviso |

Cada teste abaixo exercita uma ou mais delas. A coluna diz qual.

---

## T1 — A mensagem 1 sai e chega  ·  capacidade **A**

**Montar:** campanha nova, 1 etapa, texto da abordagem. Janela de horário
que **inclua o horário de agora**. Simulação **ligada** (dry-run).

**Fazer:** enfileirar. Abrir a prévia. Conferir o texto renderizado.

**Tem de acontecer:**
- a prévia mostra o texto sem nenhum `{{ }}` sobrando;
- se você não tem coluna de responsável, o texto **não** pode dizer
  "Oi, <nome do estabelecimento>" como se fosse pessoa;
- a fila mostra 1 mensagem `AGENDADA` com o selo **Dry-run**;
- passados alguns segundos ela vira `SIMULADA` e **nada chega** no
  celular.

**Depois:** desligar a simulação na campanha (Editar → Simulação), e
enfileirar de novo. Agora tem de chegar de verdade no WhatsApp.

**Onde conferir:** Estado das campanhas → a campanha → coluna
"Mensagem 1". E a Fila.

> Se falhar aqui: o problema é fila/janela/adapter. Nada adiante faz
> sentido testar.

---

## T2 — A resposta é classificada  ·  capacidade **B**

**Fazer:** do segundo número, responder **`quero sim, tenho interesse`**.

**Tem de acontecer:**
- em Conversas aparece a mensagem recebida, atribuída ao lead certo
  (não como "contato desconhecido");
- o lead vira **QUENTE**;
- no histórico do lead: `Classificada como POSITIVO (confiança N)`.

**Onde conferir:** Conversas, e a ficha do lead.

> Este teste **não** depende de a mensagem 2 sair. Ele só prova que o
> motor entendeu. Separei de propósito: se a 2 não sair, você precisa
> saber se foi porque ele não entendeu ou porque não enfileirou.

---

## T3 — A resposta faz a mensagem 2 sair  ·  capacidades **B + A**

Este é o teste que estava **quebrado até agora** e que eu consertei
nesta rodada. Vale explicar o que era, porque muda o que você espera ver:

O motor já sabia decidir "isso é positivo, avance". Mas duas coisas
estavam desligadas desde as fases de simulação:

1. o pipeline informava ao motor que **não existia próxima etapa** —
   fixo, sempre. Com isso, toda regra `AVANCAR` virava `PARAR`: o lead
   respondia "quero sim" e era **encerrado na etapa 1**;
2. o efeito "avançar de etapa" só escrevia no histórico *"ação
   reconhecida mas não executada"*. Nada entrava na fila.

Juntas, faziam a mensagem 2 nunca sair. Agora saem — com 18 testes
automatizados cobrindo os casos.

**Montar antes:** só a **etapa 2**. A regra "POSITIVO → avança" agora
nasce junto com a etapa.

> **Segundo buraco, achado depois:** `campaign_step_rules` não tinha
> nenhum caminho para ser preenchida — não há tela, não há rota, o seed
> não cria. Toda etapa nascia **sem regra nenhuma**. E `decidirAcao`,
> corretamente, não improvisa: categoria sem regra vira intervenção
> manual. Resultado: TODA resposta caía em "Precisa de você", inclusive
> um "sim, quero" perfeito. O motor estava certo e o sistema, inútil.
>
> Agora toda etapa nasce com um conjunto padrão conservador:
>
> | Resposta | O que acontece |
> |---|---|
> | POSITIVO | **avança** — é a única que avança sozinha |
> | NEGATIVO, OPT_OUT | para a sequência |
> | PREÇO, DÚVIDA, FALAR_DEPOIS, INTERESSE | chama você |
>
> São linhas normais no banco, editáveis. E salvar as etapas de novo
> **não** sobrescreve o que você ajustar — tem teste para isso.

**Fazer:** repetir o T2 (responder `quero sim`).

**Tem de acontecer:**
- na fila aparece uma **nova** mensagem, da etapa 2, `AGENDADA`;
- ela respeita o delay configurado — não sai no mesmo segundo da
  resposta (responder instantaneamente denuncia automação);
- no quadro, o lead **muda da coluna "Mensagem 1" para "Mensagem 2"**;
- a mensagem 2 chega no celular.

---

## T4 — Você é avisado quando o lead chega na etapa  ·  capacidade **C**

**Montar:** na etapa 2, ligar **"me avise quando chegar aqui"** e
escrever o texto do aviso.

**Fazer:** repetir o T3 com o lead resetado.

**Tem de acontecer:** o sino mostra uma notificação nova, com o nome do
lead e o texto que você escreveu.

---

## T5 — A etapa que depende da sua prévia  ·  capacidades **C + A(negativa)**

**Montar:** na etapa 3, **desligar** "enviar automaticamente".

**Fazer:** levar o lead até a etapa 2 e responder positivo de novo.

**Tem de acontecer:**
- **nenhuma** mensagem da etapa 3 entra na fila — nada agendado fingindo
  que vai sair;
- o lead vai para a coluna **"Precisa de você"**;
- chega a notificação de pedido de prévia.

> É o comportamento que você pediu: a MSG 3 espera você montar a prévia.

---

## T6 — Resposta que ele não entende  ·  capacidades **B + C**

**Fazer:** responder algo fora do dicionário — `manda ai entao vamo ver`
ou qualquer coisa ambígua.

**Tem de acontecer:**
- **nada** é enviado automaticamente;
- o lead vai para **"Precisa de você"**;
- chega notificação de intervenção.

> Entre responder errado e não responder, não responder vence. Mas em
> silêncio, não: você tem de ser avisado.

---

## T7 — Opt-out  ·  capacidade **A(negativa)**

**Fazer:** responder `pare de me mandar mensagem`.

**Tem de acontecer:**
- o lead vira `OPT_OUT`;
- **toda** a fila dele é cancelada na hora;
- ele sai do quadro para "Encerrados";
- nada mais chega no celular, nunca.

> Este é o teste que eu faria **por último e sem pular**. Ele é o único
> cujo defeito custa reputação de verdade: continuar mandando para quem
> pediu para parar.

---

## T8 — Intervenção manual  ·  capacidade **A(negativa)**

**Fazer:** com o lead andando, abrir a ficha e marcar intervenção manual.

**Tem de acontecer:** a automação para para aquele lead, e ele só volta
a andar quando você retomar.

---

## O que eu ainda não consigo prometer

Duas coisas que sei que estão pendentes e que podem aparecer nos testes:

1. **Não há tela para editar as regras de resposta.** Os padrões acima
   estão no banco e funcionam, mas mudar "PREÇO chama você" para outra
   coisa hoje só dá por SQL. A tela é o próximo passo natural depois
   desta bateria.

2. **A coluna de endereço da sua planilha antiga não foi reconhecida** —
   `cidade`, `bairro` e `estado` ficaram vazios nos 80 leads. Se o texto
   da sua etapa usar `{{cidade}}` ou `{{bairro}}`, a mensagem pode ser
   bloqueada por variável ausente. Para o teste com um número só, o mais
   seguro é preencher essas colunas na planilha à mão. Se você me mandar
   a **linha de cabeçalho** da planilha real, eu ensino o importador a
   reconhecer ela.

3. **O XLSX do Bing Maps Scraper deu "Falha ao ler o arquivo"** e eu
   nunca cheguei a diagnosticar — a API estava fora no momento. Para o
   teste, use CSV.

---

## Onde estamos

| | |
|---|---|
| Testes automatizados | 1054 (+ 16 E2E) |
| Barreiras de envio | 4, todas de pé |
| Envio real | liberado (`FASE_PERMITE_ENVIO_REAL = true`) |
| Avanço por resposta | **implementado agora** |
| Regras da etapa | **nascem por padrão agora** |
