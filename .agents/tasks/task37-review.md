# Serviço puro de paginação de itens (TAREFA 37)

O serviço `paginacao.service.ts` agrupa os itens de um orçamento em páginas que
caibam na altura da `area-itens` do template, estimando a altura de cada item
por `alturaLinha * linhas + padding` e repetindo header/footer por valor em cada
página. É lógica pura e determinística — sem Puppeteer, banco ou rede — exposta
por uma factory `criarPaginacaoService()` com interface `PaginacaoService`,
alinhada ao estilo de wiring do projeto. Esta é uma segunda passagem: o
`CHANGES_REQUESTED` anterior exigia a evidência de verificação (ausente) e
apontava duas lacunas menores de teste. Todas as três foram endereçadas.

Watch for: nada bloqueante. A evidência de verificação agora existe em
`task37-evidence.md` (build/lint/testes/cobertura) e os dois testes de borda que
faltavam foram adicionados. (confirmed)

**Verdict**: APPROVED

## High-level view

O algoritmo é um bin-packing sequencial de passagem única com acumulador de
altura por página. A guarda `atual.length > 0` na condição de quebra faz um item
maior que a área inteira ocupar sua própria página sem loop e sem gerar página
vazia — a borda mais arriscada da tarefa, tratada corretamente. Header e footer
são clonados por valor a cada página (`null` preservado), a ordem é mantida ponta
a ponta e nenhum item é dividido.

O finding bloqueante da passagem anterior era a ausência da evidência de
verificação. Ela agora existe: `task37-evidence.md` registra `npm run build` e
`npm run lint` limpos, 399 testes passando (15 neste arquivo) e cobertura de
100% stmts/branch/funcs/lines para `paginacao.service.ts`, acima do mínimo de
80%. O spot-check de contagem de testes confirma os 15 casos.

As duas lacunas não bloqueantes também foram fechadas: há agora um teste
dedicado de propagação de `header`/`footer` `null` em cada página e um teste do
saneamento de `linhas <= 0` (contado como 1 linha). Com isso não resta nenhum
finding em aberto.

<details>
<summary>Issues (0)</summary>

Nenhum. Os três findings da passagem anterior (evidência de verificação
ausente; propagação de `null` sem asserção dedicada; `linhas <= 0` sem teste
próprio) foram todos endereçados nesta iteração.

</details>

<details>
<summary>Details</summary>

## Findings da passagem anterior — status

A revisão v1 (`CHANGES_REQUESTED`) levantou três pontos. Confirmação nesta
passagem:

- **(bloqueante) Evidência de verificação ausente** — resolvido.
  `task37-evidence.md` existe e registra: `npm run build` (tsc) sem erros,
  `npm run lint` limpo, `npm run test` com 35 arquivos / 399 testes passando (15
  em `paginacao.service.test.ts`), e cobertura isolada de 100%
  stmts/branch/funcs/lines para o serviço. Conforme instruído, esta revisão lê a
  evidência em vez de reexecutar as suítes; o único spot-check feito foi contar
  os `it(` do arquivo de teste (15), batendo com a evidência.
- **(não bloqueante) Propagação de header/footer null** — resolvido. Teste
  `propaga header/footer null como null em cada página` pagina 5 itens em 2
  páginas e asserta `toBeNull()` em `header`/`footer` de cada página, cobrindo o
  ramo `bloco === null` de `clonarBloco`.
- **(não bloqueante) `linhas <= 0` sem teste próprio** — resolvido. Teste
  `saneia linhas <= 0 tratando o item como 1 linha` mistura `linhas` 0, -5 e 1
  numa área p/ 3 itens e confirma 1 página única, exercitando o
  `Math.max(1, item.linhas)` de `estimarAlturaItem`.

## Bin-packing sequencial e a guarda contra loop

O núcleo é uma passagem única sobre os itens ordenados, com um acumulador de
altura por página:

```ts
if (atual.length > 0 && alturaAcumulada + alturaItem > alturaMaxima) {
  abrirPagina()
  atual = []
  alturaAcumulada = 0
}
atual.push(item)
alturaAcumulada += alturaItem
```

A condição `atual.length > 0` resolve a borda mais perigosa. Um item cuja altura
estimada excede a área inteira chega a esse ponto com a página vazia: a quebra é
suprimida, o item é empurrado para a página corrente e segue para a próxima
iteração. Não há página vazia espúria nem laço infinito. O trace confirma item
gigante sozinho (`linhas: 100`) → 1 página, e item gigante no meio
(`[1, gigante, 3]`) → 3 páginas `[1] [2] [3]`.

A última página é sempre fechada por um `abrirPagina()` incondicional após o
laço, que também produz a página única e vazia (com header/footer) quando a
lista de itens está vazia.

## Estimativa de altura e saneamento

`estimarAlturaItem` aplica `alturaLinha * max(1, linhas) + padding`. O
`Math.max(1, item.linhas)` protege contra `linhas` 0 ou negativo, que produziria
altura só de padding e permitiria empacotar infinitos itens numa página — agora
coberto por teste dedicado. Os defaults (`alturaLinha=6`, `padding=2`) cobrem a
área sem parametrização.

## Header/footer por valor — nota de borda não bloqueante

`clonarBloco` faz shallow copy (`{ ...bloco }`) ou mantém `null`. A cópia é rasa:
objetos aninhados em header/footer seriam compartilhados por referência entre
páginas — no MVP, em que header/footer são blocos opacos repetidos por valor,
isso basta e não é um finding.

</details>

<details>
<summary>File map</summary>

- `backend/src/services/paginacao.service.ts` — serviço puro de paginação:
  factory `criarPaginacaoService`, estimativa de altura e bin-packing
  sequencial (inalterado nesta iteração).
- `backend/src/services/__tests__/paginacao.service.test.ts` — suíte Vitest, 15
  casos cobrindo DoD e bordas (dois testes adicionados nesta iteração).
- `.agents/tasks/task37-evidence.md` — evidência de build/lint/testes/cobertura.
- `.kiro/specs/ni-doc-mvp/tasks.md` — tarefa 37 marcada como `[x]`.

</details>
