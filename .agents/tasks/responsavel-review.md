# Responsável técnico repository + service (task 26)

Task 26 adds a repository and service for responsáveis técnicos, adapting the existing cliente/empresa pattern down to a simpler domain: a mandatory plaintext `nome`, an optional plaintext `registro_profissional`, and optional encrypted `email`/`telefone`. There is no document/CPF/CNPJ anywhere, so none of the document machinery (`hashDocumento`, `documento_encrypted`, `buscarPorDocumentoHash`, duplicate-by-document checks) is carried over. The repository owns all Kysely queries and maps `snake_case` rows to a `camelCase` `ResponsavelPublico`; the service wraps it with 404 handling and audit logging under the `responsaveis_tecnicos` entity. The commit `acba86e` touches exactly the four responsavel files plus the evidence note.

Watch for: nothing blocking. The implementation faithfully mirrors the cliente pattern minus the document surface, columns match the DDL, encryption/nullable handling is correct, and the evidence note records a clean build, lint, 19 passing new tests, full-suite regression green, and ≥80% coverage (100% stmts / 90.32% branch). (confirmed)

**Verdict**: APPROVED

## High-level view

The repository drops every document-related concern cleanly. There is no `documento` field on any input/output interface, no `hashDocumento`/`documento_encrypted` write, and no `buscarPorDocumentoHash` method — the domain is a plain searchable contact record. `registro_profissional` is written and read as plaintext with `?? null`, while `email`/`telefone` go through `criptografar` on write (encrypt-when-provided-else-null) and `descriptografarOpcional` on read, matching the cliente convention exactly.

The `COLUNAS_PUBLICAS` tuple and `ResponsavelRow` interface line up with the `responsaveis_tecnicos` DDL: `id, tenant_id, nome, registro_profissional, email_encrypted, telefone_encrypted, ativo, criado_em`. `atualizado_em` is written on updates but correctly excluded from the public projection. `buscarPorNome` is autocomplete-style — ILIKE `%termo%` on `nome`, `ativo = true`, `order by nome asc`, `limit 20`, with no type filter (there is no type to filter on here).

The service layer adds the expected 404s via `AppError(404, ...)` on `buscarPorId`, `atualizar`, and `desativar`, and audits `criar`/`atualizar`/`desativar` under entidade `'responsaveis_tecnicos'`. Wiring follows the `criar*` DI factory style with exported interfaces throughout. Scope is clean: the reviewed commit modifies only repo + service + their tests + the evidence note — no routes, schemas, app.ts, or empresa/cliente edits.

<details>
<summary>Issues (0)</summary>

No blocking or non-blocking action items. The implementation matches the brief on every checked point.

</details>

<details>
<summary>Details</summary>

## No document surface — the intended simplification

## Encryption-on-update detail

On `atualizar`, `email`/`telefone` are encrypted unconditionally when present (`!== undefined`), so an empty-string value would be stored encrypted rather than nulled. This mirrors `cliente.repository.ts` exactly, so it is not a new concern introduced by this task — flagged only as a shared behavior to be aware of. (confirmed)

## Scope boundary

The reviewed commit `acba86e` changes only `responsavel.repository.ts`, `responsavel.service.ts`, their two test files, and `responsavel-evidence.md` — no routes, schemas, `app.ts`, or empresa/cliente edits. The working tree has unrelated uncommitted changes to cliente/env/auth files, but those are outside this commit and outside task 26's scope. (confirmed)

## Test coverage

The repository tests mock the Kysely fluent builders and cover: create (encrypts email/telefone, writes `registro_profissional` plaintext, decrypts on return, writes missing optionals as `null`), `buscarPorId` (null when absent, decrypts when present), `buscarPorNome` (asserts both the `ilike '%joa%'` and `ativo = true` predicates), `atualizar` (targets `responsaveis_tecnicos`, returns the row, null when absent), and `desativar` (sets `ativo: false`). The service tests cover create + audit, `buscarPorId` found/404, `buscar` delegation, `atualizar` success/404/audit, and `desativar` success+audit/404-without-calling-repo. The evidence note records 19 new tests passing, full suite 231 passing, build/lint clean, and coverage 100% stmts / 90.32% branch / 100% funcs — above the 80% floor.

Not tested: the `buscarPorNome` test does not assert `orderBy('nome', 'asc')` or `limit(20)` were applied (both are present in the implementation but unverified by assertion); and `atualizar`'s per-field conditional set and email/telefone encryption-on-update are not directly asserted. These are minor assertion gaps, not behavioral defects, and the branch-coverage number already reflects them. (confirmed)

</details>

<details>
<summary>File map</summary>

- `backend/src/repositories/responsavel.repository.ts` — new repository: Kysely queries, row↔domain mapping, encrypted email/telefone, plaintext nome/registro.
- `backend/src/repositories/__tests__/responsavel.repository.test.ts` — repository tests over mocked Kysely builders.
- `backend/src/services/responsavel.service.ts` — new service: 404 handling + audit under `responsaveis_tecnicos`.
- `backend/src/services/__tests__/responsavel.service.test.ts` — service tests (delegation, 404s, audit).
- `.agents/tasks/responsavel-evidence.md` — build/lint/test/coverage evidence.

Full diff: `git show acba86e`.

</details>
