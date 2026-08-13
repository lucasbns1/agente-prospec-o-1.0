# Importação de leads

Como o Prospector transforma um export do Instant Data Scraper em leads
do CRM.

---

## O fluxo

```
Google Chrome
   ↓
Google Maps — pesquise "psicólogos Campinas"
   ↓
Instant Data Scraper — clique em "Start crawling"
   ↓
Exporte CSV ou XLSX
   ↓
Prospector → Importar → escolher arquivo
   ↓
PRÉVIA  ← nada é gravado ainda
   ↓
Você confirma
   ↓
Leads no CRM
```

O sistema **não automatiza** o Google Maps nem a extensão. Você faz a
captura à mão; o Prospector cuida do pós-processamento.

---

## Dois passos, nunca um

`POST /api/imports/analisar` lê o arquivo, normaliza tudo e detecta
duplicados — **sem gravar nada**. `POST /api/imports/confirmar` grava.

Por que separado: você precisa ver o que vai entrar antes de entrar.
Um CSV com 200 linhas e um mapeamento errado de coluna criaria 200 leads
ruins que você teria que apagar um a um.

A confirmação **reanalisa** o arquivo em vez de reaproveitar a prévia:
entre um passo e outro o banco pode ter mudado, e um lead que era novo
pode já existir.

---

## Mapeamento de colunas

Os nomes das colunas mudam conforme o idioma da interface do Google Maps
e a versão da extensão. O sistema reconhece aliases:

| Campo | Aliases reconhecidos |
|---|---|
| Nome | Nome, Name, Title, Nome da empresa, Business name, Estabelecimento… |
| Telefone | Telefone, Phone, Celular, WhatsApp, Contato, Fone… |
| Website | Website, Site, URL, Link, Homepage, Página… |
| Endereço | Endereço, Address, Localização, Logradouro… |
| Bairro | Bairro, Neighborhood, Distrito… |
| Cidade | Cidade, City, Município… |
| Categoria | Categoria, Category, Nicho, Segmento, Ramo… |
| Avaliação | Avaliação, Rating, Nota, Estrelas… |
| Nº de avaliações | Número de avaliações, Reviews, Review count… |

**Colunas não reconhecidas são ignoradas**, não adivinhadas. Elas
aparecem marcadas na prévia para você ver o que ficou de fora.

Duas passadas: primeiro os casamentos exatos, depois os parciais. Sem
isso, "Avaliações" processada antes de "Número de avaliações" roubaria o
campo errado.

---

## Regra de site próprio

A pergunta que define quem entra na sua prospecção.

**SEM SITE PRÓPRIO** quando o campo está:
- vazio, nulo ou ausente;
- com um valor que significa "não tem" (`-`, `N/A`, `sem site`…);
- apontando para um domínio cadastrado como rede social;
- com uma URL que não dá para interpretar.

**COM SITE** quando é um domínio próprio que não está na lista.

### A lista vem do banco

`instagram.com` e `facebook.com` vêm no seed, mas **não estão no
código**. Você pode adicionar `linktr.ee`, `beacons.ai` ou o que quiser
na tabela `social_domains` — o classificador passa a usar sem nenhuma
alteração de código.

`incluirSubdominios` faz `instagram.com` já cobrir `www.instagram.com`,
`m.instagram.com` e `br.instagram.com`.

### O casamento é por label, não por sufixo

`meuinstagram.com.br` **não** é Instagram. Um `endsWith` simples
classificaria errado o site próprio de alguém e faria você abordar essa
pessoa dizendo que ela não tem site.

### Domínio desconhecido nunca vira rede social

Errar para o lado de "tem site" só deixa um lead de fora. Errar para o
outro lado te faz mandar a mensagem errada.

---

## Deduplicação

Três prioridades, na ordem:

1. **telefone normalizado** (E.164)
2. **nome + endereço**
3. **nome + cidade**

O nome sozinho nunca basta — "Clínica Sorriso" existe em toda cidade.

### Duas camadas

**No banco:** `Lead.chaveDedupe` é `UNIQUE`. É a garantia forte: nem uma
corrida entre dois imports simultâneos passa por ela.

**Na análise:** o sistema compara **todas** as chaves aplicáveis, não só
a de maior prioridade. Isso pega um caso que a chave primária sozinha
deixaria passar:

> O mesmo estabelecimento importado uma vez **com** telefone e outra
> **sem**. As chaves primárias seriam diferentes — telefone numa,
> nome+endereço na outra — e os dois entrariam como leads distintos.

### Nada é descartado em silêncio

Toda linha vira uma `ImportRow`, inclusive as ignoradas, com:
- o dado cru como veio;
- o motivo (`mesmo telefone`, `mesmo nome e endereço`…);
- qual lead existente causou a duplicidade.

O relatório final mostra linha, nome, problema e ação tomada.

---

## Normalização

| Campo | O que acontece |
|---|---|
| Nome | Corrige caixa (`MARIA SILVA` → `Maria Silva`), mantém acentos, conectivos em minúsculo |
| Primeiro nome | Ignora títulos (`Dra.`, `Psicóloga`) e siglas de conselho (`CRP`) |
| Telefone | Vira E.164, valida DDD e prefixo |
| Endereço | Separa logradouro, número, bairro, cidade, estado, CEP |
| Website | Classificado (ver acima) |
| Avaliação | `4,8` e `4.8` viram `4.8`; fora de 0–5 vira `null` |

### O que o sistema NUNCA faz

**Não inventa telefone.** Um número sem DDD é inválido, não "consertado".
Um dígito errado não dá erro — entrega a mensagem para outra pessoa.

**Não deduz bairro.** O export do Google Maps frequentemente não traz o
bairro separado. O campo só é preenchido quando aparece na posição
inequívoca `<número> - <bairro>, <cidade>`. Caso contrário fica `NULL`.

**Não inventa primeiro nome.** Se o nome parece de empresa
("Clínica Bem Viver"), `primeiroNome` fica `NULL`. Isso vai **bloquear**
o envio de mensagens que usam `{{primeiro_nome}}` — o que é melhor do
que mandar "falo com a psicóloga Clínica?".

### Dados originais são preservados

`nomeOriginal`, `telefoneOriginal`, `enderecoOriginal`, `websiteOriginal`
e `dadosBrutos` guardam exatamente o que veio. Se a normalização errar,
você consegue ver o que era e corrigir.

---

## Limites e segurança

- Apenas `.csv` e `.xlsx`
- Máximo 25 MB e 20.000 linhas por arquivo
- Nome de arquivo com `..` ou barra é rejeitado
- Nenhum arquivo fica em disco entre a prévia e a confirmação
- Todas as rotas exigem autenticação

CSV: detecta BOM, delimitador (`,` `;` tab `|`) e codificação (UTF-8 com
fallback para Windows-1252, que é o padrão do Excel em português).

XLSX: lê a primeira planilha e **avisa** qual usou quando há mais de uma.

---

## Testar

```bash
pnpm test                    # 217 testes, inclui import e dedupe
pnpm exec playwright test    # E2E do fluxo completo
```

As fixtures em `tests/fixtures/` cobrem de propósito: Instagram,
Facebook, site próprio, sem site, duplicado por telefone, duplicado por
nome+endereço, linha sem telefone, linha sem nome e telefone sem DDD.
