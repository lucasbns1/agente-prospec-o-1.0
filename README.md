# Prospector

Sistema local de prospecção comercial + CRM + automação de WhatsApp.

Roda inteiramente no seu computador. **Sem IA, sem serviços pagos, sem API key,
sem servidor externo.**

> **Status: Fase 1 (fundação) concluída.**
> A infraestrutura está de pé e testada. As funcionalidades de negócio —
> importação, CRM, campanhas, envio — entram nas fases seguintes.
> Veja [Roadmap](#roadmap).

---

## O que o sistema faz (visão completa)

1. Você captura estabelecimentos no Google Maps com o Instant Data Scraper
   e exporta um CSV/XLSX.
2. Importa o arquivo aqui. O sistema normaliza telefone, nome, endereço e URL.
3. Identifica quem **não tem site próprio** — Instagram e Facebook contam
   como "sem site".
4. Você revisa e seleciona os leads.
5. Cria uma campanha com várias mensagens configuráveis.
6. O sistema envia a MSG 1 e **aguarda a resposta**.
7. Classifica a resposta por **regras determinísticas** (nunca por IA).
8. Espera um delay aleatório de 3 a 4 minutos e envia a próxima mensagem.
9. Marca o lead como FRIO, MORNO ou QUENTE conforme a conversa evolui.
10. Cria tarefas e notificações quando você precisa intervir.

---

## Instalação rápida

Guia completo e específico para Windows 11 em **[docs/SETUP.md](docs/SETUP.md)**.

```bash
git clone <url-do-repo>
cd prospector

pnpm install

# Windows PowerShell:  Copy-Item .env.example .env
# Windows CMD:         copy .env.example .env
# Linux/macOS:         cp .env.example .env
cp .env.example .env
# Agora EDITE o .env: troque as senhas e gere o SESSION_SECRET.

docker compose up -d      # sobe PostgreSQL e Redis
pnpm db:migrate           # cria as tabelas
pnpm db:seed              # popula configurações e cria seu usuário

pnpm dev                  # sobe API + worker + frontend
```

Abra **http://localhost:5173** e entre com o e-mail e a senha que você
definiu em `SEED_USER_EMAIL` / `SEED_USER_PASSWORD`.

---

## Modo simulação (dry-run)

O sistema **nasce em dry-run** e permanece assim até você mudar
explicitamente. Nesse modo nada é enviado de verdade: o worker apenas
registra `SIMULAÇÃO — mensagem seria enviada para <telefone>`.

Isso existe para você exercitar campanhas, delays, regras e notificações
inteiras com o telefone desligado, antes de qualquer mensagem real sair.

Só um ato deliberado muda isso:

```env
WHATSAPP_MODE=live   # disponível a partir da Fase 8
```

Qualquer outro valor (`liv`, `true`, vazio, ausente) cai em dry-run —
um typo no `.env` não pode virar mensagem enviada por acidente.

---

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe API, worker e frontend juntos |
| `pnpm dev:api` / `dev:worker` / `dev:web` | Sobe um de cada vez |
| `pnpm test` | Testes unitários (Vitest) |
| `pnpm typecheck` | Verifica os tipos de todos os pacotes |
| `pnpm build` | Build de produção |
| `pnpm db:migrate` | Aplica migrations |
| `pnpm db:seed` | Popula configurações padrão |
| `pnpm db:studio` | Abre o Prisma Studio (inspeção visual do banco) |
| `pnpm db:reset` | **Apaga tudo** e recria o banco |
| `pnpm docker:up` / `docker:down` | Liga/desliga PostgreSQL e Redis |

---

## Arquitetura em uma imagem

```
                    FRONTEND
                React + Vite (5173)
                        |
                        v
                      API
              Node + Fastify (3333)
                        |
          +-------------+-------------+
          v             v             v
      PostgreSQL      Redis       (eventos SSE)
        Prisma        BullMQ            |
          ^             |               v
          |             v          navegador
          |          WORKER
          |             |
          |             v
          |     WhatsAppAdapter
          |             |
          |             v
          +----- whatsapp-web.js
                  (Fase 8)
```

Detalhes e justificativas em **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Instalação passo a passo no Windows 11 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Camadas, decisões técnicas e o porquê de cada uma |
| [docs/DATABASE.md](docs/DATABASE.md) | As 20 tabelas, campos, índices e constraints |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Cada variável do `.env` explicada |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | O que fazer quando algo não sobe |

---

## Roadmap

| Fase | Escopo | Status |
|---|---|---|
| 1 | Monorepo, banco, API, worker, filas, auth, SSE, dry-run | ✅ concluída |
| 2 | CRUD de leads + CRM | pendente |
| 3 | Importação CSV/XLSX + normalização | pendente |
| 4 | Filtro de site próprio | pendente |
| 5 | Campanhas e editor de mensagens | pendente |
| 6 | Motor de regras | pendente |
| 7 | BullMQ + delays + avanço de campanha | pendente |
| 8 | WhatsApp real (whatsapp-web.js) | pendente |
| 9 | Dashboard completo | pendente |
| 10 | Conversas, tarefas e notificações | pendente |
| 11 | Testes E2E (Playwright) | pendente |
| 12 | Integração do fluxo de captura | pendente |

---

## Princípios do projeto

- **Sem IA.** A classificação de respostas é determinística, por regras
  configuráveis no banco. Nenhuma API de IA participa do produto.
- **Sem custo.** Nenhum serviço pago, nenhuma API key, nenhuma hospedagem.
- **Nunca inventar dados.** Se o bairro não veio no arquivo, o campo fica
  vazio e a mensagem que depende dele não é enviada.
- **Nunca enviar duas vezes.** Idempotência garantida por constraint no
  banco, não por lógica de aplicação.
- **Nada de mensagem no código.** Textos, palavras-chave e delays vivem
  no banco e são editáveis por você.
