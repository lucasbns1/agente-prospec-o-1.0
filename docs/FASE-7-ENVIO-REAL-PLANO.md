# Fase 7 — Envio real: plano

> **Este documento não habilita nada.** Ele descreve o que seria feito,
> para que a decisão de ligar o envio seja tomada com o mapa na mão — e
> não no meio da execução.
>
> Nada aqui foi implementado. `FASE_PERMITE_ENVIO_REAL` continua `false`.

---

## 1. O que seria alterado

### Uma linha de código

`packages/integrations/src/whatsapp/guarda-envio.ts`

```diff
- export const FASE_PERMITE_ENVIO_REAL = false as boolean;
+ export const FASE_PERMITE_ENVIO_REAL = true as boolean;
```

Isso e mais nada. A trava foi desenhada para que ligá-la seja um commit
identificável, com autor e data — não uma mudança de configuração que
some no histórico.

### Três chaves, em três lugares diferentes

| # | Barreira | Onde | Quem muda |
|---|---|---|---|
| 1 | `FASE_PERMITE_ENVIO_REAL` | código | commit |
| 2 | `WHATSAPP_MODE=live` | `.env` | você |
| 3 | `Campaign.dryRun = false` | banco | por campanha |
| 4 | `OutboundMessage.dryRun = false` | banco | herdado da campanha |

**As quatro precisam cair juntas.** Ligar a 1 e a 2 e esquecer a 3
significa que nada sai — de propósito. Cada campanha precisa ser
liberada individualmente.

### O que precisa ser implementado (não é só destravar)

Estes pontos ficaram **conscientemente** incompletos na Fase 6A, porque
existiriam só para serem bloqueados:

| Item | Onde | Estado |
|---|---|---|
| Enfileirar `ENVIAR_TEMPLATE` e `AVANCAR_ETAPA` | `worker/services/inbound.ts` | hoje só registra no histórico |
| Renderizar o template da resposta | reusa `renderizarMensagem` | pronto, não ligado |
| Marcar `enviadaEm` no envio real | `worker/workers/outbound.ts` | caminho existe, inalcançável |
| Consumir `message_ack` | `processarConfirmacaoEntrega` | **pronto e testado** (20 testes) |

---

## 2. Proteções que já existem

Nada abaixo precisa ser construído — só verificado.

### Idempotência

`sha256(leadId | campaignId | campaignStepId)` numa coluna `UNIQUE`.
A gravação é `INSERT` direto com captura de `P2002`, **nunca**
`findUnique` seguido de `create` — esse par não é atômico e, sob
concorrência, as duas chamadas leem "não existe" antes de qualquer uma
gravar.

Verificado com 10 enfileiramentos concorrentes → 1 linha.

### Reserva por UPDATE condicional

O worker só pega a mensagem se ela ainda estiver `PENDENTE`/`AGENDADA`.
Dois workers competindo: um recebe `count: 1`, o outro `count: 0` e
desiste. **O banco decide, não a aplicação.**

### Revalidação no momento do envio

O worker **não confia** no que foi validado no enfileiramento. Uma
mensagem pode ter sido enfileirada horas antes. Revalidado a cada envio:

- opt-out do lead
- status do lead (`OPT_OUT`, `AGUARDANDO_INTERVENCAO`)
- telefone presente
- campanha ainda `ATIVA`
- etapa ainda ativa
- texto não vazio

### Rate limiting

| Configuração | Padrão | Onde |
|---|---|---|
| Limite diário | 50 | `Campaign.limiteDiarioEnvios` |
| Limite horário | 10 | `Campaign.limiteHorarioEnvios` |
| Intervalo entre leads | 60–180s | `delayEntreLeadsMin/MaxSegundos` |
| Intervalo entre etapas | 180–240s | `delayMin/MaxSegundos` |

O limite diário conta apenas `ENVIADA`. Falha não consome cota;
`SIMULADA` também não — senão testar queimaria o limite do dia.

O despachante processa com **concorrência 1**: o espaçamento entre
envios é a proteção, e paralelizar anularia os delays.

### Janela de envio

`horarioInicio`–`horarioFim` e `diasPermitidos` por campanha (padrão
08:00–20:00, seg–sex).

Fora da janela a mensagem é **adiada**, nunca bloqueada — bloquear
perderia o lead só porque a fila virou a noite.

### Opt-out

- Excluído em `montarWhere`, que roda antes de qualquer filtro seu.
  Não há flag para desativar.
- Registrar opt-out **cancela a fila** do lead.
- Revalidado no envio: um opt-out que chegou depois do enfileiramento
  ainda bloqueia.
- Reverter exige confirmação explícita + justificativa, e devolve o lead
  como `PAUSADO` — nunca direto para a campanha.

### Intervenção manual

