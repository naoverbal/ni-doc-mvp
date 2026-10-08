# REST routes for empresas under /api/empresas

Task 25 adds the HTTP layer for the empresa (company) aggregate: a Zod schema module, an Express router with the four-endpoint REST contract, a supertest suite, and a surgical wiring block in `app.ts`. The router is a faithful clone of the existing `clientes.routes.ts`, with the one domain difference that empresa search is filtered by `tipo` (`tenant` | `cliente_pj`) and `GET /` defaults that filter to `cliente_pj`. Business validation (CNPJ checksum, duplicate detection, not-found) stays in the service; the route only does shape validation and delegation. Composition in `app.ts` reuses the existing `db` and `auditoriaService`, and `errorHandler` remains the last middleware.

Watch for: nothing blocking. The implementation matches the mandated contract line for line, the evidence note records passing build/tests/lint, and the one build failure referenced in the evidence is confined to a parallel in-flight `responsavel*` module unrelated to this change (confirmed — those files are untracked and not imported by anything in this commit).

**Verdict**: APPROVED

## High-level view

The router mirrors `clientes.routes.ts` exactly: router-level `router.use(autenticar)` makes every endpoint require auth, `construirContexto` builds the `EmpresaContexto` from `req.usuario` plus `ip`/`user-agent`, and all four handlers delegate to the service and forward errors via `next(err)` with no business re-validation. The only intentional divergence is `tipo` handling on `GET /`.

The `GET /` filter logic defaults `tipo` to `cliente_pj` when absent, rejects an unknown `tipo` with `AppError(400)` before touching the service, and short-circuits to `[]` when `q` is missing or empty without calling `buscar`. The required `tipo` argument is passed to `empresaService.buscar(ctx, q, tipo)`, matching the service's three-argument signature.

The schemas are shape-only. `criarEmpresaSchema` validates `tipo` as an enum, requires `razaoSocial`, and treats `cnpj`/`email`/the rest as optional, with `email` as `z.string().email().optional()`; CNPJ checksum is deliberately left to the service. `atualizarEmpresaSchema` omits `tipo` and `cnpj`, exactly matching the repository's `AtualizarEmpresaInput`.

The `app.ts` edit adds only the empresa imports and a three-line composition block, reusing the shared `db` and `auditoriaService` and keeping `errorHandler` last. No unrelated lines were removed or reordered.

<details>
<summary>Issues (0)</summary>

No blocking or non-blocking issues found.

</details>

<details>
<summary>Details</summary>

### Tipo filtering and empty-q short-circuit on GET /

The `GET /` handler reads `q` first and returns `[]` without calling the service when `q` is not a non-empty string, which prevents a `buscar` call with an undefined term. It then resolves `tipo`: absent means `cliente_pj`, a value outside `['tenant', 'cliente_pj']` is rejected with `next(new AppError(400, 'tipo inválido'))` before the service is touched, and a valid value is forwarded. The service call is `empresaService.buscar(ctx, q, tipo)` with the three arguments the service's interface declares (confirmed against `empresa.service.ts`, where `buscar` requires `tipo: 'tenant' | 'cliente_pj'`). One ordering consequence worth noting: the empty-q check runs before the tipo check, so a request with an invalid `tipo` but no `q` returns `[]` rather than 400. This matches the "empty-list short-circuit when q absent" requirement — a term-less autocomplete request short-circuits regardless of tipo.

### Auth, context, and delegation parity with clientes

`autenticar = criarMiddlewareAuth(authService)` is installed via `router.use(autenticar)` ahead of every route, so all four endpoints are gated — the 401 tests for GET, POST, PUT, and GET :id confirm this. `construirContexto` produces `{ tenantId: req.usuario.tenantId, usuarioId: req.usuario.id, ip: req.ip ?? undefined, userAgent: req.headers['user-agent'] ?? undefined }`, identical to the cliente router. POST returns 201, PUT and GET :id return 200, and every handler forwards service rejections through `next(err)`, so `AppError(409)`, `AppError(404)`, and the service's own `AppError(400, 'CNPJ inválido')` all reach `errorHandler` with no re-validation in the route.

### Schema shape and update exclusions

`atualizarEmpresaSchema` lists exactly `razaoSocial`, `nomeFantasia`, `email`, `telefone`, `endereco` — the same five fields as the repository's `AtualizarEmpresaInput`, with `tipo` and `cnpj` omitted. Because Zod `z.object` strips unknown keys by default, a PUT body carrying `tipo` or `cnpj` has those keys dropped before reaching the service, so the exclusion is enforced at runtime, not just at the type level. `email` is `z.string().email().optional()` in both schemas, and the create schema keeps `cnpj` optional and free-form so the service owns the checksum.

### Test coverage

The suite's 18 cases cover the GET matrix (q+tipo present, tipo defaulted, invalid tipo → 400 with `buscar` not called, empty-q → `[]` with `buscar` not called, 401), POST (201 with the exact dados forwarded, 400 on missing razaoSocial, 400 on bad tipo enum, 400 on bad email, 409 propagated, 400 CNPJ propagated, 401), PUT (200 with partial body forwarded, 404 propagated, 401), and GET :id (200, 404 propagated, 401). Assertions verify both the delegation arguments (`expect.objectContaining({ tenantId, usuarioId })` plus the term/tipo/id/dados) and that the service is not called on the short-circuit and validation-failure paths.

Not tested: the `desativar` service method has no DELETE route in this task (out of scope for the four-endpoint contract), so its absence from the suite is expected rather than a gap.

### Evidence note

The note at `empresas-routes-evidence.md` records new tests PASS 18/18 exit 0, `tsc --noEmit` clean outside `responsavel*`, lint clean exit 0, format applied with own files unchanged, and the full suite at 221 passing with 22/23 suites green. The single failing suite is `responsavel.service.test.ts`, which imports modules a parallel run has not committed; those files are untracked in this working tree and nothing in this commit imports them, so the failure is not attributable to task 25.

</details>

<details>
<summary>File map</summary>

- `backend/src/schemas/empresa.schema.ts` — new; `criarEmpresaSchema` and `atualizarEmpresaSchema` (shape-only, tipo/cnpj excluded from update).
- `backend/src/routes/empresas.routes.ts` — new; `criarEmpresasRouter` with router-level auth, tipo-filtered GET, and the four-endpoint contract.
- `backend/src/routes/__tests__/empresas.routes.test.ts` — new; 18 supertest cases.
- `backend/src/app.ts` — edited; additive empresa composition block mounted at `/api/empresas`.
- `.agents/tasks/empresas-routes-evidence.md` — new; build/test/lint evidence.

Full diff: `git show e1e57e7`.

</details>
