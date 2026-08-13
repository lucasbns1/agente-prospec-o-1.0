# Arquitetura

Cada decisão abaixo vem com o motivo. Onde havia duas opções, explico por que
escolhi uma.

---

## Visão geral

```
   NAVEGADOR
       |
       |  HTTP + SSE
       v
+-------------------+
|   apps/web        |  React + Vite + Tailwind + shadcn/ui
|   porta 5173      |  Zero regra de negócio. Só UI.
+-------------------+
       |
       |  /api/*  (proxy do Vite -> mesma origem)
       v
+-------------------+
|   apps/api        |  Fastify + Zod + Prisma
|   porta 3333      |  HTTP, validação, auth. Publica jobs.
+-------------------+
       |                          ^
       |                          | pub/sub (eventos)
       v                          |
+------------+   +--------+   +-------------------+
| PostgreSQL |   | Redis  |<->|  apps/worker      |
|  (Prisma)  |<->| BullMQ |   |  Processo separado |
+------------+   +--------+   +-------------------+
                                       |
                                       v
                              +-------------------+
                              | WhatsAppAdapter   |
                              +-------------------+
                                       |
                                 whatsapp-web.js
                                    (Fase 8)
```

---

## Camadas e a regra que as separa

```
apps/web          -> só UI e chamadas HTTP
apps/api          -> HTTP, validação Zod, autenticação
apps/worker       -> executa jobs das filas
packages/domain   -> REGRAS DE NEGÓCIO PURAS (sem I/O)
packages/database -> Prisma: schema, client, migrations
packages/integrations -> WhatsAppAdapter, parsers de CSV/XLSX
packages/shared   -> tipos e schemas Zod compartilhados
packages/config   -> validação das variáveis de ambiente
```

**A regra que isso protege:** `packages/domain` não importa Prisma, não
importa Fastify, não importa `whatsapp-web.js`, não lê arquivo e não acessa
rede. Recebe dados, devolve dados.

É isso que torna possível testar *"MSG 2 + resposta positiva deve marcar
QUENTE, criar tarefa de preview, notificar e parar a sequência"* no Vitest —
sem banco, sem Redis e sem telefone conectado.

---

## Decisões técnicas

### 1. Monorepo com pnpm workspaces, sem Turborepo

pnpm já resolve o compartilhamento de código entre api/worker/web e faz uma
única instalação de dependências. Turborepo só ganharia relevância com build
lento, que não é o caso. **Menos dependência externa.**

### 2. Worker em processo separado da API

A partir da Fase 8 o worker carrega um Chromium inteiro (o `whatsapp-web.js`
roda sobre o WhatsApp Web). Se ele travar ou vazar memória, **não pode levar
junto a API e o Dashboard**. Separando, o CRM continua utilizável mesmo com
o WhatsApp fora do ar.

### 3. SSE em vez de WebSocket

O tráfego é ~99% servidor → cliente (chegou resposta, lead esquentou, tarefa
criada). SSE é HTTP puro, reconecta sozinho por comportamento nativo do
navegador e não exige biblioteca nenhuma dos dois lados — `EventSource` já
existe no browser e o Fastify escreve o stream direto.

WebSocket só se justificaria com tráfego bidirecional intenso, que este
sistema não tem. **Escolhi a opção mais simples, conforme a regra 51.**

Um único endpoint (`GET /api/events`) transmite todos os tipos de evento; o
cliente usa o campo `tipo` para decidir quais queries do TanStack Query
invalidar.

### 4. Ponte worker → API via Redis pub/sub

O worker roda em outro processo e não alcança as conexões SSE da API.
A ponte é um canal pub/sub do Redis — que **já está no projeto** por causa do
BullMQ, então não adiciona nenhuma dependência nova.

```
worker --publish--> Redis --subscribe--> API --SSE--> navegador
```

### 5. Sessão em banco, não JWT

Com sessão em tabela, deslogar é apagar uma linha. Com JWT seria preciso
manter uma blacklist — mais complexidade, zero benefício para um sistema
local monousuário.

O cookie guarda um token aleatório de 32 bytes; o banco guarda apenas o
SHA-256 dele. Quem ler a tabela `sessions` não consegue montar um cookie
válido.

### 6. `secure: false` no cookie

O sistema roda em `http://localhost`. Um cookie `secure` simplesmente não
seria enviado e o login nunca funcionaria. Se algum dia o sistema for
exposto por HTTPS, o flag precisa ser ligado.

### 7. Proxy do Vite para a API

O Vite encaminha `/api/*` para `127.0.0.1:3333`. Assim o navegador enxerga
frontend e API na **mesma origem**, o que resolve dois problemas de uma vez:
não precisamos afrouxar o CORS, e o cookie `sameSite=lax` viaja normalmente.

### 8. Idempotência no banco, não na aplicação

O BullMQ **não** garante execução única — ele garante entrega *ao menos* uma
vez, e faz retry em caso de falha. A garantia de "nunca enviar a mesma
mensagem duas vezes" vem de uma constraint `UNIQUE` no Postgres:

1. o worker grava `idempotencyKey` **antes** de chamar o WhatsApp;
2. se um retry rodar a mesma unidade de trabalho, o INSERT colide;
3. o job aborta em vez de reenviar.

Testado na Fase 1: 3 jobs enfileirados com a mesma chave → 1 execução, 1
linha no banco.