Mover para `PAUSADO`, `ENCERRADO`, `CLIENTE` ou
`AGUARDANDO_INTERVENCAO` cancela a fila. Sem isso, o sistema mandaria a
próxima etapa por cima da conversa que você assumiu.

---

## 3. Como desligar imediatamente

Em ordem de rapidez:

| Quando | O quê | Efeito |
|---|---|---|
| **Agora** | `Ctrl+C` no worker | Para tudo. A fila fica no banco, intacta. |
| Segundos | Pausar a campanha na tela | Cancela o que não saiu daquela campanha |
| Segundos | `WHATSAPP_MODE=dry-run` + reiniciar worker | Volta a simular |
| Um commit | `FASE_PERMITE_ENVIO_REAL = false` | Trava definitiva |

```sql
-- Freio de emergência global, sem reiniciar nada:
UPDATE campaigns SET status = 'PAUSADA' WHERE status = 'ATIVA';
UPDATE outbound_messages SET status = 'CANCELADA', erro = 'parada manual'
WHERE status IN ('PENDENTE', 'AGENDADA');
```

> Matar o worker é o freio mais rápido e **não perde trabalho**: o banco
> é a fonte da verdade da fila, o Redis é só transporte.

---

## 4. Como detectar falhas

```bash
pnpm health       # a stack está de pé?
pnpm auditoria    # o que realmente aconteceu
```

Sinais de problema, em ordem de gravidade:

| Sinal | O que provavelmente é |
|---|---|
| `ENVIADA` alto, `ENTREGUE` baixo | **O número está sendo bloqueado** |
| Muitas mensagens `FALHOU` | Sessão caiu ou número banido |
| Canal em `RECONECTANDO` repetido | Instabilidade ou bloqueio em curso |
| Canal `FALHOU` | Sessão inválida — exige QR novo |
| `seconds_since_last_event` alto | Worker travado |
| Muitos `DESCONHECIDO` | Dicionário desatualizado para o público |

A diferença entre **ENVIADA** e **ENTREGUE** é a principal pista de que
um número está sendo bloqueado. É para isso que o `message_ack` existe.

---

## 5. Como cancelar uma campanha

Pausar na tela já:

1. muda o status para `PAUSADA`;
2. cancela toda mensagem `PENDENTE`/`AGENDADA` daquela campanha;
3. impede o despachante de criar novos jobs.

Mensagens já entregues não voltam atrás — por isso o limite diário baixo
importa no começo.

---

## 6. Monitorar o número

Antes de ligar, e todo dia depois:

- [ ] Chip **dedicado**, nunca o pessoal
- [ ] Número "aquecido": use-o normalmente por alguns dias antes
- [ ] Comece com limite diário **muito abaixo** de 50 (sugestão: 5–10)
- [ ] Acompanhe a razão entregue/enviada em `pnpm auditoria`
- [ ] Se as entregas caírem, **pare** e investigue antes de continuar
- [ ] Responda quem responde: conta que só dispara é a que mais cai

> Nenhuma dessas medidas é para "escapar de detecção". São controle de
> volume e reciprocidade — que é o que diferencia prospecção de spam.

---

## 7. Rollback

| Situação | Ação |
|---|---|
| Deu ruim no meio | `Ctrl+C` no worker + o SQL da seção 3 |
| Quer voltar à Fase 6A | `git revert` do commit que ligou a guarda |
| Sessão comprometida | Apagar `WHATSAPP_SESSION_PATH` e reescanear |
| Número bloqueado | Trocar o chip; a sessão antiga não serve |

**Não há rollback para mensagem entregue.** É o motivo de tudo acima.

---

## 8. Roteiro sugerido para a Fase 7

1. Rodar o roteiro de [VALIDACAO-6B.md](VALIDACAO-6B.md) até o fim, com
   tudo passando.
2. Implementar os quatro itens da seção 1 ("o que precisa ser
   implementado"), **ainda com a guarda travada**.
3. Testes novos: envio real simulado ponta a ponta, `enviadaEm`
   preenchido, ack chegando na mensagem certa.
4. Ligar a guarda num commit isolado, que não faça mais nada.
5. **Um lead só**, que seja você mesmo, num segundo aparelho.
6. Conferir `pnpm auditoria`: `REAL_MESSAGES_SENT = 1`.
7. Cinco leads conhecidos, com limite diário 5.
8. Só então avaliar volume.

Cada passo com autorização explícita. O passo 5 é o primeiro em que uma
mensagem sua chega a alguém — e ele deveria chegar a você.

---

## 9. O que este plano não cobre

- **LGPD**: base legal para contato, registro de consentimento e prazo
  de retenção. O opt-out está implementado; a política, não.
- **Termos do WhatsApp**: automação por `whatsapp-web.js` não é oficial.
  Existe a API oficial (paga) como alternativa — nunca foi discutida.
- **Escala**: nada aqui foi pensado para milhares de mensagens/dia.
