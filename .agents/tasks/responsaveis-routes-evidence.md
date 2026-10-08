# Task 27 — Rotas de responsáveis técnicos — Evidence

TDD: tests written first and confirmed red (router/schema modules did not exist), then
implemented to green.

## Files created
- `backend/src/schemas/responsavel.schema.ts` — Zod shape-only schemas
  (`criarResponsavelSchema`, `atualizarResponsavelSchema`) + inferred types. No document,
  so no business rules beyond shape.
- `backend/src/routes/responsaveis.routes.ts` — `criarResponsaveisRouter(responsavelService, authService)`
  mirroring the cliente/empresa route pattern: router-level `autenticar`, `construirContexto`,
  GET `?q` empty-list short-circuit (no `tipo`), POST 201, PUT 200, GET :id, `next(err)` delegation.
- `backend/src/routes/__tests__/responsaveis.routes.test.ts` — 13 tests (per-test express app,
  mocked AuthService + ResponsavelService, supertest, auth-401 per method, beforeEach clearAllMocks).

## Files edited (additive only)
- `backend/src/app.ts` — added imports for repository/service/router and one composition block
  mounting `/api/responsaveis`. errorHandler remains last.

## Gate results (run from backend/)

### 1. New tests — `npm run test -- --run src/routes/__tests__/responsaveis.routes.test.ts`
```
✓ src/routes/__tests__/responsaveis.routes.test.ts (13 tests) 39ms
Test Files  1 passed (1)
     Tests  13 passed (13)
```

### 2. Build — `npm run build` (tsc strict)
Clean, exit 0 (no errors).

### 3. Lint — `npm run lint` (eslint src)
Clean, exit 0 (zero errors/warnings).

### 4. Format — `npm run format`
Applied; my new files reported unchanged (already formatted).

### 5. Full suite — `npm run test -- --run`
```
Test Files  24 passed (24)
     Tests  244 passed (244)
```
Previous baseline 231 + 13 new responsaveis route tests = 244. Fully green.
