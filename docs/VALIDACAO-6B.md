# Roteiro de validação — Fase 6B

O que **você** precisa executar na sua máquina, porque depende do seu
celular e de um segundo número.

> **Antes de começar:** use um **chip dedicado**, nunca seu número
> pessoal. Se algo der errado com o número, você não quer perder seu
> WhatsApp.

---

## 0. Preparação

```bash
git pull
pnpm install
docker compose up -d          # PostgreSQL e Redis
pnpm db:migrate               # deve dizer "already in sync"
pnpm db:seed                  # atualiza o dicionário (2 correções novas)
```

No `.env`:

```env
WHATSAPP_CANAL=whatsapp-web
WHATSAPP_MODE=dry-run
CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

> `CHROME_PATH` é **obrigatório**: este projeto não baixa Chromium (são
> ~300 MB). Aponte para o Chrome que você já tem.

```bash
pnpm dev                      # API + worker + frontend
```

Em outro terminal:

```bash
pnpm health
```

Esperado:

```
  API             : OK
  DATABASE        : OK
  REDIS           : OK
  WORKER          : OK
  WHATSAPP ADAPTER: OK
  GUARDA DE ENVIO : OK  (envio real bloqueado no código)
```

Se `WHATSAPP ADAPTER` não ficar OK, o resto do roteiro não vai funcionar.

---

## 1. QR Code real

- [ ] Abra `http://localhost:5173/canal`
- [ ] O estado deve ser **`AGUARDANDO_QR`**
- [ ] Clique em **Mostrar QR Code** (ele não aparece sozinho, de propósito)
- [ ] Escaneie: WhatsApp → Aparelhos conectados → Conectar aparelho

Depois de escanear, a tela deve passar por:

```
AGUARDANDO_QR → AUTENTICANDO → CONECTADO
```

- [ ] O campo **Número** mostra o número do chip
- [ ] **Sessão desde** fica preenchido

**Se falhar:** o QR expira em ~60s; clique em *Atualizar*.

---

## 2. O estado é real, não decorativo

- [ ] `pnpm health` → `WHATSAPP ADAPTER: OK (whatsapp-web, CONECTADO, número ...)`
- [ ] Recarregue a página (F5) → continua `CONECTADO`
- [ ] Abra uma segunda aba em `/canal` → mesmo estado, sem conflito
- [ ] `curl http://localhost:3333/api/canal/saude` (autenticado) →
      `connected: true`, `authenticated: true`

**O teste que importa:** pare o worker (Ctrl+C no processo dele) e espere
**90 segundos**. A tela deve virar **DESCONECTADO**, não continuar
dizendo "conectado".

- [ ] Confirmado: o estado não mente quando o worker morre

---

## 3. Reinicialização e persistência da sessão

- [ ] Reinicie **só o worker**
- [ ] Ele deve reconectar **sem pedir QR** (a sessão está em
      `WHATSAPP_SESSION_PATH`)
- [ ] Reinicie a **API** → o WhatsApp não cai junto
- [ ] Reinicie o **frontend** → o WhatsApp não cai junto

A sessão do WhatsApp vive no worker. Derrubar a interface não pode
derrubar a conexão.

---

## 4. Mensagem recebida real

Do **segundo número**, mande para o número conectado:

```
teste de integração
```

- [ ] A mensagem aparece em `/conversas` **sem F5**
- [ ] O log do worker mostra `Mensagem recebida processada`
- [ ] **Nenhuma resposta automática é enviada**

> Se o remetente não for um lead cadastrado, ele aparece em
> **"N de número desconhecido"** — o que também é um resultado correto.
> Para testar a identificação, importe antes um lead com esse telefone.

---

## 5. CRM em tempo real

Com um lead cadastrado com o número do segundo aparelho:

- [ ] Nome, telefone, empresa aparecem
- [ ] Campanha e etapa aparecem (se o lead estiver em campanha)
- [ ] A mensagem, com horário
- [ ] A **classificação** e a **confiança** ao lado da mensagem
- [ ] O histórico registra `RESPOSTA_CLASSIFICADA`
- [ ] O dashboard atualiza sozinho

---

## 6. Classificação

Mande uma frase por vez, do segundo número, e confira em `/conversas`:

| Você manda | Categoria esperada | Confiança |
|---|---|---|
| `sim` | POSITIVO | 70 |
| `pode mandar` | POSITIVO | 90 |
| `quanto custa?` | PRECO | 95 |
| `quem é você?` | DUVIDA | 60 |
| `não quero receber` | **OPT_OUT** | 100 |

