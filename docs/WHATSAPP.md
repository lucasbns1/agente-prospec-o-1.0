# Canal WhatsApp

Como o sistema conecta, recebe — e por que **não** envia.

---

## A trava desta fase

```
FASE_PERMITE_ENVIO_REAL = false
```

Em `packages/integrations/src/whatsapp/guarda-envio.ts`.

**Por que uma variável de ambiente não bastava.** `WHATSAPP_MODE=dry-run`
protege enquanto alguém lembrar de conferir o `.env`. Basta um
`export WHATSAPP_MODE=live` num terminal, um compose com o valor errado
ou um teste que mexe em `process.env` para a única trava cair.

Esta constante não depende de configuração. Ligar o envio exige **editar
o arquivo** — o que significa um commit, com autor, data e revisão. Não
é algo que acontece por acidente.

Há ainda uma última checagem (`exigirPermissaoDeEnvioReal`) imediatamente
antes de tocar a biblioteca. Ela **lança** em vez de simular em silêncio:
simular em silêncio faria você achar que enviou o que nunca saiu.

### As quatro barreiras

| Barreira | Onde |
|---|---|
| `FASE_PERMITE_ENVIO_REAL` | código |
| `WHATSAPP_MODE=live` | `.env` |
| `Campaign.dryRun = false` | banco |
| `OutboundMessage.dryRun = false` | banco |

As quatro precisam cair juntas. Três não bastam. `avaliarGuardaEnvio`
acumula **todos** os motivos em vez de parar no primeiro — saber que são
três barreiras levantadas, e não uma, é o que evita alguém baixar uma só
e achar que liberou.

---

## Conectar ≠ enviar

Duas chaves independentes:

```env
WHATSAPP_CANAL=simulado      # simulado | whatsapp-web   → CONECTA?
WHATSAPP_MODE=dry-run        # dry-run  | live           → ENVIA?
```

A Fase 6A vive exatamente em `whatsapp-web` + `dry-run`: conexão real,
recebimento real, envio nenhum. Se fossem a mesma chave, provar a
integração exigiria destravar o envio junto — o oposto do objetivo.

| `WHATSAPP_CANAL` | O que acontece |
|---|---|
| `simulado` (padrão) | Não abre navegador, não conecta. Testes e CI. |
| `whatsapp-web` | Conecta de verdade, pede QR, recebe mensagens. |

Qualquer valor inesperado cai em `simulado`.

---

## Os sete estados

```
DESCONECTADO → INICIALIZANDO → AGUARDANDO_QR → AUTENTICANDO → CONECTADO
                                                                  ↓
                                          FALHOU ← RECONECTANDO ←─┘
```

| Estado | Significa | O que fazer |
|---|---|---|
| `DESCONECTADO` | Sem conexão, sem tentativa | Inicie o worker |
| `INICIALIZANDO` | Abrindo navegador, lendo sessão | Aguardar |
| `AGUARDANDO_QR` | QR gerado | Escanear |
| `AUTENTICANDO` | QR lido, validando | Aguardar |
| `CONECTADO` | Recebendo normalmente | — |
| `RECONECTANDO` | Caiu, tentando voltar | Aguardar |
| `FALHOU` | Desistiu | Reiniciar o worker |

São sete de propósito. Colapsar "inicializando", "aguardando QR" e
"autenticando" num único "conectando" esconde exatamente a informação
que você precisa quando a conexão não sobe — é a diferença entre "o
Chromium ainda está abrindo" e "o QR expirou e ninguém escaneou".

> `WhatsAppStatus` **não** é enum do Prisma. O estado da conexão é
> efêmero, vive no processo do worker e é publicado por SSE. Persistir
> seria guardar uma verdade que expira em segundos.

### Reconexão

Recuo exponencial (2s, 4s, 8s… teto de 60s), até 5 tentativas. Depois
disso: `FALHOU`.

Reconectar em laço apertado depois de o WhatsApp derrubar a sessão só
acelera o próximo bloqueio. Depois de 5 tentativas o problema exige
alguém olhando, não mais uma tentativa.

**Falha de autenticação não reconecta.** Credencial inválida não melhora
com insistência — vai direto para `FALHOU`.

---

## O estado não pode mentir

```
worker  --SET (a cada mudança + heartbeat 30s)-->  Redis  <--GET--  API
```

Quem segura a conexão é o **worker** (é nele que o Chromium vive). Quem
responde ao navegador é a **API**, noutro processo. Se a API também
conectasse, seriam duas sessões disputando o mesmo número — e o WhatsApp
derruba as duas.

