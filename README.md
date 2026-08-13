# Prospector

Sistema local de prospecção comercial + CRM + automação de WhatsApp.

Roda inteiramente no seu computador. **Sem IA, sem serviços pagos, sem API key,
sem servidor externo.**

> **Status: Fase 6A concluída.**
> Importação, CRM, motor de respostas, campanhas, fila, dashboard,
> tarefas, intervenção manual e **integração com o WhatsApp Web**
> (conexão + recebimento) funcionando.
>
> **Nenhuma mensagem é enviada.** O envio real está travado no código
> (`FASE_PERMITE_ENVIO_REAL = false`), não numa variável de ambiente —
> ver [docs/WHATSAPP.md](docs/WHATSAPP.md). Veja [Roadmap](#roadmap).

---

## O que o sistema faz (visão completa)

1. Você captura estabelecimentos no Google Maps com o Instant Data Scraper
   e exporta um CSV/XLSX.
2. Importa o arquivo aqui. O sistema normaliza telefone, nome, endereço e URL.
3. Identifica quem **não tem site próprio** — Instagram e Facebook contam
   como "sem site".
4. Você revisa e seleciona os leads.
5. Cria uma campanha com várias mensagens configuráveis.
6. O sistema monta a mensagem de cada lead com os dados dele, agenda o
   envio dentro da janela permitida e **aguarda a resposta**.
7. Recebe a resposta pelo WhatsApp Web e classifica por **regras
   determinísticas** (nunca por IA).
8. Espera um delay aleatório de 3 a 4 minutos e envia a próxima mensagem.
9. Marca o lead como FRIO, MORNO ou QUENTE conforme a conversa evolui.
10. Cria tarefas e notificações quando você precisa intervir, e mostra
    tudo isso no topo do dashboard — em ordem de urgência.

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
| `pnpm test` | Testes unitários e de API (Vitest) — 890 testes |
| `pnpm health` | Verifica API, banco, Redis, worker e canal |
| `pnpm auditoria` | Estado real do banco, incluindo `REAL_MESSAGES_SENT` |
| `pnpm simular <tel> "<texto>"` | Injeta uma mensagem recebida, sem celular |
| `pnpm test:e2e` | Testes E2E (Playwright) |
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
| [docs/IMPORTACAO.md](docs/IMPORTACAO.md) | Regra de site, deduplicação, normalização e mapeamento de colunas |
| [docs/MOTOR-REGRAS.md](docs/MOTOR-REGRAS.md) | Categorias, precedência, negação, confiança e as garantias de segurança |
| [docs/CAMPANHAS.md](docs/CAMPANHAS.md) | Estados, filtros, etapas, prévia e enfileiramento |
| [docs/MENSAGENS.md](docs/MENSAGENS.md) | Variáveis, fallbacks e a regra de nunca inventar |
| [docs/FILA.md](docs/FILA.md) | Despachante, agendamento, limites e as barreiras de dry-run |
| [docs/QUALIFICACAO.md](docs/QUALIFICACAO.md) | Bloqueado vs. não qualificado, critérios e motivos |
| [docs/DASHBOARD.md](docs/DASHBOARD.md) | "Precisa da sua atenção", métricas, tarefas e notificações |
| [docs/INTERVENCAO.md](docs/INTERVENCAO.md) | Assumir a conversa, mudar status, opt-out e o rastro de auditoria |
| [docs/WHATSAPP.md](docs/WHATSAPP.md) | Conexão, QR, os sete estados e as quatro barreiras contra envio real |
| [docs/CONVERSAS.md](docs/CONVERSAS.md) | Recebimento, identificação do lead, classificação e a caixa de entrada |
| [docs/VALIDACAO-6B.md](docs/VALIDACAO-6B.md) | Roteiro de validação com WhatsApp real, passo a passo |
| [docs/FASE-7-ENVIO-REAL-PLANO.md](docs/FASE-7-ENVIO-REAL-PLANO.md) | O que seria preciso para ligar o envio — **não implementado** |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Cada variável do `.env` explicada |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | O que fazer quando algo não sobe |

---

## Roadmap

| Fase | Escopo | Status |
|---|---|---|
| 1 | Monorepo, banco, API, worker, filas, auth, SSE, dry-run | ✅ concluída |
| 2 | Importação CSV/XLSX + CRM de leads | ✅ concluída |
| 3 | Motor de interpretação de respostas | ✅ concluída |
| 4 | Campanhas + qualificação + mensagem personalizada + fila | ✅ concluída |
| 5 | Dashboard + notificações + tarefas + intervenção manual | ✅ concluída |
| 6A | Integração WhatsApp Web: conexão + recebimento (sem envio) | ✅ concluída |
| 6B | Envio real — **não autorizado** | pendente |
| 7 | Automação completa das conversas | pendente |
| 8 | Automação completa das conversas | pendente |
| 9 | Dry-run completo | pendente |
| 10 | Testes de integração | pendente |
| 11 | Teste controlado real | pendente |
| 12 | Polimento, segurança e release | pendente |

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
