# Solução de problemas

Primeiro passo sempre: **veja o health check.**

```
http://localhost:3333/api/health
```

```json
{
  "ok": true,
  "servicos": { "api": true, "banco": true, "redis": true },
  "whatsapp": { "modo": "dry-run" }
}
```

Qual campo está `false` diz onde procurar.

---

## O sistema não sobe

### `[CONFIGURACAO INVALIDA]` no boot

A validação está funcionando. A mensagem lista exatamente qual variável está
errada. As causas mais comuns:

- `.env` não existe → copie o `.env.example`
- `SESSION_SECRET` com menos de 32 caracteres → gere um novo
- `DATABASE_URL` ausente

### `Can't reach database server at localhost:5432`

O Postgres não está rodando.

```powershell
docker compose ps          # os containers estão de pé?
docker compose up -d
docker compose logs postgres
```

Se o Docker Desktop não estiver aberto, abra e espere ficar verde.

### `ECONNREFUSED 127.0.0.1:6379`

O Redis não está rodando. Mesmo procedimento acima, com `redis`.

### `Port 5432 is already allocated`

Você tem PostgreSQL nativo ocupando a porta. Pare o serviço em `Services.msc`
ou mude a porta no `docker-compose.yml` para `127.0.0.1:5433:5432` e ajuste
o `DATABASE_URL`.

### `Cannot find module '@prisma/client'`

```powershell
pnpm db:generate
```

### `EADDRINUSE: address already in use 127.0.0.1:3333`

Já existe uma API rodando. Feche a outra janela, ou:

```powershell
netstat -ano | findstr :3333
taskkill /PID <numero> /F
```

---

## Banco de dados

### `The table 'public.leads' does not exist`

As migrations não rodaram:
```powershell
pnpm db:migrate
```

### `password authentication failed for user "prospector"`

A senha em `DATABASE_URL` não bate com `POSTGRES_PASSWORD`. Os dois valores
precisam ser idênticos.

Se você mudou a senha **depois** de já ter criado o container, o Postgres
manteve a senha antiga (ela só é aplicada na criação do volume). Para
recriar do zero — **isso apaga os dados**:

```powershell
docker compose down -v
docker compose up -d
pnpm db:migrate
pnpm db:seed
```

### Quero inspecionar o banco

```powershell
pnpm db:studio
```

### Quero recomeçar do zero

```powershell
pnpm db:reset    # APAGA TUDO, recria e roda o seed
```

---

## Login

### Não consigo entrar

1. O seed rodou? `pnpm db:seed`
2. O e-mail e a senha são os do `.env` (`SEED_USER_EMAIL` / `SEED_USER_PASSWORD`)
3. Mudou `SEED_USER_PASSWORD` depois do primeiro seed? **O seed não altera a
   senha de um usuário existente.** Apague o usuário no `pnpm db:studio` e
   rode o seed de novo.

### Entro e sou deslogado na hora

Provavelmente o cookie não está viajando. Confirme:
- Você está acessando `http://localhost:5173` (não `127.0.0.1:5173`)
- `WEB_ORIGIN` no `.env` bate com o endereço que você usa
- A API está rodando

### Todas as chamadas voltam 401

Faça logout e login de novo. Se persistir, apague a linha em `sessions` pelo
Prisma Studio.

---

## Tempo real (SSE)

### O topo mostra "reconectando…" permanentemente

1. A API está no ar? (`/api/health`)
2. Você está logado? O `/api/events` exige autenticação.
3. Abra o DevTools → Network → filtre por `events`. O status deve ser
   `200` e ficar **pendente** (é um stream aberto, não uma resposta que
   fecha).

### O Dashboard não atualiza sozinho

Confirme no log do worker se os eventos estão sendo publicados. A ponte é
`worker → Redis pub/sub → API → SSE`. Se o Redis cair, os eventos param
mas o resto continua funcionando.

---

## Filas e jobs

### Os jobs não são processados

O worker está rodando? Ele é um processo **separado** da API:
```powershell
pnpm dev:worker
```

### Um job falhou

```powershell
pnpm db:studio    # tabela `jobs`: veja `status`, `erro` e `tentativas`
```

Jobs falhos ficam guardados no Redis por 7 dias, de propósito, para
investigação.

### Tenho medo de mensagem duplicada

Não acontece. Cada envio grava uma `idempotencyKey` `UNIQUE` no Postgres
**antes** de chamar o WhatsApp. Um retry colide na constraint e aborta.