Se o retrato no Redis estiver com mais de 90 segundos, a API responde
`DESCONECTADO` em vez de repetir o último "conectado". Um dashboard que
diz conectado com o processo morto é a mentira mais cara do sistema:
você só descobre quando a mensagem não chega.

---

## O QR

- **Não passa por SSE.** Um evento SSE chega a todas as abas abertas.
- **Não vai para o banco.** Fica numa chave do Redis com TTL de 60s.
- **Não vai para o log.** É uma credencial de acesso.
- **Não é buscado em segundo plano.** Só quando você clica em "Mostrar
  QR Code" na tela `/canal`.
- **Some** assim que a sessão autentica.

---

## Isolamento da biblioteca

```
Sistema  →  WhatsAppAdapter  →  WhatsAppWebAdapter  →  ProvedorWhatsApp
                                                              ↓
                                            provedor-whatsapp-web.ts
                                                              ↓
                                                     whatsapp-web.js
```

`whatsapp-web.js` é importado em **um único arquivo**:
`provedor-whatsapp-web.ts` — e por import dinâmico, para o Puppeteer não
entrar no processo enquanto ninguém pedir conexão real.

Ela é uma biblioteca não-oficial que automatiza o WhatsApp Web por baixo
dos panos; atualizações do WhatsApp quebram ela periodicamente. Quando
isso acontecer, o conserto precisa caber num arquivo.

### A costura que torna tudo testável

`ProvedorWhatsApp` é a interface que o **adapter** consome (diferente de
`WhatsAppAdapter`, que o **sistema** consome). Sem ela, nada do adapter
seria testável — nem "o QR expirou", nem "a sessão caiu", nem "a
autenticação falhou". Ficariam todos dependendo de alguém escanear um QR
na mão.

`ProvedorSimulado` emite os mesmos eventos, na mesma ordem, com os
mesmos formatos. São 26 testes que não existiriam de outra forma.

### Eventos internos

O adapter traduz os eventos da biblioteca para o vocabulário do sistema:

| `whatsapp-web.js` | Interno |
|---|---|
| `qr` | `canal.qr` |
| `authenticated` | `canal.autenticado` |
| `auth_failure` | `canal.falha_autenticacao` |
| `ready` | `canal.pronto` |
| `disconnected` | `canal.desconectado` |
| `message` | `canal.mensagem_recebida` |
| `message_ack` | `canal.confirmacao_entrega` |

Nenhuma outra parte do sistema conhece os nomes da esquerda.

---

## Rotas

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/canal/status` | Retrato para a tela |
| `GET` | `/api/canal/qr` | O QR (404 quando não há) |
| `GET` | `/api/canal/saude` | Diagnóstico |

---

## O que NÃO foi construído

Por decisão explícita, nada nesta fase existe para:

- burlar detecção ou esconder que há automação;
- simular comportamento humano para escapar de sistemas de segurança;
- contornar bloqueios ou alterar mensagens para driblar filtros;
- extrair participantes de grupos.

Os limites de volume e a janela de horário que existem (ver
[FILA.md](FILA.md)) são **controle de ritmo**, não evasão: eles servem
para não disparar em massa, e continuam valendo com a automação
declarada.

---

## Conectar de verdade (na sua máquina)

```env
WHATSAPP_CANAL=whatsapp-web
WHATSAPP_MODE=dry-run          # continua assim
CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

1. `pnpm dev` (o **worker** precisa estar rodando — é ele que conecta).
2. Abra `/canal`. O estado vai para `AGUARDANDO_QR`.
3. Clique em **Mostrar QR Code**.
4. No celular: WhatsApp → Aparelhos conectados → Conectar aparelho.
5. O estado passa por `AUTENTICANDO` e chega em `CONECTADO`.

> **O Puppeteer não baixa Chromium neste projeto** (são ~300 MB). Por
> isso `CHROME_PATH` é necessário quando o canal é `whatsapp-web`.

A pasta de `WHATSAPP_SESSION_PATH` guarda as credenciais da conta. Está
no `.gitignore` e **nunca** pode ser commitada.

---

## Testar sem celular

```bash
pnpm --filter @prospector/worker simular 5519999998888 "Pode mandar"
```

Injeta uma mensagem recebida na fila, como se tivesse vindo do WhatsApp.
Exercita o pipeline inteiro — identificação, classificação, efeitos,
CRM. O worker precisa estar rodando.

