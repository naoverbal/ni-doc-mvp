# Evidência — Tarefa 37: Quebra de página automática (serviço de paginação)

Fase 8 (Geração de PDF). Backend, lógica pura (sem Puppeteer/banco/rede),
rodando diretamente no workspace (sem worktree).

Iteração posterior: existia `task37-review.json` com verdict `CHANGES_REQUESTED`.
O finding bloqueante era a ausência de evidência de verificação (build/lint/
testes/cobertura). Os dois findings não bloqueantes também foram endereçados
(ver abaixo). O algoritmo e os testes já aprovados na revisão foram mantidos.

## Arquivos criados/alterados

- `backend/src/services/paginacao.service.ts` (serviço, inalterado nesta iteração)
- `backend/src/services/__tests__/paginacao.service.test.ts` (dois testes de
  borda adicionados — ver "Findings da revisão")

## Findings da revisão endereçados

- **(bloqueante) Evidência de verificação ausente** — resolvido por este arquivo
  e pelos resultados registrados abaixo.
- **(não bloqueante) Propagação de header/footer null** — adicionado teste
  `propaga header/footer null como null em cada página`, que paginação em 2
  páginas e asserta `toBeNull()` em `header`/`footer` de cada página.
- **(não bloqueante) `linhas <= 0` sem teste próprio** — adicionado teste
  `saneia linhas <= 0 tratando o item como 1 linha`, que mistura `linhas` 0, -5
  e 1 numa área p/ 3 itens e confirma 1 única página (saneamento `Math.max(1, …)`).

## Comportamentos (já validados pela revisão)

- Estimativa de altura: `alturaLinha * max(1, linhas) + padding` (defaults
  internos `alturaLinha=6`, `padding=2` quando a área não informa).
- Bin-packing sequencial de passagem única; a guarda `atual.length > 0` na
  condição de quebra garante que um item maior que a área ocupa sua própria
  página sem loop nem página vazia espúria.
- Header/footer clonados por valor (`{ ...bloco }`, `null` preservado) em cada
  página; ordem dos itens preservada; nenhum item é dividido.
- Lista vazia → 1 página (vazia, com header/footer).

## Verificação (rodada em `backend/`)

### `npm run build` (tsc)

Sem erros. Exit code 0.

### `npm run lint` (eslint src)

Limpo, sem warnings. Exit code 0.

### `npm run test` (vitest run — suíte completa)

```
 ✓ src/services/__tests__/paginacao.service.test.ts (15 tests)
 Test Files  35 passed (35)
      Tests  399 passed (399)
```

### `npm run test:coverage` — cobertura de `paginacao.service.ts`

Diretório `src/services`: 99.4% stmts / 94.87% branch / 100% funcs.

Cobertura isolada do serviço (run focado em `paginacao.service.ts`):

```
File               | % Stmts | % Branch | % Funcs | % Lines
All files (paginacao.service.ts) |   100 |   100 |   100 |   100
```

100% em statements/branches/functions/lines — acima do mínimo de 80% exigido
para serviços.