Testado na Fase 1 (3 jobs com a mesma chave → 1 execução) e de novo na
Fase 4, com 10 enfileiramentos concorrentes da mesma campanha → 1 linha.

A gravação é `INSERT` direto com captura de `P2002`, **nunca**
`findUnique` seguido de `create`: esse par não é atômico e, sob
concorrência, as duas chamadas leem "não existe" antes de qualquer uma
gravar.

---

## WhatsApp

### Configurei tudo e mesmo assim nada é enviado

É o esperado. O envio real está travado no **código**, não no `.env`:

```ts
// packages/integrations/src/whatsapp/guarda-envio.ts
export const FASE_PERMITE_ENVIO_REAL = false;
```

Nem `WHATSAPP_MODE=live` destrava. Isso é deliberado: uma variável de
ambiente cai com um `export` errado; uma constante no código exige um
commit. Ver [WHATSAPP.md](WHATSAPP.md).

### O canal não conecta / fica em INICIALIZANDO

1. **O worker está rodando?** É ele que abre o navegador, não a API.
2. **`WHATSAPP_CANAL=whatsapp-web`?** O padrão é `simulado`, que não
   conecta em lugar nenhum de propósito.
3. **`CHROME_PATH` aponta para um Chrome existente?** Este projeto
   **não** baixa Chromium (são ~300 MB), então o caminho é obrigatório.

### O QR não aparece

O QR só existe enquanto o estado é `AGUARDANDO_QR`, vale ~60 segundos e
só é carregado quando você clica em "Mostrar QR Code" — ele é uma
credencial de acesso, não fica sendo buscado em segundo plano.

Se expirou, clique em **Atualizar**.

### O dashboard diz "conectado" mas nada chega

Não deveria acontecer: se o worker parar de publicar estado por mais de
90 segundos, a API passa a responder `DESCONECTADO` em vez de repetir o
último retrato. Se você vê "conectado" e nada chega, confira em
`/api/canal/saude` o campo `seconds_since_last_event`.

### Mandei a mesma mensagem de teste e ela não foi processada

A idempotência está funcionando. Jobs concluídos ficam retidos 24h no
Redis, e o `jobId` deriva do `provider_message_id` — reusar um id de
ontem faz a mensagem ser descartada como duplicata. Use um id novo.

### Como testo o fluxo sem enviar nada?

É exatamente para isso que o dry-run existe. Em modo simulação o sistema
percorre campanhas, delays, regras, tarefas e notificações inteiras —
apenas registrando `SIMULAÇÃO — mensagem seria enviada para <telefone>` em
vez de enviar.

Para conferir que nada saiu:

```sql
SELECT status, dry_run, COUNT(*)
FROM outbound_messages
GROUP BY status, dry_run;
```

Nesta fase o esperado é `SIMULADA | true | N`. Qualquer `ENVIADA` seria
sinal de alarme. Detalhes em [FILA.md](FILA.md).

### A campanha está ativa mas a fila não anda

Confira, nesta ordem:

1. **O worker está rodando?** É ele que tem o despachante. Sem `pnpm
   dev:worker` as mensagens ficam `AGENDADA` para sempre.
2. **Já chegou o horário?** A coluna `scheduled_at` manda. O despachante
   varre a cada 15 segundos.
3. **Está dentro da janela?** Fora de `horarioInicio`–`horarioFim` ou
   num dia não permitido, as mensagens são **adiadas** em 15 minutos —
   o log do worker mostra `adiadas: N`.
4. **O limite diário estourou?** Elas são adiadas para o dia seguinte.
5. **A campanha continua `ATIVA`?** Pausar cancela o que não saiu.

### Um lead ficou travado e não sai do lugar

Provavelmente está em `AGUARDANDO_INTERVENCAO`: o sistema parou de
propósito e **não vai retomar sozinho**. Ele aparece no topo do
dashboard, em "Precisa da sua atenção".

Abra o lead e use o bloco **Aguardando você** para registrar o que
aconteceu e escolher o próximo status. Detalhes em
[INTERVENCAO.md](INTERVENCAO.md).

### Marquei opt-out sem querer

Dá para reverter, mas exige confirmação e justificativa, e o motivo
fica registrado no histórico do lead. O lead volta como `PAUSADO`, nunca
direto para a campanha — retomar o envio automático é um segundo ato
consciente.

### Os testes apagaram meus leads

Sim, e isso é esperado: `tests/api.test.ts`, `tests/campanhas-api.test.ts`
e `tests/intervencao-api.test.ts` rodam contra o banco apontado por
`DATABASE_URL` e limpam leads, campanhas e tarefas entre os testes. Os
specs E2E fazem o mesmo.

