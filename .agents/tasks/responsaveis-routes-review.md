# REST routes for responsáveis técnicos (`/api/responsaveis`)

Task 27 adds the HTTP surface for technical-responsible records: a shape-only Zod schema pair, a four-endpoint Express router (`criarResponsaveisRouter`), a mirror test suite, and an additive wiring block in `app.ts`. The router is a near-exact copy of the empresas router with the `tipo` filter stripped out, since responsáveis have no type dimension and no document, hence no business re-validation in the route layer. Validation is shape-only; the service owns 404 semantics and auditing. The evidence note records a clean build, a passing full suite (244 tests, 13 new), and clean lint/format.

**Watch for:** nothing blocking — the implementation matches the established clientes/empresas pattern faithfully, and I confirmed the service/repository type contracts line up with the route's casts (confirmed).

**Verdict**: APPROVED

## High-level view

The router gates all four endpoints uniformly through `router.use(autenticar)` built from the shared `AuthService`, so GET list, POST, PUT, and GET-by-id are all behind the same auth check. The GET list short-circuits to `[]` when `q` is absent or empty and never calls the service with an undefined term; unlike empresas, there is no `tipo` query parameter and no `tipo`-validation branch, which is correct for this entity.

Validation is wired as `validate(criarResponsavelSchema)` on POST and `validate(atualizarResponsavelSchema)` on PUT. Both schemas are shape-only — `nome` required non-empty on create, everything optional on update, `email` constrained to `email()` — with no checksum or duplicate logic, matching the fact that responsáveis carry no document. The route delegates all failures via `next(err)` and does no business re-validation; the service is the sole owner of the 404 for missing records.

Context construction reads `tenantId`/`id` from `req.usuario` and `ip`/`user-agent` from the request, coalescing to `undefined`, exactly as the sibling routers do. The `app.ts` change is purely additive: it reuses the existing `db` and `auditoriaService`, adds one repository/service/router composition block, mounts at `/api/responsaveis`, and leaves `errorHandler` last.

The test suite mirrors the clientes/empresas suites: per-test Express app, mocked `AuthService` and `ResponsavelService`, supertest, a 401 case per method, and `clearAllMocks` in each `beforeEach`. Coverage includes the empty-`q` short-circuit, 201/200 happy paths, 400 on invalid body and invalid email, and 404 propagation from the service on PUT and GET-by-id.

<details>
<summary>Issues (0)</summary>

No blocking or non-blocking issues surfaced. The implementation faithfully mirrors the established route pattern.

</details>

<details>
<summary>Details</summary>

## Type-cast soundness at the route boundary

The route casts `req.body` to the Zod-inferred payload type and then to the service input type (`CriarResponsavelDados`, `AtualizarResponsavelInput`). I checked both targets: `CriarResponsavelDados` in `responsavel.service.ts` and `AtualizarResponsavelInput` in `responsavel.repository.ts` are structurally identical to the schema shapes (same optional fields, same types), so the casts are sound rather than papering over a mismatch (confirmed).

## Additive app.ts wiring

The composition block adds `criarResponsavelRepository(db)` and `criarResponsavelService({ responsavelRepo, auditoriaService })`, reusing the already-constructed `db` and `auditoriaService`, then mounts `criarResponsaveisRouter(...)` at `/api/responsaveis`. `app.use(errorHandler)` remains the final registration. No pre-existing lines were disturbed (confirmed via `git show e281dca` — the only app.ts change is +8 lines).

## Test suite mirrors the sibling pattern

The suite uses a per-test `makeApp` that builds a fresh Express app with `express.json()`, `cookieParser()`, the router, and `errorHandler`; `AuthService` and `ResponsavelService` are fully mocked via factory helpers with override support; `beforeEach(vi.clearAllMocks)` runs in each describe block. Covered: `q`-present 200 with service-call assertion, empty-`q` short-circuit, POST 201 with argument assertion, 400 on missing `nome`, 400 on invalid email, PUT 200 partial update, 404 propagation on PUT and GET-by-id, and a 401 per method.

Not tested: the `desativar` service method has no route (none expected), so it is correctly absent from the HTTP tests. There is no explicit test that the service is *not* called on a 401 (the auth middleware short-circuits before the handler), but this is a minor gap consistent with the sibling suites and not worth blocking on.

## Style and conventions

All relative imports carry the `.js` extension (ESM/Node16). Identifiers and comments are pt-BR. Prettier conventions hold: single quotes, no semicolons, 2-space indent, trailing commas, width within 100. The evidence note reports `npm run format` left the new files unchanged (confirmed by reading the evidence; not re-run per instructions).

</details>

<details>
<summary>File map</summary>

- `backend/src/schemas/responsavel.schema.ts` — new shape-only Zod schemas (`criarResponsavelSchema`, `atualizarResponsavelSchema`) plus inferred payload types.
- `backend/src/routes/responsaveis.routes.ts` — new `criarResponsaveisRouter` factory: router-level auth, four endpoints, `next(err)` delegation, no `tipo` param.
- `backend/src/routes/__tests__/responsaveis.routes.test.ts` — new mirror test suite (13 tests).
- `backend/src/app.ts` — additive +8 lines wiring repository/service/router at `/api/responsaveis`; errorHandler stays last.

Full diff: `git show e281dca`.

</details>
