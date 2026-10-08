# Renderizador de HTML do orçamento (Tarefa 36)

Adiciona `html-renderer.service.ts`: um serviço puro e determinístico que recebe o
layout do template (`LayoutTemplate`), o snapshot do orçamento (`OrcamentoSnapshot`)
mais `numero`/`versao`, e devolve um documento HTML completo. Substitui placeholders
`{chave}` pelos valores reais do snapshot (todos escapados), itera os itens numa
tabela ordenada, injeta o CSS do template num `<style>`, embute imagens como data URLs
e formata moeda em BRL sem depender de locale. Não toca banco, rede nem Puppeteer,
respeitando o escopo (RF-016 critérios 4 e 5). A entrada reutiliza os tipos reais e lê
o `layout` genérico de forma defensiva, como o plano fixou (D1–D8).

Watch for: nada bloqueante. Alguns pontos menores de comportamento valem registro —
uma assimetria no fallback do corpo quando o template não traz `corpo`, e a decisão de
descricao de item ser omitida da renderização de total. Nenhum deles contradiz o DoD.

**Verdict**: APPROVED

## High-level view

O serviço é exposto como `HtmlRendererService` + factory `criarHtmlRendererService()`
sem dependências, no mesmo estilo de `criarSnapshotService`. As interfaces de input
(`RenderizarHtmlInput`) são próprias e os tipos de dados (`OrcamentoSnapshot`,
`SnapshotItem`, `LayoutTemplate`) são importados dos módulos reais, confirmados contra
`snapshot.service.ts` e `template.repository.ts` — nenhum shape inventado.

A substituição de placeholders usa `\{(\w+)\}` resolvido contra um mapa derivado do
snapshot; chaves sem valor viram string vazia, então nenhuma sintaxe crua vaza. As
imagens usam um namespace separado `{img:nome}` que o regex de dados não captura (o
`:` não é `\w`), evitando colisão entre as duas passagens de substituição. Todos os
dados do snapshot passam por `escaparHtml`; CSS e data URLs ficam sem escape por serem
markup, como o plano previu (D6).

A leitura defensiva do `layout` cobre as duas formas de `imagens` (mapa e array),
descarta entradas inválidas, e aplica fallbacks (`CSS_MINIMO`, formato `A4`, orientação
`retrato`) sem lançar. A tabela de itens entra no lugar de `{itens}` ou é anexada ao
corpo quando o marcador falta, garantindo que os itens nunca desapareçam.

A evidência de verificação está no corpo do commit (`80a789d`): build e lint limpos,
384 testes passando, e cobertura do novo serviço em 98.12% stmts / 100% funcs /
85.18% branches — acima do mínimo de 80%. O arquivo de teste exercita cada critério do
DoD e os ramos defensivos.

<details>
<summary>Issues (2)</summary>

1. **Descrição do corpo ausente usa string vazia** (possible) — quando o template não
   traz `layout.corpo`, o documento final contém só a tabela de itens dentro do
   `<body>`, sem cabeçalho/dados. É o fallback declarado em D7 e aceitável no MVP, mas
   convém o chamador da Tarefa 40 sempre fornecer um `corpo`. Não bloqueante.
2. **`item.descricao` renderizada mas sem placeholder próprio** (possible) — a tabela
   expõe `descricao` numa coluna, o que é correto; só registrar que não há placeholder
   `{descricao}` no mapa de dados (o item vive na iteração, não no corpo). Comportamento
   esperado, sem ação.

</details>

<details>
<summary>Details</summary>

## Determinismo e o hash de documento

O teste de determinismo (duas chamadas → string idêntica) fixa uma propriedade que
importa além do teste: o hash de documento SHA-256 do produto depende de saída estável.
A formatação de moeda própria (`formatarMoeda`) evita `Intl.NumberFormat` com locale
implícito, fechando a última fonte de não-determinismo possível (D5).

## Reuso dos tipos reais