Usuário, sessões, templates, dicionário e configurações **não** são
apagados — o login e o motor de regras continuam valendo.

Se quiser preservar dados de trabalho, aponte `DATABASE_URL` para um
banco separado antes de rodar `pnpm test`.

### (Fase 8) Pede QR Code toda vez

A pasta `WHATSAPP_SESSION_PATH` não está persistindo. Confira se ela existe
e se o processo tem permissão de escrita.

### (Fase 8) Medo de o número ser bloqueado

Riscos reais e as mitigações já previstas no sistema:

- use um **chip dedicado**, nunca seu número pessoal;
- mantenha os delays aleatórios (3–4 min entre mensagens, 60–180s entre
  leads);
- mantenha o limite diário baixo no começo (o padrão é 50);
- respeite o opt-out — ele é definitivo e tem prioridade máxima nas regras;
- valide tudo em dry-run antes de ligar o `live`.

---

## Gemini / IA

### Como sei se minha chave funciona?

```powershell
pnpm ia:testar
```

Faz **uma** chamada de verdade ao Gemini com um cenário fabricado. Não toca
no banco, não cria lead, não envia nada — rodar dez vezes não muda nada no
sistema. A chave nunca aparece na tela; o script só mostra o tamanho dela.

Toda a suíte de testes usa um analisador **falso**, de propósito. Então
`pnpm ia:testar` é o único lugar onde a chave real é exercitada.

### `pnpm ia:testar` falhou — devo trocar a chave?

Depende do que ele imprimiu. O script separa três casos, e só o primeiro
tem a ver com a sua chave:

| O que aparece | O que é | O que fazer |
|---|---|---|
| A mensagem da API (ex.: `API key not valid (HTTP 400)`) | A chamada saiu e o Google recusou | Gere outra chave, confira `GEMINI_MODEL`, confira internet/proxy |
| `A chave FUNCIONA — a chamada foi e voltou` | Chegou resposta, mas fora do formato | Confira `GEMINI_MODEL`; costuma ser modelo trocado |
| `Isto e um DEFEITO DO PROSPECTOR, nao da sua chave` | Quebrou no nosso código, antes da rede | **Não troque a chave.** Mande as linhas de pilha que ele imprime |

Antes de gastar a chamada, o script também confere o **formato** da chave —
sem imprimir nada do conteúdo dela. Uma chave do AI Studio tem **39
caracteres** e começa com **`AIza`**. Se a sua não tiver essa forma, ele
diz o motivo: aspas no `.env`, o `GEMINI_API_KEY=` colado junto, a chave
colada duas vezes, um token OAuth (`ya29.…`) ou um JSON de conta de
serviço no lugar da API key. Todos esses produzem o mesmo
`API key not valid` genérico do Google.

O terceiro caso já aconteceu de verdade: o contexto fabricado do script
ficou sem um campo que o `ContextoCadencia` havia ganhado, e `montarPrompt`
estourou com `Cannot read properties of undefined (reading 'length')` —
antes de qualquer chamada sair. O script, na época, sugeria trocar uma
chave que estava perfeita. Hoje `pnpm test` e `pnpm typecheck` pegam isso
antes de você.

### A IA está ligada mas nada muda no comportamento

Confira `AI_ANALYSIS_ONLY` no `.env`:

- `true` → **modo sombra**: a IA opina, a decisão é gravada em
  `ai_decisions`, e quem comanda continua sendo o motor determinístico.
- `false` → a IA comanda a cadência, sempre atrás da guarda.

`pnpm ia:testar` imprime esse valor logo no começo.

### A IA falhou e a cadência parou

Não para. Quando a análise falha — rede, prazo, JSON inválido — o motor
determinístico assume. E o fallback **nunca envia**: uma ação de envio
vira `CREATE_INTERVENTION`, que cai na sua mão. Ver `docs/IA-CADENCIA.md`.

---

## Frontend

### Página em branco

Abra o DevTools → Console. Se aparecer erro de módulo:
```powershell
pnpm install
pnpm dev:web
```

### Estilos não carregam

O Tailwind v4 usa o plugin do Vite. Pare o servidor e suba de novo — o
plugin não recarrega bem depois de mudanças em `index.css`.

---

## Ainda travado

Colete estas informações antes de pedir ajuda:

```powershell
node --version
pnpm --version
docker compose ps
curl http://localhost:3333/api/health
```

E os logs relevantes. Com `LOG_LEVEL=debug` no `.env` a saída fica bem mais
detalhada.
