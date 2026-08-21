# Variáveis de ambiente

Todas ficam no arquivo `.env` na raiz do projeto. Copie o `.env.example` e
ajuste.

> **Nenhuma API key externa é necessária — nem agora, nem no MVP completo.**
> Não existe integração com Anthropic, OpenAI, Gemini ou qualquer serviço de
> IA. Não existe API paga do WhatsApp. O único "segredo" é a senha do seu
> Postgres local, que só existe na sua máquina.

O processo **não sobe** com configuração inválida: `packages/config` valida
tudo com Zod no boot e falha com uma mensagem explicando o que está errado.
Descobrir que o `SESSION_SECRET` estava vazio no meio de uma campanha seria
muito pior.

---

## Banco de dados

| Variável | Padrão | Descrição |
|---|---|---|
| `POSTGRES_USER` | `prospector` | Usuário criado pelo Docker Compose |
| `POSTGRES_PASSWORD` | — | **Troque.** Senha do banco local |
| `POSTGRES_DB` | `prospector` | Nome do banco |
| `DATABASE_URL` | — | **Obrigatória.** String de conexão do Prisma |

⚠️ `DATABASE_URL` precisa conter exatamente o mesmo usuário, senha e banco
das três variáveis acima. É o erro de configuração mais comum.

---

## Redis

| Variável | Padrão | Descrição |
|---|---|---|
| `REDIS_HOST` | `localhost` | |
| `REDIS_PORT` | `6379` | |
| `REDIS_PASSWORD` | vazio | O Redis local não usa senha |

---

## API

| Variável | Padrão | Descrição |
|---|---|---|
| `API_PORT` | `3333` | |
| `API_HOST` | `127.0.0.1` | Só a própria máquina. **Não mude para `0.0.0.0`** sem entender que isso expõe o sistema na sua rede local |
| `SESSION_SECRET` | — | **Obrigatória, mínimo 32 caracteres.** Assina o cookie |
| `SESSION_TTL_DAYS` | `30` | Duração do login |
| `WEB_ORIGIN` | `http://localhost:5173` | Origem permitida no CORS |

Gerar um `SESSION_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Usuário inicial

Lidas **apenas** pelo `pnpm db:seed`.

| Variável | Padrão | Descrição |
|---|---|---|
| `SEED_USER_EMAIL` | `admin@local` | Seu login |
| `SEED_USER_NAME` | `Administrador` | |
| `SEED_USER_PASSWORD` | — | **Troque.** Sua senha |

Se o usuário já existir, o seed **não** altera a senha.

---

## WhatsApp

| Variável | Padrão | Descrição |
|---|---|---|
| `WHATSAPP_CANAL` | `simulado` | `simulado` não conecta; `whatsapp-web` conecta e recebe |
| `WHATSAPP_SESSION_PATH` | `./data/whatsapp` | Onde a sessão fica salva |
| `CHROME_PATH` | vazio | Caminho do Chrome. **Obrigatório** quando `WHATSAPP_CANAL=whatsapp-web` |

### O `WHATSAPP_MODE` foi removido

Existia uma variável que travava o envio do **sistema inteiro**. Ela saiu.

O motivo é o defeito que ela causava na prática: era invisível de dentro
do produto. Você desmarcava a simulação na campanha, reenfileirava, e
continuava sem sair nada — porque uma linha num arquivo de texto, lida só
no boot, dizia o contrário. Uma trava que não aparece na tela e não pode
ser desligada por ela não protege; ela faz o sistema parecer quebrado.

Se a linha ainda estiver no seu `.env`, pode apagar — ela é inerte.

### O que trava o envio hoje

| Barreira | Onde | Quem desliga |
|---|---|---|
| `FASE_PERMITE_ENVIO_REAL` | código | um commit |
| `Campaign.dryRun` | banco | a caixa "simulação" nas configurações |
| `OutboundMessage.dryRun` | banco | herdada da campanha no enfileiramento |

As três precisam estar baixas. Duas não bastam, e `avaliarGuardaEnvio`
acumula **todos** os motivos em vez de parar no primeiro — saber que são
duas levantadas, e não uma, é o que evita alguém baixar uma só e achar
que liberou.

**O padrão de `Campaign.dryRun` mudou para `false`.** Campanha nova nasce
enviando; simular passou a ser uma escolha explícita, visível na tela.

Em simulação, cada envio produz uma linha de log
`SIMULAÇÃO — mensagem seria enviada para <telefone>` e uma mensagem com
status `SIMULADA` no banco, que **não conta** no limite diário — senão
testar a campanha queimaria a cota do dia.

### Conectar e enviar continuam separados

`WHATSAPP_CANAL` decide se o sistema **conecta**. Quem decide se ele
**envia** é a campanha. Dá para conectar de verdade e receber mensagens
reais com todas as campanhas em simulação.

### Sobre a pasta da sessão

`WHATSAPP_SESSION_PATH` guarda as credenciais da sua conta do WhatsApp — é o
que evita escanear o QR Code toda vez. Está no `.gitignore` e **nunca pode
ser commitada**.

Se você trocar de computador, não copie essa pasta: escaneie o QR novamente.

---

## Logs

| Variável | Padrão | Descrição |
|---|---|---|
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `NODE_ENV` | `development` | `development` = logs coloridos; `production` = JSON |

Use `LOG_LEVEL=debug` para investigar problemas de fila e envio.

O logger tem `redact` configurado: senha, cookie, `Authorization`,
`SESSION_SECRET` e `DATABASE_URL` nunca aparecem no log, mesmo que alguém
logue o objeto de request inteiro por engano.

---

## Se um dia algo pedir uma credencial

Antes de qualquer integração que exija chave, você recebe:

```
SERVIÇO:
MOTIVO:
CREDENCIAL:
ONDE OBTER:
CUSTO:
ALTERNATIVA GRATUITA:
```

Nenhuma chave é inventada, nenhuma chave vai para o código, e nada é
implementado antes da sua aprovação.
