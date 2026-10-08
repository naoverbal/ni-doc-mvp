# Cliente REST routes with Zod validation and auth gating (v2)

Task 23 adds the four-endpoint cliente REST surface (`backend/src/routes/clientes.routes.ts`), the Zod schemas that shape-validate its POST/PUT bodies (`backend/src/schemas/cliente.schema.ts`), a full route-level test suite (`backend/src/routes/__tests__/clientes.routes.test.ts`), and the `app.ts` wiring that composes the service and mounts the router at `/api/clientes`. The router follows the existing factory + dependency-injection convention, delegates all business rules to the already-reviewed cliente service, and leans on the shared `validate` and auth middlewares rather than reimplementing anything. GET without `q` short-circuits to an empty list without touching the service, and every endpoint sits behind `router.use(autenticar)`.

This is the v2 pass. The implementation code is unchanged from v1 (same commit `77db5d4`), which v1 confirmed had no code-level defects. The sole v1 finding — missing quality-gate evidence (MEDIUM) — is now resolved by commit `29a54b9`, which records build (exit 0), tests (16 passed / 16), lint (0 errors / 0 warnings), and format (all task-23 files unchanged) in `.agents/tasks/clientes-evidence.md`.

Watch for: nothing blocking. The one previously-open concern is closed by the recorded evidence (**confirmed**).

**Verdict**: APPROVED

## High-level view

The router is created by `criarClientesRouter(clienteService, authService)` and installs `autenticar` as router-level middleware, so authentication gates all four routes uniformly — no per-route repetition and no way to add a route that silently skips auth. Each handler builds a `ClienteContexto` from `req.usuario`, `req.ip`, and the user-agent header, then calls the service and lets any thrown `AppError` reach the central `errorHandler` via `next(err)`. There is no business re-validation in the routes.

Validation is split correctly between layers. `criarClienteSchema` enforces only the shape (required `tipoPessoa` enum, non-empty `nome`/`documento`, optional contact fields, email format); the CPF/CNPJ checksum stays in the service, which raises `AppError(400)`. `atualizarClienteSchema` makes every field optional and omits `tipoPessoa`/`documento`, matching the repository's `AtualizarClienteInput` field-for-field, so the type casts in the PUT handler are sound.

The `app.ts` wiring reuses the single `db` instance and the already-constructed `auditoriaService`, builds the cliente repo/service, mounts at `/api/clientes`, and keeps `errorHandler` registered last. No DELETE/desativar route is exposed, which is correct for scope even though the service still carries a `desativar` method.

The v1 gap was process, not code, and it is now closed: `.agents/tasks/clientes-evidence.md` records `npm run build` (exit 0, no TS errors), the targeted vitest run (16/16 passed), `npm run lint` (clean), and `npm run format` (task-23 files already compliant).

<details>
<summary>Issues (0)</summary>

No open findings. The v1 MEDIUM finding (missing quality-gate evidence) is resolved by commit `29a54b9`.

</details>

<details>
<summary>Details</summary>

### Resolution of the v1 evidence finding

v1 raised one MEDIUM: the coder's required build/test/lint results were not recorded anywhere the review step could read. Commit `29a54b9` adds `.agents/tasks/clientes-evidence.md`, which records the targeted test run (`16 passed (16)`, exit 0), `npm run build` (exit 0, no TypeScript errors under strict mode), `npm run lint` (zero errors, zero warnings), and `npm run format` (all four task-23 files reported unchanged). The recorded test names map one-to-one onto the cases in the committed suite, and the note correctly states no code changes were needed. This closes the only open concern from v1.

### Uniform auth gating via router-level middleware

`criarMiddlewareAuth(authService)` is installed once with `router.use(autenticar)` ahead of every route definition, so GET `/`, POST `/`, PUT `/:id`, and GET `/:id` all require a valid `session` cookie. This makes it structurally impossible to add a cliente route that forgets auth, versus repeating `autenticar` per handler. The middleware returns 401 for a missing cookie and 401 (plus `clearCookie`) for an invalid/expired session, and only then populates `req.usuario`/`req.sessao`. The suite exercises the 401 path for all four endpoints.