- [ ] As cinco batem

> As duas últimas foram **corrigidas nesta fase**. Antes, "quem é você?"
> caía em DESCONHECIDO e "não quero receber" em NEGATIVO. Se você não
> rodou `pnpm db:seed`, elas ainda vão falhar.

Mande também algo sem sentido (`asdfgh qwerty`):

- [ ] Vira DESCONHECIDO e o lead fica **aguardando intervenção**
- [ ] Nenhuma transição foi forçada

---

## 7. Opt-out real — **obrigatório**

Do segundo número:

```
não quero receber mensagens
```

- [ ] Categoria: **OPT_OUT**, confiança 100
- [ ] O lead fica com a tarja **opt-out**
- [ ] Status: `OPT_OUT`
- [ ] As mensagens que estavam na fila viram **CANCELADA**
- [ ] O histórico registra `OPT_OUT_REGISTRADO`

Agora tente alcançá-lo de novo:

- [ ] Em `/campanhas`, o contador de leads **não** inclui esse lead
- [ ] Na prévia da campanha, ele não aparece
- [ ] Em `/conversas`, o botão **Retomar automação** não existe para ele

```bash
pnpm auditoria    # opt-outs deve ter subido
```

---

## 8. Contato desconhecido

De um **terceiro número** (ou de um número não cadastrado):

```
oi, quem fala?
```

- [ ] Aparece em `/conversas` → botão **"1 de número desconhecido"**
- [ ] **Não** foi associado a nenhum lead
- [ ] O motivo aparece: "Nenhum lead com o telefone ..."

---

## 9. Intervenção manual

Com um lead ativo em `/conversas`:

- [ ] Clique em **Assumir conversa**
- [ ] O status vira `AGUARDANDO_INTERVENCAO`
- [ ] O rótulo muda para **automação parada**
- [ ] As mensagens na fila viram `CANCELADA`
- [ ] O histórico registra o evento

Depois:

- [ ] **Retomar automação** pede confirmação (não é um clique só)
- [ ] Se o lead não estiver em campanha ativa, o sistema **recusa** e diz
      o porquê

---

## 10. Dry-run continua bloqueado — **o teste mais importante**

Mesmo com o WhatsApp **CONECTADO**:

- [ ] Crie uma campanha, ative e enfileire
- [ ] As mensagens ficam `AGENDADA` → `SIMULADA`
- [ ] Em `/conversas`, elas aparecem como **SIMULAÇÃO DE ENVIO**, nunca
      "Enviada"
- [ ] **Nada chega** no segundo aparelho

```bash
pnpm auditoria
```

- [ ] `REAL_MESSAGES_SENT = 0`
- [ ] `com id do WhatsApp: 0`

Confirme direto no banco, sem confiar na interface:

```sql
SELECT count(*) FROM messages
WHERE direcao = 'ENVIADA' AND simulada = false;
-- deve ser 0

SELECT count(*) FROM messages
WHERE direcao = 'ENVIADA' AND whatsapp_message_id IS NOT NULL;
-- deve ser 0
```

---

## 11. `message_ack`

Nesta fase o sistema **não envia**, então não há mensagem nossa para o
WhatsApp confirmar. O consumo de `message_ack` está implementado e
testado (20 testes), mas só terá efeito quando o envio for ligado.

- [ ] Nada a validar aqui agora — anotado como pendência da Fase 7

---

## Ao terminar

```bash
pnpm auditoria > auditoria-6b.txt
pnpm health
```

Me mande:

1. A saída de `pnpm auditoria`
2. O que **não** bateu no roteiro (com o passo)
3. O log do worker se algo falhou
4. Se o QR conectou de primeira ou precisou de tentativas

**Não altere** `FASE_PERMITE_ENVIO_REAL` nem `WHATSAPP_MODE`. Se algum
passo tentar te levar a isso, pare e me avise.

---

## Se algo der errado

| Sintoma | Onde olhar |
|---|---|
| Canal não sobe | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) → "O canal não conecta" |
| QR não aparece | Só existe em `AGUARDANDO_QR` e vale 60s |
| Diz conectado mas nada chega | `/api/canal/saude` → `seconds_since_last_event` |
| Mensagem de teste ignorada | Idempotência: reusar `provider_message_id` é descartado |
| Classificação errada | Rodou `pnpm db:seed` depois do `git pull`? |