### 9. O `WhatsAppAdapter` é a única fronteira com o whatsapp-web.js

Nenhum outro arquivo do projeto — nem API, nem worker, nem domain — importa
essa biblioteca.

**Por que importa aqui especificamente:** `whatsapp-web.js` é uma biblioteca
não-oficial que automatiza o WhatsApp Web. Atualizações do WhatsApp quebram
ela periodicamente. Quando isso acontecer, o conserto precisa caber em um
arquivo — e não virar uma caça a chamadas espalhadas pelo sistema.

O mesmo isolamento permite trocar de tecnologia depois sem reescrever CRM,
campanhas e regras.

### 10. Dry-run é o padrão, e falhar é melhor que simular em silêncio

`resolverModo()` só devolve `live` para o valor exatamente `"live"`.
Qualquer outra coisa cai em dry-run.

E pedir `WHATSAPP_MODE=live` antes da Fase 8 lança um erro explícito em vez
de cair silenciosamente em simulação — porque o usuário acharia que enviou
mensagens que nunca saíram.

### 11. Docker Compose em vez de instalação nativa

`docker compose up -d` é um comando só, idêntico em Windows/Mac/Linux,
versionado no repo, sem poluir a máquina e fácil de destruir. O caminho
nativo continua documentado no SETUP.md para quem preferir.

Ambos os serviços fazem bind explícito em `127.0.0.1` — nada na sua rede
local alcança o banco.

### 12. Redis com `appendonly yes`

Garante que os jobs pendentes sobrevivam a um restart do computador
(requisito 48). Sem isso, desligar a máquina no meio de uma campanha perderia
os envios agendados.

---

## Fluxo de uma campanha

O trecho até a fila **já existe** (Fase 4). Do "lead responde" em diante
entra nas fases seguintes.

```
Você ativa a campanha e clica ENFILEIRAR
        |
        v
API: filtros (SQL) -> qualificação -> render -> agendamento
        |
        +-- bloqueado? --> linha BLOQUEADA com motivo tipado. Não vira job.
        |
        v
   INSERT em outbound_messages com idempotency_key UNIQUE
        |                          <-- a garantia de não duplicar
        v
   ... a linha espera o horário dela ...
        |
        v
DESPACHANTE (worker, a cada 15s): "está na hora?"
        |
        +-- campanha pausada?   --> BLOQUEADA
        +-- fora da janela?     --> ADIA 15 min (nunca bloqueia)
        +-- limite atingido?    --> ADIA
        |
        v
   vira job na fila outbound_send
        |
        v
WORKER: reserva por UPDATE condicional (o banco decide quem pega)
        |
        v
   REVALIDA todos os bloqueios AGORA
        |    (a mensagem pode ter sido enfileirada horas atrás)
        |
        +-- lead pediu opt-out no meio? --> BLOQUEADA
        |
        v
   WhatsAppAdapter.sendMessage()
        |
        +-- dry-run? --> loga "SIMULAÇÃO", status SIMULADA, não conta no limite
        |
        v
   status ENVIADA, publica evento -> SSE -> Dashboard atualiza
        |
        v
   LeadCampaign: AGUARDANDO_RESPOSTA
        |
        v
   ... lead responde ...
        |
        v
WORKER: process_incoming_message
        |
        v
   Motor de regras classifica (determinístico, sem IA)
        |
        +-- DESCONHECIDO --> NÃO avança. Cria tarefa + notifica + ATENÇÃO.
        +-- OPT_OUT      --> para tudo, marca opt-out definitivo
        +-- FALAR_DEPOIS --> snooze (3 dias), status AGENDADO
        +-- POSITIVO     --> aplica a regra da etapa
        |
        v
   Delay aleatório de 3 a 4 minutos  <-- nunca fixo
        |
        v
   Próxima mensagem
```

**Ponto crítico:** a etapa pode ter `enviarAutomaticamente = false`. É assim
que a MSG 3 funciona no seu roteiro — ela só sai depois que você criar o
preview e clicar em "liberar próxima mensagem". O sistema **nunca** cria o
preview sozinho.

---

## O que a Fase 1 entregou

| Componente | Estado |
|---|---|
| Monorepo pnpm | ✅ funcionando |
| PostgreSQL + Prisma, 22 tabelas | ✅ migration aplicada e testada |
| Redis + BullMQ, 8 filas | ✅ registradas, esteira testada |
| API Fastify | ✅ health, auth, SSE, dashboard, settings |
| Autenticação Argon2 + cookie | ✅ testada (login, 401, sessão) |
| SSE | ✅ testado (heartbeat recebido) |
| Worker | ✅ testado, idempotência comprovada |
| WhatsAppAdapter | ✅ interface + fake dry-run |
| Frontend | ✅ login, dashboard, 12 métricas, funil, configurações |
| Testes | ✅ 32 passando |

**Ainda não existe:** integração real com o WhatsApp, automação completa
das conversas, dashboard de intervenção. São as Fases 5 a 12.

As Fases 2, 3 e 4 acrescentaram, respectivamente: importação e CRM;
motor de regras determinístico; e campanhas, qualificação, mensagem
personalizada e fila de envio — esta última documentada em
[CAMPANHAS.md](CAMPANHAS.md), [MENSAGENS.md](MENSAGENS.md),
[FILA.md](FILA.md) e [QUALIFICACAO.md](QUALIFICACAO.md).
