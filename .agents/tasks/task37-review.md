# Serviço puro de paginação de itens (TAREFA 37)

O serviço `paginacao.service.ts` agrupa os itens de um orçamento em páginas que
caibam na altura da `area-itens` do template, estimando a altura de cada item
por `alturaLinha * linhas + padding` e repetindo header/footer por valor em cada
página. É lógica pura e determinística — sem Puppeteer, banco ou rede — exposta
por uma factory `criarPaginacaoService()` com interface `PaginacaoService`,
alinhada ao estilo de wiring do projeto. A correção algorítmica e a cobertura de
testes estão sólidas: todos os cenários do DoD e as bordas (1 item, 0 itens,
item maior que a área) estão exercitados e passam no raciocínio de trace.

Watch for: a evidência de verificação exigida (coder tendo rodado build, lint,
testes e cobertura com os resultados registrados em arquivo de evidência ou
send_message) **não está disponível nesta sessão** — não há `task37-evidence.md`
nem registro de execução, divergindo do padrão das tarefas 28–36. (confirmed)

**Verdict**: CHANGES_REQUESTED

## High-level view

O algoritmo é um bin-packing sequencial de passagem única com acumulador de
altura por página. A guarda `atual.length > 0` na condição de quebra é o que faz
um item maior que a área inteira ocupar sua própria página sem loop e sem gerar
página vazia — a borda mais arriscada da tarefa, tratada corretamente.

Header e footer são clonados por valor (`{ ...bloco }`, `null` preservado) a
cada página, garantindo independência entre páginas e repetição em todas,
inclusive na página vazia do caso de 0 itens. A ordem é preservada ponta a ponta
e nenhum item é dividido.

Os testes montam fixtures com alturas previsíveis (`alturaLinha=10, padding=0`,
área de 30mm = exatamente 3 itens) e cobrem cada critério do DoD mais padding,
linhas, ordenação e defaults. A lacuna não é de código nem de teste: é a
ausência da evidência de que as suítes foram efetivamente executadas pelo coder,
que esta revisão está instruída a exigir e não a produzir.

<details>
<summary>Issues (1)</summary>

1. **Evidência de verificação ausente** — não há `task37-evidence.md` nem
   registro de send_message mostrando build/lint/testes/cobertura executados
   para a tarefa 37, ao contrário de todas as tarefas anteriores (28–36). A
   revisão está instruída a reprovar quando a evidência está ausente, em vez de
   rodar as suítes. Ação: o coder deve registrar os resultados de
   `npm run build`, `npm run lint`, `npm run test` e `npm run test:coverage`
   (cobertura ≥ 80%) para `paginacao.service.ts` e reenviar.

</details>

<details>
<summary>Details</summary>

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

A condição `atual.length > 0` é o detalhe que resolve a borda mais perigosa da
tarefa. Um item cuja altura estimada excede a área inteira chega a esse ponto
com a página vazia (`atual.length === 0`): a quebra é suprimida, o item é
empurrado para a página corrente e segue para a próxima iteração. Não há página
vazia espúria nem laço infinito. O trace confirma:

- Item gigante sozinho (`linhas: 100`) → 1 página contendo o item.
- Item gigante no meio (`[1, gigante, 3]`) → 3 páginas `[1] [2] [3]`, porque o
  gigante força o fechamento da página 1 (que tinha o item 1) e depois a página
  3 fecha a do gigante.

A última página é sempre fechada por um `abrirPagina()` incondicional após o
laço. Esse mesmo caminho produz a página única e vazia (com header/footer)
quando a lista de itens está vazia — o laço simplesmente não executa.

## Estimativa de altura e saneamento

`estimarAlturaItem` aplica `alturaLinha * max(1, linhas) + padding`. O
`Math.max(1, item.linhas)` protege contra `linhas` igual a 0 (ou negativo), que
produziria altura só de padding e permitiria empacotar infinitos itens numa
página. Os defaults (`alturaLinha=6`, `padding=2`) cobrem a área sem
parametrização; o teste de defaults usa área de 1000mm e não fixa os valores
numéricos exatos — valida apenas que o fallback não quebra.

Trace do caso central (5 itens, `alturaLinha=10, padding=0`, área 30mm):
item 1→3 acumulam 30mm (`30 > 30` é falso, cabem), item 4 dispara a quebra
(`30+10 > 30`, página com itens) abrindo `[4]`, item 5 cabe (`10+10 > 30` falso)
→ `[4,5]`. Resultado `[1,2,3] [4,5]`, exatamente o esperado.

## Header/footer por valor e preservação de itens

`clonarBloco` faz shallow copy (`{ ...bloco }`) ou mantém `null`. Cada página
recebe cópias independentes, então mutação externa de uma página não vaza para
as outras — e o teste de repetição confirma igualdade estrutural em todas as
páginas. A cópia é rasa: objetos aninhados em header/footer seriam
compartilhados por referência entre páginas. No MVP, em que header/footer são
blocos opacos repetidos por valor, isso basta e não é um finding.

Os itens são referenciados diretamente (não clonados), o que preserva campos
extras via index signature `[chave: string]: unknown`. A ordenação usa cópia
(`[...itens]`) e não muta a entrada; sendo `Array.prototype.sort` estável no
Node 22, itens de mesma `ordem` mantêm a sequência original. A soma de itens
distribuídos é verificada contra o total, garantindo que nenhum item é cortado
nem duplicado.

## Aderência às convenções

Confere nos pontos exigidos: import `.js` em fonte `.ts`, factory `criar*` com
interface exportada, nomes de domínio em pt-BR, testes Vitest em `__tests__/`,
estilo Prettier e zero dependências externas — consistente com
`orcamento-calculo.ts` e com as regras `structure`/`tech`.

## Cobertura de testes

Exercitados: 5→2 páginas, todos→1 página, header/footer repetidos, nenhum item
cortado (soma), ordem preservada, itens fora de ordem reordenados, efeito de
padding, efeito de linhas, 1 item, 0 itens, item maior que a área (no meio e
sozinho), e defaults de parametrização. Isso cobre todos os critérios e bordas
do DoD.

Não testado (não bloqueante): `header`/`footer` como `null` só aparecem no teste
de defaults, sem uma asserção dedicada de que `null` é propagado como `null`;
e `linhas` ≤ 0 (saneado por `Math.max(1, ...)`) não tem teste próprio. São
lacunas menores de borda, não requisitos do DoD.

</details>

<details>
<summary>File map</summary>

- `backend/src/services/paginacao.service.ts` — serviço puro de paginação:
  factory `criarPaginacaoService`, estimativa de altura e bin-packing
  sequencial.
- `backend/src/services/__tests__/paginacao.service.test.ts` — suíte Vitest
  cobrindo DoD e bordas.
- `.kiro/specs/ni-doc-mvp/tasks.md` — tarefa 37 marcada como `[x]`.

Diff completo: `git show 4479a37`.

</details>
