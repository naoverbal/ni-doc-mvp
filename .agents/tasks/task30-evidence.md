# Tarefa 30 — Evidência de verificação

Rotas REST de orçamentos (POST/GET lista/GET :id/PUT/DELETE) sob `/api/orcamentos`,
atrás de `autenticar`, fluxo route → validate (Zod) → service. Primeira iteração
(sem `task30-review.json`).

## Arquivos criados/editados

- `backend/src/schemas/orcamento.schema.ts` — `criarOrcamentoSchema`,
  `atualizarOrcamentoSchema`, `itemSchema` (shape apenas; regra de negócio no service).
- `backend/src/routes/orcamentos.routes.ts` — factory `criarOrcamentosRouter`,
  5 endpoints, parse de `status`/`pagina`/`tamanhoPagina` com `AppError(400)`.
  409 (não-rascunho) propagado do service, não duplicado na rota.
- `backend/src/routes/__tests__/orcamentos.routes.test.ts` — 23 testes (DoD completo).
- `backend/src/app.ts` — registro do router (`criarOrcamentoRepository({ db })`,
  reuso de `auditoriaService`) antes do `errorHandler`.

## Comandos (de `backend/`)

### npm run lint
```
> eslint src
Exit Code: 0
```
Sem erros.

### npm run build
```
> tsc
Exit Code: 0
```
Compilou sem erros.

### npm test (vitest run, modo único)
```
Test Files  27 passed (27)
     Tests  300 passed (300)
Exit Code: 0
```
Inclui `src/routes/__tests__/orcamentos.routes.test.ts (23 tests)`. Nenhum watch mode.

## Cobertura do DoD

- POST cria orçamento → 201 ✓
- GET lista retorna orçamentos do tenant (+ filtro status + paginação) ✓
- GET :id retorna orçamento com itens ✓
- PUT em rascunho atualiza → 200 ✓
- DELETE em rascunho deleta → 204 ✓
- PUT/DELETE em não-rascunho → 409 (service lança, rota repassa) ✓
- Todas as rotas exigem autenticação → 401 sem cookie ✓
- Validação Zod → 400 em payload inválido ✓
