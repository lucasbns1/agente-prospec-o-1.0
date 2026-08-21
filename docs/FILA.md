# Fila de envio

Como uma mensagem sai do banco e — nesta fase — **não** chega ao
WhatsApp.

---

## As barreiras contra envio real

```
  campanha.dryRun = false   ─┐
  mensagem.dryRun = false   ─┴─→ envia de verdade

  qualquer uma levantada     ─→ simula
```

Mais `FASE_PERMITE_ENVIO_REAL`, no código, acima das duas.

É "E" para enviar e "OU" para simular. **Uma sozinha não libera nada.**

Havia uma terceira barreira aqui, `WHATSAPP_MODE`, que travava o sistema
inteiro por variável de ambiente. Foi removida: não aparecia em lugar
nenhum da interface e fazia campanha corretamente liberada parecer
quebrada.

Hoje as três estão levantadas. Além delas, o caminho de envio real
`throw`a explicitamente — falhar alto é melhor do que simular em
silêncio, porque simular em silêncio faria você achar que enviou.

A decisão vive em `decidirDryRun()`, uma função pura, com tabela verdade
completa em `tests/dry-run.test.ts`. Exatamente **uma** das doze
combinações envia de verdade.

---

## Estados de uma mensagem

| Estado | Significado |
|---|---|
| `PENDENTE` | Criada, sem horário definido |
| `AGENDADA` | Com `scheduledAt` no futuro |
| `PROCESSANDO` | Reservada por um worker |
| `SIMULADA` | Dry-run concluído — **estado terminal** |
| `ENVIADA` | Saiu de verdade |
| `BLOQUEADA` | Barrada por uma regra (com motivo) |
| `FALHOU` | Erro depois das tentativas |
| `CANCELADA` | Campanha pausada ou arquivada |

`SIMULADA` é terminal e **não conta** no limite diário nem nas métricas
de "mensagens enviadas". Se contasse, testar a campanha queimaria a cota
do dia.

---

## O despachante

Um poller no worker, a cada 15 segundos, com teto de 50 mensagens por
varredura.

### Por que poller e não `delay` do BullMQ

- Uma campanha pode agendar para daqui a dias; segurar isso no Redis por
  dias é frágil (aqui ele roda sem persistência).
- Se o worker estiver parado no momento do enfileiramento, os jobs
  simplesmente não existiriam.
- Assim o **banco** é a única fonte da verdade e o Redis é só
  transporte. Reiniciar o Redis não perde trabalho.

O teto de 50 também mantém a fila do Redis curta, para o espaçamento
entre envios continuar valendo como proteção anti-ban.

### O que ele decide

| Situação | Ação |
|---|---|
| Campanha não está `ATIVA` | `BLOQUEADA` / `CAMPANHA_PAUSADA` |
| Fora da janela de horário | **Adia** 15 min |
| Limite diário atingido | **Adia** para amanhã |
| Limite horário atingido | **Adia** 1 hora |
| Tudo certo | Vira job |

> Fora da janela **adia, nunca bloqueia**. Bloquear perderia o lead só
> porque a fila virou a noite.

---

## Revalidação no momento do envio

O worker **não confia** no que foi validado no enfileiramento. Uma
mensagem pode ter sido enfileirada horas antes; nesse intervalo o lead
pode ter pedido opt-out, a campanha pode ter sido pausada, a etapa pode
ter sido desativada.

Revalidado a cada envio: opt-out, status do lead, telefone presente,
campanha `ATIVA`, etapa ativa, texto não vazio.

---

## Idempotência em duas camadas

1. **Reserva por UPDATE condicional.** O worker só pega a mensagem se
   ela ainda estiver `PENDENTE`/`AGENDADA`. Dois workers competindo: um
   recebe `count: 1`, o outro `count: 0` e desiste. **O banco decide,
   não a aplicação.**
2. **`jobId` derivado do id da mensagem.** Se a varredura rodar duas
   vezes antes de o worker pegar o job, o BullMQ descarta o duplicado.

A camada 2 não substitui a 1 — ela soma.

> O `jobId` usa `-` e não `:` como separador: o BullMQ recusa
> dois-pontos em id customizado, porque ele mesmo usa `:` nas chaves do
> Redis.

---

## Concorrência 1, de propósito

O worker de outbound processa **uma mensagem por vez**. Não é limitação
— é o ponto. O espaçamento entre envios é a proteção anti-ban;
processar em paralelo anularia os delays calculados no agendamento.

---

## Limites e janela

| Configuração | Padrão |
|---|---|
| `limiteDiarioEnvios` | 50 |
| `limiteHorarioEnvios` | 10 |
| `horarioInicio` / `horarioFim` | 08:00 / 20:00 |
| `diasPermitidos` | seg–sex |
| `delayEntreLeadsMinSegundos` / `Max` | 60 / 180 |
| `delayMinSegundos` / `Max` (entre etapas) | 180 / 240 |

O primeiro disparo é **espalhado** entre os leads: 76 mensagens no mesmo
segundo é o padrão de disparo em massa que os antispam mais reconhecem.

O limite diário conta apenas `ENVIADA`. Falha não consome cota; retry
não duplica mensagem.

---

## Conferindo que nada saiu

```sql
SELECT status, dry_run, COUNT(*)
FROM outbound_messages
GROUP BY status, dry_run;
```

Nesta fase o resultado esperado é `SIMULADA | true | N`. Qualquer
`ENVIADA` seria um sinal de alarme.

Na interface: aba **Fila** da campanha, e o aviso permanente
**MODO SIMULAÇÃO — nada é enviado** na barra superior.
