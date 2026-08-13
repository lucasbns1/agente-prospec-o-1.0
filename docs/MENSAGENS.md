# Mensagem personalizada

Cada lead recebe **a mensagem dele**, montada com **os dados dele**.
Nunca uma cópia com dados de outro.

---

## A regra central: nunca inventar

Se o dado não existe, o sistema **não chuta**. Ele tem duas saídas, e
ambas são honestas:

1. **Variável obrigatória ausente → bloqueia o envio.** Melhor não
   enviar do que enviar errado.
2. **Variável opcional ausente → reescreve o trecho.** A frase se
   adapta em vez de ficar com um buraco.

O que o sistema **nunca** faz: inventar um bairro, completar um telefone,
deduzir um nome ou deixar `{{nome}}` visível na mensagem.

---

## Variáveis

| Variável | Origem | Obrigatória? |
|---|---|---|
| `{{empresa}}` | `empresa` ou `nomeCompleto` | **Sim** |
| `{{telefone}}` | `telefone` | **Sim** |
| `{{nome}}` | **só** o primeiro nome da pessoa | Não |
| `{{primeiro_nome}}` | idem | Não |
| `{{cidade}}` | `cidade` | Não |
| `{{bairro}}` | `bairro` | Não |
| `{{estado}}` | `estado` | Não |
| `{{categoria}}` | `categoria` | Não |
| `{{avaliacao}}` | nota no Google | Não |
| `{{totalAvaliacoes}}` | nº de avaliações | Não |

`empresa` é obrigatória porque "vi a {{empresa}} no Google" sem a empresa
não quer dizer nada.

### `{{nome}}` nunca cai para o nome da empresa

Esta é uma decisão explícita, e custou um bug para ficar clara.

Um lead de estabelecimento tem `nomeCompleto = "Clínica Bem Viver"` e
`primeiroNome = null`. Se `{{nome}}` aceitasse o nome do
estabelecimento, o template

```
Olá, {{nome}}! Vi a {{empresa}} no Google, em {{cidade}}...
```

viraria

```
Olá, Clínica Bem Viver! Vi a Clínica Bem Viver no Google, em Campinas...
```

— nome de empresa tratado como se fosse gente, repetido duas vezes na
mesma frase. Soa como robô quebrado.

Com a restrição, o fallback de saudação entra e a mensagem sai natural:

```
Olá! Vi a Clínica Bem Viver no Google, em Campinas...
```

> **Cuidado ao mexer:** o critério de "tem nome?" e o valor de
> `{{nome}}` precisam usar a mesma fonte (`primeiro_nome`). Se
> divergirem, o fallback não dispara, a variável fica sem valor e **todo
> lead de empresa vira bloqueio** — o problema inverso, igualmente ruim.
> Há teste para os dois lados.

---

## Fallbacks textuais

### Saudação sem nome

Aplicados **antes** da substituição, para o texto sair fluido:

| Template | Sem nome |
|---|---|
| `Olá, {{nome}}!` | `Olá!` |
| `Oi, {{nome}}!` | `Oi!` |
| `Bom dia, {{nome}}.` | `Bom dia.` |
| `Boa tarde, {{nome}}!` | `Boa tarde!` |
| `falo com a {{nome}}?` | `falo com o responsável?` |

### Trecho de cidade

Sem cidade, o trecho some — **junto com as vírgulas dos dois lados**:

```
"Vi a {{empresa}}, em {{cidade}}, no Google."
        ↓  (sem cidade)
"Vi a Clínica Alfa no Google."
```

Consumir só o miolo deixaria `"Vi a Clínica Alfa, no Google"` — uma
vírgula solta que denuncia o texto montado.

---

## Quando o envio é bloqueado

| Motivo | Quando |
|---|---|
| `VARIAVEL_OBRIGATORIA_AUSENTE` | `{{empresa}}` ou `{{telefone}}` sem valor |
| `MENSAGEM_VAZIA` | Texto ficou vazio depois de renderizar |
| `MENSAGEM_MUITO_LONGA` | Acima de 4000 caracteres |
| — | Variável desconhecida no template |
| — | Variável opcional sem valor **e** sem fallback |

O último caso importa: se sobrou uma variável sem valor e sem fallback,
o texto ficou com um buraco. O sistema bloqueia em vez de mandar frase
truncada.

---

## Escrevendo um bom template

```
Olá, {{nome}}! Vi a {{empresa}} no Google, em {{cidade}}, e percebi
que vocês ainda não possuem um site próprio. Posso te mostrar uma ideia?
```

- Use `{{nome}}` **com** um padrão de saudação reconhecido — é o que
  permite o fallback funcionar.
- Cerque `{{cidade}}` de vírgulas — é o que permite removê-la limpo.
- Não escreva `[Nome]`, `XXX` ou qualquer marcador manual: eles não são
  substituídos e vão sair no texto.

O contador de caracteres do editor mostra o tamanho do **template**, não
da mensagem final — o texto real varia por lead.

---

## Onde isso mora

`packages/domain/src/campaign/template.ts` — função pura, sem I/O.
Entra template + contexto, sai texto. Dá para testar sem banco.
