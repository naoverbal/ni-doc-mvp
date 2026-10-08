# PDF generator lib + service for ni-doc (Task 38)

Task 38 adds a two-layer PDF capability to the backend: `lib/pdf.ts`, a thin Puppeteer wrapper that turns a pre-built HTML string into an A4 PDF `Buffer`, and `services/pdf.service.ts`, a `criarPdfService` factory that renders, SHA-256-hashes the bytes, writes to an injected `pdfsDir` under a stable `{numero}-v{versao}.pdf` name, and treats an already-emitted PDF as immutable (no overwrite, no regeneration). `buscarPdf` reads a stored PDF and throws `AppError(404)` when it is absent, never regenerating. The signatures (`{ html, numero, versao }` / `{ numero, versao }`) are deliberately aligned with `RenderizarHtmlInput` from `html-renderer.service.ts` so the Task 40 send→PDF integration drops in naturally. All four deliverables are present and consistent with both the plan and the task definition in `tasks.md` (lines 251-255).

Watch for: nothing blocking. The immutable-reuse path and the absent-file path were both verified against the code (confirmed). The <2s performance DoD (RF-016.2) is explicitly delegated to real Chromium and deferred to Task 40 integration/manual verification (confirmed, by design in the plan). A benign TOCTOU gap exists between the `access` existence check and `writeFile` (possible), out of scope for a single-writer immutable document service.

**Verdict**: APPROVED

## High-level view

The layering is clean. `lib/pdf.ts` owns the entire browser lifecycle and nothing else, closing the browser unconditionally in `finally` so a Puppeteer failure cannot leak a Chromium process, and converting the `Uint8Array` from `page.pdf` to a `Buffer` to honor the `Promise<Buffer>` contract.

Dependencies (`pdfsDir`, `renderizarPdf`, `fs`, `hash`) are injected via the `criar*` factory with real defaults, so production wiring in Task 40 passes `env.PDFS_DIR` while tests inject a temp dir and a fake renderer. The hash is SHA-256 over the PDF bytes via `node:crypto` directly — the plan correctly rejected `crypto.ts#hashDocumento`, which normalizes document strings and is wrong for binary.

Immutability is enforced on both paths: `gerarPdf` checks existence first and, if present, re-reads the stored bytes and recomputes the hash rather than re-rendering; `buscarPdf` reads or throws `AppError(404)` and never regenerates. The `AppError(404, ...)` call matches the error class's `(statusCode, message)` signature.

Scope is respected. Only the four intended files are added (git status shows no modifications to `versionamento.service.ts` or `orcamento-versao.repository.ts`, no Task 40 wiring, no QR code). Tests mock Puppeteer and use isolated `mkdtemp` temp dirs, never the real `PDFS_DIR`.

<details>
<summary>Issues (1)</summary>

1. **TOCTOU on generation path (non-blocking)** — a concurrent double-send could race between the `access` existence check and `writeFile`. Harmless for the current single-writer immutable model; worth a note if Task 40 ever introduces concurrent generation. No action required for Task 38.

</details>

<details>
<summary>Details</summary>

### Puppeteer lifecycle and A4 contract

The `finally` placement around `browser.close()` is what prevents a Chromium leak: the test `fecha o browser mesmo quando page.pdf rejeita` confirms the browser is closed on the error path and the rejection propagates unswallowed (confirmed). The `Buffer.from(pdf)` conversion addresses the `Uint8Array` return shape the plan flagged, asserted via `Buffer.isBuffer` (confirmed).

### Immutability and the hash

The existence guard in `gerarPdf` is the RF-016.6 immutability guarantee: when the file exists, the service re-reads stored bytes and recomputes the hash rather than re-rendering. The test calls `gerarPdf` twice with the same `numero/versao` and asserts `renderizarPdf` ran exactly once with identical buffer/hash/caminho across calls (confirmed). The hash is `createHash('sha256').update(buffer).digest('hex')` over the exact bytes on disk, and the test independently recomputes the same expression to assert equality (confirmed).

### buscarPdf absence handling

`buscarPdf` maps any read failure to `AppError(404, 'PDF não encontrado')`; the test asserts `statusCode: 404`, `instanceof AppError`, and that `renderizarPdf` is never invoked on the absent path (confirmed), satisfying RF-017's "return error, do not regenerate". Mapping all read errors to 404 (rather than distinguishing ENOENT from a permission error) is a minor simplification; acceptable here since a missing emitted PDF is the expected failure and the service is the sole writer.

### Dependency injection and defaults

The extra test `usa os defaults (fs e hash reais)` exercises the default `fs`/`hash` adapter against the temp dir, so the production default path is not left uncovered. `mkdir(deps.pdfsDir, { recursive: true })` runs before the first write, creating a fresh `PDFS_DIR` on demand.

### Test isolation

Service tests target `mkdtemp(join(tmpdir(), 'nidoc-pdf-'))` and clean up in `afterEach`; the real `PDFS_DIR` is never touched (confirmed). The lib test mocks `puppeteer` at module level with a dynamic `await import('../pdf.js')`, so no Chromium is launched. Puppeteer 22.15.0 is in the backend package and hoisted to the root `node_modules`, so the mock target resolves (confirmed).

### Conventions and verification evidence

ESM `.js` imports, single quotes, no semicolons, pt-BR identifiers, the exported `PdfService` interface, the `criar*` factory, and the documented top-of-file comment blocks are all in place. The evidence file records 411 tests passing across 37 files, `lib/pdf.ts` at 100% and `pdf.service.ts` at 100% lines / 94.11% branches, clean `tsc` build and lint. Per the review instructions these suites were not re-run; the evidence is specific and internally consistent with the code read here, leaving no articulable doubt that warranted a spot-check.

### Scope

`git status` shows only the four intended source files plus task docs as untracked, with no modifications to `versionamento.service.ts`, `orcamento-versao.repository.ts`, or any Task 40/39 artifact. QR code and send-integration are absent, as required.

</details>

<details>
<summary>File map</summary>

- `backend/src/lib/pdf.ts` — Puppeteer wrapper: HTML → A4 PDF Buffer, browser closed in finally.
- `backend/src/lib/__tests__/pdf.test.ts` — mocked-Puppeteer tests: Buffer, A4 options, html passthrough, close on success/error.
- `backend/src/services/pdf.service.ts` — `criarPdfService`: render + SHA-256 + immutable write; `buscarPdf` with 404.
- `backend/src/services/__tests__/pdf.service.test.ts` — temp-dir isolated tests: generate/hash/immutability/buscar/absent-404/defaults.

Changes are untracked in the working tree (not committed). Full diff: `git -C /Users/nilson/Dev/ni-doc diff` after staging, or inspect the four files above.

</details>