`RenderizarHtmlInput` importa `OrcamentoSnapshot` e `SnapshotItem` de
`snapshot.service.js` e `LayoutTemplate` de `template.repository.js`. Verifiquei os dois
módulos: `SnapshotItem` tem exatamente `ordem/nome/descricao/quantidade/unidade/
valor_unitario/desconto_tipo/desconto_valor/total/responsavel`, e o serviço lê só esses
campos; `empresa_cliente.razao_social` e `responsavel.registro_profissional` batem com
as interfaces reais (`SnapshotEmpresa`, `SnapshotResponsavel`). `LayoutTemplate` é de
fato `Record<string, unknown>`, o que justifica o narrowing manual (`ehString`,
`Array.isArray`, checagem de `object`) imposto por `noUncheckedIndexedAccess`.

## Substituição de placeholders e isolamento do namespace de imagem

Dois regimes de substituição convivem sem colidir. `substituirPlaceholders` usa
`/\{(\w+)\}/g`: como `\w` não inclui `:`, um `{img:logo}` passa intocado por essa
passagem e só é resolvido depois por `embutirImagens` com `/\{img:(\w+)\}/g`. A ordem
em `renderizar` (dados → imagens → itens) respeita essa separação. Placeholders de
dados sem correspondência caem em `mapa[chave] ?? ''`, então não sobra `{x}` cru — o
teste do `{inexistente}` embutido no CSS cobre isso, inclusive provando que o CSS
também passa pela substituição (montarCss chama `substituirPlaceholders`).

## Leitura defensiva do layout e fallback de itens

`coletarImagens` normaliza mapa e array para `ImagemEmbutida[]`, descartando entradas
que não sejam objetos com `nome`+`dataUrl` string — o teste com array contendo
`'invalida'` e `{ nome: 'x' }` cobre o descarte. Formas desconhecidas de `imagens` e
ausência retornam `[]` sem lançar. O `montarCss` aplica `CSS_MINIMO` e defaults de
formato/orientação quando o layout não os traz. A tabela de itens entra via split em
`{itens}` quando presente, ou é anexada ao final do corpo caso contrário; ambos os
ramos têm teste, garantindo que os itens nunca somem.

Vale um registro de comportamento (não bloqueante): quando `layout.corpo` está ausente,
`corpoBruto` vira `''` e o `<body>` final contém apenas a tabela de itens — sem
cabeçalho ou dados do cliente. É o fallback declarado (D7) e consistente com o layout
genérico ainda não fixado (Tarefa 49), mas o chamador da Tarefa 40 deve sempre fornecer
um `corpo` real para o PDF ter conteúdo além da tabela.

## Erros e convenções

`renderizar` lança `AppError(422, 'Orçamento sem itens...')` quando `snapshot.itens`
está vazio; a assinatura bate com `AppError(statusCode, message, detalhes?)` e o teste
confere `statusCode === 422` e `instanceof AppError`. As convenções do projeto estão
seguidas: imports ESM com `.js` (Node16), aspas simples, sem ponto e vírgula, indentação
de 2 espaços, pt-BR nos identificadores e comentários, testes em `__tests__/*.test.ts`.

## Cobertura e evidência

Não re-rodei as suítes, conforme instruído. A evidência registrada no commit `80a789d`
reporta build e lint limpos, 384 testes passando e cobertura do novo serviço em 98.12%
stmts / 100% funcs / 85.18% branches, acima do piso de 80%. O arquivo de teste tem 23
casos cobrindo cada critério do DoD (substituição de `{cliente}`/`{numero}`, demais
placeholders, string vazia, iteração/ordem de itens, CSS e fallback, imagens mapa/array
e ausentes, escaping, moeda determinística, HTML válido, determinismo, fallback de
`{itens}`, e o erro 422), além dos ramos defensivos (negativo, paisagem, responsável sem
registro, entradas de imagem inválidas). O número de branches descobertos (14.82%) é
compatível com ramos de narrowing raramente atingidos; não há dúvida articulável que
justifique spot-check adicional.

</details>

<details>
<summary>File map</summary>

- `backend/src/services/html-renderer.service.ts` — novo serviço: interface, factory,
  helpers puros (escaping, moeda, mapa de placeholders, substituição, imagens, itens,
  CSS, documento).
- `backend/src/services/__tests__/html-renderer.service.test.ts` — 23 testes cobrindo
  DoD e ramos defensivos, com fixtures que reutilizam os tipos reais.

Diff completo: `git show 80a789d`.

</details>
