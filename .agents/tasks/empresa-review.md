# Repositório e serviço de empresas (task 24)

Adds an `empresa` repository and service that mirror the shipped `cliente` modules while adapting to the empresas domain: a `tipo` enum (`tenant` | `cliente_pj`), `razao_social` (required) plus optional `nome_fantasia` in place of a single `nome`, an **optional** CNPJ (validate/hash/encrypt and duplicate-check only when present), no `observacoes`, and a type-aware autocomplete `buscarPorNomeETipo`. The adaptation is a genuine rework of the pattern, not a blind copy: the optional-CNPJ branching, the extra `tipo` filter, and the dropped `observacoes` field are all handled deliberately and match the `empresas` DDL. Encryption, audit wiring, error codes, DI factory style, ESM imports, and pt-BR naming all follow the established conventions.

Watch for: nothing blocking. The optional-CNPJ branching and the empresas DDL match, encryption and audit wiring follow the shipped cliente contract, and scope stayed to repo+service+tests. (confidence: confirmed)

**Verdict**: APPROVED

## High-level view

The optional-CNPJ logic is the central difference from cliente and it is implemented correctly on both layers. The service only validates, hashes, and runs the duplicate check when `cnpj !== undefined`; the repository writes `cnpj_hash` and `cnpj_encrypted` as `null` together when CNPJ is absent and as hash+ciphertext together when present. The two columns can never drift out of sync. This matches the nullable `cnpj_hash`/`cnpj_encrypted` columns in the migration.

The autocomplete requirement (RF-011.2) is met: `buscarPorNomeETipo` filters on `tipo`, `ativo = true`, and `razao_social ILIKE %termo%`, orders by `razao_social`, and caps at 20. The extra `tipo` predicate is the meaningful addition over cliente's `buscarPorNome` and is asserted in the repo test.

Field encryption follows the cliente model exactly: `cnpj`/`email`/`telefone`/`endereco` are encrypted at rest and read back through `descriptografarOpcional`, while `razao_social`/`nome_fantasia`/`tipo` stay plaintext (they drive search and are non-sensitive). Audit events use entidade `'empresas'` with `criar`/`atualizar`/`desativar`, and the status codes (400 invalid CNPJ, 404 not found, 409 duplicate) line up with the cliente contract.

Scope is clean: only the repository, service, and their tests were added. No routes, schemas, `app.ts`, or shipped modules were touched — consistent with the evidence note deferring routes to task 25. The evidence note records build, full suite (194 passed), lint, and coverage all green.

<details>
<summary>Issues (0)</summary>

No actionable concerns. All review criteria (optional-CNPJ handling, type-aware autocomplete, encryption boundary, audit/error contract, conventions, scope) are satisfied and the coder's gate evidence records build, full suite, lint, and coverage all passing.

</details>

<details>
<summary>Details</summary>

### Optional CNPJ handled symmetrically across both layers

The service guards the entire CNPJ pipeline behind `if (dados.cnpj !== undefined)`: validation (`validarCNPJ` → 400), hash computation, and the `buscarPorCnpjHash` duplicate lookup (→ 409) all run only when a CNPJ was supplied. When it is absent, the service skips straight to `criar` with no validation and no duplicate check — exactly the RF-011 behavior for empresas that may have no CNPJ (e.g. the tenant's own company before registration data is filled in).

The repository mirrors this: `cnpjHash` and `cnpjEncrypted` are each computed as `input.cnpj !== undefined ? ... : null`. Because both derive from the same guard, the hash and ciphertext columns are always written together or both left null — there is no code path that writes one without the other. The `grava cnpj_hash e cnpj_encrypted como null quando CNPJ ausente` test asserts the null-null case against the actual `values()` payload, which is the right level to pin this invariant.

### Type-aware autocomplete (RF-011.2)

```
buscarPorNomeETipo(tenantId, termo, tipo)
  where tenant_id = tenantId
  where tipo = tipo            <-- the differentiator vs cliente.buscarPorNome
  where ativo = true
  where razao_social ILIKE %termo%
  order by razao_social asc
  limit 20
```

The `tipo` predicate is the deliberate addition that cliente's `buscarPorNome` lacks, and the repo test asserts all three `where` calls (`razao_social ilike %acme%`, `tipo = cliente_pj`, `ativo = true`). The service's `buscar` passes `tipo` straight through and the service test confirms the delegation signature.

### Encryption boundary

`cnpj`, `email`, `telefone`, and `endereco` are stored as `*_encrypted` and decrypted on read via `descriptografarOpcional` (null-safe), identical to cliente. `razao_social`, `nome_fantasia`, and `tipo` are kept plaintext — correct, since `razao_social` backs the ILIKE search and `tipo` backs an indexed filter, and neither is sensitive. The `COLUNAS_PUBLICAS` projection and `EmpresaRow` shape match the `EmpresaTable` interface and the `001_initial_schema.sql` DDL column-for-column, including the absence of any `observacoes` column.

### Audit and error contract

`criar`/`atualizar`/`desativar` each call `auditoriaService.registrar` with entidade `'empresas'` and the matching `acao`; `atualizar` additionally records `estadoNovo: dados`, consistent with cliente. Error codes: 400 for invalid CNPJ, 404 for not-found on `buscarPorId`/`atualizar`/`desativar`, 409 for a duplicate CNPJ hash within the tenant. `desativar` and `buscarPorId` guard with a prior existence check so a 404 is thrown before the soft-delete runs, and the test asserts `desativar` is not called in the not-found case.

### Conventions and scope

DI factory style (`criarEmpresaRepository` / `criarEmpresaService` taking deps as arguments), exported interfaces for inputs/outputs (`CriarEmpresaInput`, `AtualizarEmpresaInput`, `EmpresaPublica`, the repo/service interfaces), ESM relative imports with `.js` extensions, pt-BR identifiers, and Prettier style (no semicolons, single quotes, trailing commas, 2-space indent) are all present. Only the four task files plus the evidence note were added; cliente and other shipped modules are untouched, and there are no route/schema/`app.ts` changes (deferred to task 25 per the evidence note).

### Gates (from evidence note, not re-run)

The evidence note at `.agents/tasks/empresa-evidence.md` records: new tests exit 0 (26 passed), `npm run build` exit 0, `npm run lint` exit 0, full suite exit 0 (194 passed, no regressions), and coverage of 100% stmts / 100% funcs with 91–98% branch on repositories/services — above the 80% target. All required gates passed.

</details>

<details>
<summary>File map</summary>

- `backend/src/repositories/empresa.repository.ts` — new Kysely repository; optional-CNPJ hash/encrypt, `buscarPorNomeETipo`, field encryption with null-safe decrypt.
- `backend/src/repositories/__tests__/empresa.repository.test.ts` — repo unit tests (fluent-builder mocks); covers null-null CNPJ, encryption, type filter, soft delete.
- `backend/src/services/empresa.service.ts` — new service; conditional CNPJ validation/duplicate-check, audit wiring, 400/404/409 errors.
- `backend/src/services/__tests__/empresa.service.test.ts` — service unit tests; covers with/without CNPJ, invalid/duplicate CNPJ, 404 paths, audit assertions.
- `.agents/tasks/empresa-evidence.md` — coder's gate evidence (build/test/lint/coverage).

Full diff: `git diff main -- backend/src/repositories/empresa.repository.ts backend/src/services/empresa.service.ts`

</details>
