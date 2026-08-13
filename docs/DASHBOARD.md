# Dashboard, tarefas e notificações

O que exige sua ação vem antes dos números.

---

## Precisa da sua atenção

A primeira seção da tela, e a única que exige ação. A ordem dela é uma
decisão de produto, não de layout: um dashboard cheio de métricas é
bonito e inútil se o lead quente que respondeu ontem continua esperando.

### Os seis motivos

| # | Motivo | Ação | De onde vem |
|---|---|---|---|
| 1 | `INTERVENCAO_NECESSARIA` | Responder manualmente | Lead em `AGUARDANDO_INTERVENCAO` |
| 2 | `LEAD_QUENTE` | Entrar em contato agora | Temperatura `QUENTE`, ainda não cliente |
| 3 | `PEDIDO_PREVIEW` | Criar o preview | Tarefa `CRIAR_PREVIEW` aberta |
| 4 | `PEDIDO_PRECO` | Enviar o orçamento | Última resposta classificada como `PRECO` |
| 5 | `TAREFA_ATRASADA` | Concluir a tarefa atrasada | Tarefa com prazo vencido |
| 6 | `ERRO_ENVIO` | Verificar o erro de envio | Mensagem `FALHOU` |

`INTERVENCAO_NECESSARIA` é o número 1 porque é a **única** situação em
que o lead está esperando e ninguém está respondendo — nem o sistema
(que não entendeu) nem você (que não sabe). Nas outras, alguém está
cuidando.

### Um lead aparece uma vez só

O mesmo lead pode se qualificar por vários motivos ao mesmo tempo:
quente **e** com intervenção pendente **e** com tarefa atrasada. Listar
três vezes transformaria a seção em ruído e faria parecer que há três
problemas quando há um lead.

Ele entra uma vez, com o motivo mais urgente, e um contador
(`+N motivo(s)`) mostra que há mais — a informação não se perde.

### Empate

Dentro da mesma urgência, **quem espera há mais tempo vem primeiro**.
Sem isso, um lead antigo ficaria no fim da lista para sempre, empurrado
por cada caso novo.

### Onde isso mora

`packages/domain/src/dashboard/atencao.ts` — função pura. O serviço
(`apps/api/src/services/dashboard-service.ts`) só busca; a ordem e a
deduplicação são decididas no domínio, onde dá para testar sem banco.

Cada uma das seis consultas tem teto próprio. Sem teto, um banco com
5 mil leads frios geraria 5 mil candidatos para a função descartar
depois — trabalho jogado fora no banco, onde ele custa mais caro.

---

## Métricas

21 cards, todos vindos do banco. Dois detalhes que importam:

- **Mensagens enviadas** conta apenas envios **reais**. Simulações
  (dry-run) ficam de fora — senão o número diria que você prospectou
  gente que nunca recebeu nada.
- **Sem site próprio** inclui rede social. Instagram e Facebook não
  contam como site.

### Campanha ativa

Os quatro contadores do card (`na fila`, `enviadas hoje`, `respostas`,
`quentes`) vinham fixos em zero desde a Fase 1 — o card existia mas
mentia. Agora vêm do banco, e "enviadas hoje" conta só `ENVIADA`.

---

## Tarefas

Uma tarefa é um lembrete com prazo, ligado a um lead. Ela **não** envia
nada e **não** muda o lead sozinha.

A tabela existia desde a Fase 1 sem nenhuma rota: as tarefas eram
criadas pelo sistema e ficavam invisíveis. Isso é pior do que não ter
tarefa nenhuma, porque o dashboard contava um número que não dava para
abrir.

### Ordem

Abertas primeiro, depois as mais urgentes, depois as de prazo mais
próximo. Tarefa **sem prazo** vai para o fim — ela nunca conta como
atrasada, e isso é proposital, não esquecimento.

### `concluidaEm`

Acompanha o status automaticamente, em vez de vir de quem chama. Assim
não existe tarefa concluída sem data nem tarefa aberta com data de
conclusão.

### Rotas

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/tasks` | Lista, com filtros e contagem de atrasadas |
| `POST` | `/api/tasks` | Cria |
| `PATCH` | `/api/tasks/:id` | Edita |
| `POST` | `/api/tasks/:id/concluir` | Atalho para o caso mais comum |

---

## Notificações

Ordenadas por **prioridade**, não por data: uma intervenção necessária
de ontem importa mais que uma importação concluída agora. A prioridade
fica numa coluna indexada — sem ela, ordenar exigiria um `CASE` sobre o
tipo em toda consulta.

Não há rota de criação: notificações são geradas pelo sistema.

O sino da barra superior antes só exibia — o contador nunca zerava e a
lista virava um mural que ninguém conseguia limpar. Agora clicar marca
como lida, há "marcar todas" e um link para a tela cheia.

---

## Tempo real

Tudo isso se move sozinho via **SSE**. Ao receber um evento, o frontend
invalida as queries afetadas e o TanStack Query recarrega — sem polling
e sem WebSocket.

Eventos que mexem no dashboard: `lead.status_alterado`,
`lead.temperatura_alterada`, `tarefa.criada`, `tarefa.concluida`,
`notificacao.criada`, `dashboard.atualizar`.

---

## Veja também

- [INTERVENCAO.md](INTERVENCAO.md) — o que fazer com o que aparece aqui
- [CAMPANHAS.md](CAMPANHAS.md) — de onde vêm os números da campanha
