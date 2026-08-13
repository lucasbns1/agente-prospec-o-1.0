# Instalação — Windows 11

Guia completo, do zero. Nenhuma etapa exige conta, cadastro, API key ou
cartão de crédito. Tudo gratuito.

---

## 1. O que instalar

### Node.js 20 ou superior
https://nodejs.org — baixe o instalador **LTS** e siga o padrão.

Confira no PowerShell:
```powershell
node --version    # precisa ser v20 ou maior
```

### pnpm
```powershell
npm install -g pnpm
pnpm --version
```

### Git
https://git-scm.com/download/win

### Docker Desktop
https://www.docker.com/products/docker-desktop

Na instalação, **deixe marcada a opção "Use WSL 2 based engine"**. Se o
Windows pedir para instalar o WSL2, aceite e reinicie.

Depois de instalar, **abra o Docker Desktop e espere ficar verde** no canto
inferior esquerdo. O Docker precisa estar rodando antes dos comandos abaixo.

### Google Chrome
https://www.google.com/chrome — necessário a partir da Fase 8, para o
WhatsApp. Pode instalar depois.

### Extensão Instant Data Scraper
Chrome Web Store, gratuita. Usada na captura (Fase 12).

---

## 2. Baixar o projeto

```powershell
cd $HOME\Documents
git clone <url-do-repositorio> prospector
cd prospector
```

---

## 3. Instalar as dependências

```powershell
pnpm install
```

Isso baixa tudo e compila os módulos nativos (Prisma e argon2). Demora
1 a 3 minutos na primeira vez.

---

## 4. Configurar o `.env`

```powershell
Copy-Item .env.example .env
notepad .env
```

Você **precisa** alterar três coisas:

**a) A senha do banco** — troque `troque_esta_senha` nos dois lugares. Os
valores têm que bater:
```env
POSTGRES_PASSWORD=minhaSenhaForte123
DATABASE_URL=postgresql://prospector:minhaSenhaForte123@localhost:5432/prospector?schema=public
```

**b) O segredo da sessão** — gere um valor aleatório:
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Cole o resultado em `SESSION_SECRET=`.

**c) Sua senha de login:**
```env
SEED_USER_EMAIL=seu@email.com
SEED_USER_PASSWORD=suaSenhaDeLogin
```

Confirme que o modo simulação está ligado:
```env
WHATSAPP_MODE=dry-run
```

Salve e feche.

> O `.env` está no `.gitignore` e nunca vai para o GitHub.

---

## 5. Subir o banco e o Redis

Com o Docker Desktop **aberto e rodando**:

```powershell
docker compose up -d
```

Confira:
```powershell
docker compose ps
```
Os dois containers devem aparecer como `running (healthy)`.

---

## 6. Criar as tabelas

```powershell
pnpm db:migrate
pnpm db:seed
```

O seed cria seu usuário e popula as configurações padrão: 4 domínios
sociais, 96 termos do motor de regras, delays de 3–4 minutos e o limite
diário de 50 mensagens. **Tudo editável depois.**

---

## 7. Rodar

```powershell
pnpm dev
```

Sobe os três processos juntos. Abra **http://localhost:5173** e entre com o
e-mail e a senha do `.env`.

Você deve ver:
- 🔴 WhatsApp desconectado (esperado — a conexão real é a Fase 8)
- 🧪 **MODO SIMULAÇÃO — nada é enviado**
- 13 cards de métricas, todos zerados
- O funil vazio

Para parar: `Ctrl+C`.

> **O worker não é opcional.** É ele que carrega o despachante da fila.
> Sem ele as mensagens ficam `AGENDADA` no banco e nada acontece. O
> `pnpm dev` sobe os três processos; se rodar separado, não esqueça o
> `pnpm dev:worker`.

---

## 8. Rodar os testes (opcional)

```powershell
pnpm test        # unitários e de API
pnpm test:e2e    # ponta a ponta, exige o `pnpm dev` rodando
```

> **Atenção:** os testes rodam contra o banco de `DATABASE_URL` e
> **apagam leads e campanhas**. Usuário, configurações, templates e
> dicionário são preservados. Se tiver dados de trabalho no banco,
> aponte `DATABASE_URL` para outro banco antes de testar.

---

## Problemas comuns no Windows

### "docker: error during connect"
O Docker Desktop não está rodando. Abra-o e espere ficar verde.

### "Port 5432 is already allocated"
Você já tem PostgreSQL instalado nativamente na máquina, ocupando a porta.

Duas saídas:
1. Pare o serviço nativo: `Services.msc` → PostgreSQL → Parar.
2. Ou mude a porta no `docker-compose.yml` para `127.0.0.1:5433:5432` e
   ajuste `DATABASE_URL` para `...@localhost:5433/...`.

### "Cannot find module '@prisma/client'"
```powershell
pnpm db:generate
```

### `pnpm install` reclama de scripts bloqueados
Já está resolvido pelo `onlyBuiltDependencies` no `pnpm-workspace.yaml`. Se
ainda aparecer:
```powershell
pnpm approve-builds
```

### Erro de execução de scripts no PowerShell
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### Firewall do Windows pedindo permissão
Pode negar. O sistema só escuta em `127.0.0.1` (a própria máquina) e não
precisa de acesso à rede.

### Antivírus reclamando do Chromium (a partir da Fase 8)
O `whatsapp-web.js` baixa um Chromium próprio. Alguns antivírus marcam isso
como suspeito. Libere a pasta do projeto.

---

## Rotina do dia a dia

```powershell
cd $HOME\Documents\prospector
docker compose up -d     # se o Docker foi reiniciado
pnpm dev
```

Ao terminar:
```powershell
# Ctrl+C para parar o pnpm dev
docker compose down      # opcional; os dados ficam salvos nos volumes
```

---

## Backup

Seus dados vivem no volume Docker `prospector_postgres_data`. Para gerar um
backup:

```powershell
docker exec prospector-postgres pg_dump -U prospector prospector > backup.sql
```

Para restaurar:
```powershell
Get-Content backup.sql | docker exec -i prospector-postgres psql -U prospector -d prospector
```

> `docker compose down -v` **apaga todos os dados**. Use `down` sem o `-v`
> no dia a dia.
