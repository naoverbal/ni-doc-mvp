# Task 25 — Rotas de empresas — Evidence

First iteration (no `empresas-routes-review.json` present). Implemented via strict TDD.

## Files created

- `backend/src/schemas/empresa.schema.ts` — `criarEmpresaSchema`, `atualizarEmpresaSchema` (shape-only, mirrors cliente).
- `backend/src/routes/empresas.routes.ts` — `criarEmpresasRouter(empresaService, authService)`.
- `backend/src/routes/__tests__/empresas.routes.test.ts` — 18 tests.

## Files edited

- `backend/src/app.ts` — wired `criarEmpresasRouter` under `/api/empresas` (surgical: added imports + empresas block only; errorHandler stays last).

## Gate results

| Gate | Command | Result |
| --- | --- | --- |
| New tests | `npm run test -- --run src/routes/__tests__/empresas.routes.test.ts` | PASS — 18/18, exit 0 |
| Build (own files) | `npx tsc --noEmit` filtered | PASS — zero errors outside `responsavel*` |
| Lint | `npm run lint` | PASS — zero errors/warnings, exit 0 |
| Format | `npm run format` | Applied — own files unchanged |
| Full suite | `npm run test -- --run` | 221 tests PASS; 22/23 suites pass |

## Concurrency note

A parallel workflow is adding the `responsaveis-tecnicos` module. The only build/test failures
are confined to `src/services/__tests__/responsavel.service.test.ts` (references
`../responsavel.service.js` / `../../repositories/responsavel.repository.js`, which that run has
not committed yet). These are the other run's in-flight work, not caused by the empresas change.
All empresas files and the previously-green suite pass.