Repetir o mesmo `providerMessageId` de propósito é como se testa a
idempotência.

---

## De quem é a mensagem — o problema do `@lid`

Toda conversa individual chegava assim:

```
5519999998888@c.us     ← o número está antes do "@"
```

O WhatsApp passou a usar também o **LID** (*Linked ID*), um identificador
de privacidade no lugar do número:

```
75866486894727@lid     ← isto NÃO é um telefone
```

Cortar no `@` funciona no primeiro caso e falha no segundo — devolve 14
dígitos que não são telefone nenhum. Como o sistema identifica o lead
pelo telefone normalizado, o efeito é grave: **nenhum lead é
reconhecido, toda resposta vira "contato desconhecido" e a campanha
nunca avança de etapa**.

> Encontrado na validação com WhatsApp real, não em teste. É o tipo de
> defeito que só aparece com o aparelho na mão.

### Como o número é resolvido

O número real existe — só não fica sempre no mesmo campo. A versão da
biblioteca, a do WhatsApp Web e as configurações de privacidade de quem
escreve mudam onde ele aparece. Em vez de apostar num campo, tentamos
vários, em ordem de confiança:

| # | Fonte | Quando serve |
|---|---|---|
| 1 | `from` com `@c.us` | conversa sem LID |
| 2 | `_data.senderPn` | o número que o WhatsApp anexa em conversas LID |
| 3 | `author` com `@c.us` | alguns formatos de mensagem |
| 4 | `getContact().number` | consulta à agenda da sessão |
| 5 | `getContact().id` | o JID do contato, se for `@c.us` |

A fonte que resolveu vai para o log — **nunca o número**, que é dado do
lead. Saber que veio de `senderPn` e não de `contato` é o que permite
entender o que mudou quando a biblioteca quebrar.

### Nenhum número é melhor que o número errado

Se nada resolver, o telefone fica vazio e a mensagem cai em **contato
desconhecido**, esperando sua decisão. Associá-la ao lead errado seria
muito pior: você responderia a pessoa errada achando que acertou.

O LID nunca é aceito como telefone, nem quando aparece num campo que
deveria trazer número. A verificação compara com o LID em mãos, e não
pelo tamanho: um LID de 14 dígitos cabe no limite de 15 do E.164.

> `chatId` continua sendo o endereço original — é ele que serve para
> **responder**. Telefone e endereço de conversa deixaram de ser a
> mesma coisa.

---

## Confirmação de entrega (`message_ack`)

Três coisas diferentes que é fácil confundir:

```
aceito pelo adapter  ≠  entregue  ≠  lido
```

| Código | Estado | Significa |
|---|---|---|
| `-1` | `FALHOU` | O provedor reportou erro |
| `0` | `PENDENTE` | Ainda não saiu |
| `1` | `ENVIADA` | O **servidor** do WhatsApp aceitou |
| `2` | `ENTREGUE` | Chegou no **aparelho** |
| `3` / `4` | `LIDA` | A pessoa abriu (4 = áudio ouvido) |

Tratar as três como "enviado" faz o painel dizer que você falou com 50
pessoas quando 12 estão com o celular desligado. **A diferença entre
ENVIADA e ENTREGUE é a principal pista de que um número está sendo
bloqueado.**

### Fora de ordem e repetidos

Os acks chegam fora de ordem com frequência — não é exceção, é o normal.
O estado só **avança**, nunca retrocede: um ack de "servidor recebeu"
que chega depois do de "lida" é descartado, senão a mensagem "desleria"
e as métricas de leitura mentiriam junto.

`FALHOU` é a exceção: vence qualquer estado, porque uma mensagem
entregue que depois falha (o número bloqueou) precisa aparecer como
falha.

> Nesta fase isto quase nunca roda: sem envio real não há mensagem nossa
> para o WhatsApp confirmar. Está implementado e testado (20 testes)
> para que ligar o envio não exija escrever esta parte com pressa no dia
> da ativação.

---

## Veja também

- [CONVERSAS.md](CONVERSAS.md) — o que acontece com a mensagem depois
- [VALIDACAO-6B.md](VALIDACAO-6B.md) — roteiro para validar com WhatsApp real
- [FASE-7-ENVIO-REAL-PLANO.md](FASE-7-ENVIO-REAL-PLANO.md) — o que falta para enviar
- [FILA.md](FILA.md) — as barreiras de dry-run no envio
- [MOTOR-REGRAS.md](MOTOR-REGRAS.md) — como a resposta é interpretada
