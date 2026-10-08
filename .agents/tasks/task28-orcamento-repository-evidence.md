# Evidência — Tarefa 28 (Fase 5): Repositório de Orçamentos

Primeira iteração (não havia `task28-review.json`). Implementação do zero via TDD.

## Arquivos criados

- `backend/src/repositories/orcamento.repository.ts`
- `backend/src/repositories/__tests__/orcamento.repository.test.ts`

Nenhum outro arquivo foi tocado. `tasks.md` NÃO foi marcado como concluído.

## Comandos executados (de dentro de `backend/`)

### `npm run build` (tsc)

Compila sem erros. Exit 0.

### `npm run test -- orcamento.repository`

```
✓ src/repositories/__tests__/orcamento.repository.test.ts (18 tests)
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

Cobre: `criar` (transação atômica, numeração ORC-{ANO}-{SEQ} com MAX null→0001 e
MAX 42→0043, advisory lock emitido ANTES do SELECT MAX, status rascunho, ordem
1-based, cálculo subtotal/total, conversão NUMERIC→number no retorno), `buscarPorId`
(null quando ausente; itens ordenados por `ordem` ASC; filtro por tenant),
`atualizar` (null quando ausente; transação; SUBSTITUI itens via delete+insert;
atualiza campos + recalcula subtotal/total), `listarPorTenant` (filtro por tenant,
status opcional, limit/offset de paginação, total, order by criado_em desc, resumo
sem o array `itens`), `deletar` (deleta rascunho; AppError 409 para não-rascunho;
AppError 404 para inexistente).

### `npm run test` (suíte completa)

```
 Test Files  25 passed (25)
      Tests  262 passed (262)
```

Nenhum teste quebrado nos demais repositórios/serviços/rotas. Sem skips indevidos.

### `npm run lint`

ESLint sem erros. Exit 0.

### `npm run format`

Prettier aplicado; arquivos do projeto reportados como `unchanged` após a execução
(estilo já conforme: aspas simples, sem ponto-e-vírgula, 2 espaços, trailing commas
`all`, print width 100).

### `npm run test:coverage`

Thresholds globais (80% em lines/functions/branches/statements) satisfeitos.
Agregado geral: `All files 98.75% stmts | 90.46% branch | 99.13% funcs | 98.75% lines`.

Cobertura por arquivo de `orcamento.repository.ts` (extraída de `coverage-final.json`):

- statements: 314/314 (100%)
- functions: 14/14 (100%)
- branches: 43/52 (~82,7%)
- lines: 100%

Acima do mínimo de 80% exigido para repositórios.

## Notas de design (resumo; detalhes no plano `task28-plan.md`)

- **Numeração sem race:** `ORC-{ANO}-{SEQ}` gerado DENTRO da transação de `criar`,
  com `pg_advisory_xact_lock(hashtext(tenant:ano))` seguido de `SELECT MAX(...)` do
  sequencial no ano. `UNIQUE (tenant_id, numero)` é a rede de segurança final. Sem
  nova migration (fora do escopo). Ano derivado no app com `new Date().getFullYear()`,
  coerente com o default `data_emissao = CURRENT_DATE`.
- **SQL cru mockável:** advisory lock e SELECT MAX usam `sql\`...\`.execute(trx)`.
  Nos unit tests, a transação é mockada com um executor falso que registra os SQLs
  em ordem (verificação de que o lock vem antes do MAX) e resolve as linhas.
- **NUMERIC:** colunas NUMERIC são `string` no `Database` (driver pg); inserts enviam
  `String(valor)` e `mapRow*` convertem de volta para `number`.
- **Assinatura do factory:** `criarOrcamentoRepository({ db })` (objeto), conforme o
  enunciado — diverge dos vizinhos (posicional); documentado em comentário no arquivo.
- **`deletar`:** só rascunho; senão `AppError(409)`; inexistente → `AppError(404)`.
  Itens caem por `ON DELETE CASCADE`.

## Testes mock-based (sem Postgres)

Os testes de repositório deste projeto NÃO sobem Postgres nem exercitam RLS real
(mesmo mecanismo de `cliente`/`responsavel.repository.test.ts`). "Isolamento de
tenant" é verificado como asserção dos filtros `.where('tenant_id', ...)` /
`orcamento_id`. A verificação ponta-a-ponta de RLS e de concorrência na numeração
fica para testes de integração (mesma convenção do middleware `tenant.ts`). O banco
de teste real não foi necessário/executado.
