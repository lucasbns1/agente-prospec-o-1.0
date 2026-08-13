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

### `WHATSAPP_MODE=live ainda não está disponível`

Correto — a integração real entra na **Fase 8**. Use `dry-run`.

O sistema lança esse erro de propósito em vez de cair silenciosamente em
simulação: você acharia que enviou mensagens que nunca saíram.

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

### Os testes apagaram meus leads

Sim, e isso é esperado: `tests/api.test.ts` e `tests/campanhas-api.test.ts`
rodam contra o banco apontado por `DATABASE_URL` e limpam leads e
campanhas entre os testes. Os specs E2E fazem o mesmo.

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