### Validation split: shape in Zod, checksum in the service

`criarClienteSchema` validates only structure — `tipoPessoa` as a `['PF','PJ']` enum, non-empty `nome` and `documento`, optional format-checked `email`, and optional `telefone`/`endereco`/`observacoes`. The document checksum deliberately lives in the service (`validarDocumento` → `AppError(400, 'CPF inválido' | 'CNPJ inválido')`), so an invalid-but-well-formed document string passes the schema and is rejected downstream. The tests confirm both directions: schema rejections (missing `nome`, bad enum, bad email) return 400 without the service being called, and a service-side `AppError(400, 'CPF inválido')` surfaces as 400 with the service invoked.

`atualizarClienteSchema` makes all fields optional and omits `tipoPessoa`/`documento`, matching `AtualizarClienteInput` (`nome?`, `email?`, `telefone?`, `endereco?`, `observacoes?`) exactly, which is why the `dados as AtualizarClienteInput` cast in the PUT handler is sound rather than papering over a mismatch. The POST handler's `dados as CriarClienteDados` is likewise backed by `CriarClientePayload` being structurally identical to `CriarClienteDados`.

### GET list short-circuit and context construction

```
const q = req.query['q']
if (typeof q !== 'string' || q.length === 0) {
  res.json([])
  return
}
```

When `q` is absent, empty, or arrives as an array (Express can parse repeated params into `string[]`), the handler returns `[]` and never calls `clienteService.buscar`. The `typeof q !== 'string'` guard covers the array case too, so `buscar` is only ever reached with a non-empty string. Both branches are tested: `q=ana` asserts `buscar` is called with the context and the term; the no-`q` case asserts a 200 with `[]` and `buscar` not called.

`construirContexto` reads `tenantId`/`id` off `req.usuario` (populated by the auth middleware) and maps `req.ip`/`user-agent` through `?? undefined` so the optional `ClienteContexto` fields stay `undefined` rather than `null`. The POST/PUT/GET-by-id tests assert the context carries `tenantId: 'tenant-1'` and `usuarioId: 'user-1'`.

### Scope and the unused desativar method

No DELETE or desativar route is exposed, which is correct for the MVP scope — but the service still carries a `desativar` method that is now unreachable from the HTTP layer. That is intended; flagging it only so it isn't mistaken for a dropped route later.

### Test coverage

The suite covers every required case: GET with `q` (200 + array), GET without `q` (200 + empty, service not called), POST happy path (201 + context assertion), POST schema rejections (missing nome, bad enum, bad email → 400, service not called), POST service errors (409, 400), PUT happy path (200 + context + id + body), PUT 404, GET-by-id happy path (200), GET-by-id 404, and 401 for all four endpoints. The router tests build their own Express app with `express.json()`, `cookieParser()`, and the real `errorHandler`, so the full middleware chain is exercised end-to-end against mocked services.

Not tested: no case asserts the GET list short-circuit for a non-string (array) `q`, though the guard handles it; this is a minor coverage note, not a defect.

</details>

<details>
<summary>File map</summary>

- `backend/src/routes/clientes.routes.ts` — new router factory: four endpoints, router-level `autenticar`, `validate` on POST/PUT, context builder, `next(err)` delegation.
- `backend/src/schemas/cliente.schema.ts` — `criarClienteSchema` (shape-only) and `atualizarClienteSchema` (all-optional, no tipoPessoa/documento) plus inferred payload types.
- `backend/src/routes/__tests__/clientes.routes.test.ts` — route-level suite covering happy paths, Zod rejections, service AppError surfacing, and 401 on every endpoint.
- `backend/src/app.ts` — wires `clienteRepo`/`clienteService` reusing `db` and `auditoriaService`, mounts at `/api/clientes`, keeps `errorHandler` last.
- `.agents/tasks/clientes-evidence.md` — recorded build/test/lint/format evidence (commit `29a54b9`), resolving the v1 finding.

Full diff: `git show 77db5d4`.

</details>
