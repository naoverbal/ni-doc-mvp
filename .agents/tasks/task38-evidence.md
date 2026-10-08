# Task 38 — Gerador de PDF com Puppeteer — Evidência

Primeira iteração (não havia `task38-review.json`). Implementado por TDD estrito
(RED → GREEN → refactor), seguindo `task38-plan.md`.

## Arquivos entregues

- `backend/src/lib/pdf.ts` — wrapper baixo-nível do Puppeteer. `renderizarPdf(html)`
  faz launch/newPage/setContent/pdf/close; A4 + `printBackground: true` + margens;
  browser sempre fechado no `finally`; converte `Uint8Array` → `Buffer`.
- `backend/src/services/pdf.service.ts` — factory `criarPdfService` com interfaces
  exportadas (`PdfService`, `GerarPdfInput`, `GerarPdfResultado`, `BuscarPdfInput`,
  `PdfServiceDeps`, `PdfFileSystem`). `gerarPdf` renderiza, calcula SHA-256 dos
  bytes, grava em `PDFS_DIR` (injetado) sob nome estável `{numero}-v{versao}.pdf`,
  retorna `{ buffer, caminho, hash }` e é imutável (não regenera/sobrescreve se o
  arquivo já existe — lê e recomputa o hash). `buscarPdf` lê o PDF armazenado; se
  ausente, lança `AppError(404, 'PDF não encontrado')` sem regenerar.
- `backend/src/lib/__tests__/pdf.test.ts` — Puppeteer mockado (sem Chromium);
  valida Buffer, opções A4, html em `setContent`, `browser.close` no sucesso e no
  erro.
- `backend/src/services/__tests__/pdf.service.test.ts` — renderer injetado como
  `vi.fn()`; `fs` real apontado a `mkdtemp` em `os.tmpdir()` (nunca o `PDFS_DIR`
  real), limpo no `afterEach`. Cobre: gerar+salvar+hash, hash SHA-256 dos bytes,
  encadeamento html→renderer, imutabilidade (renderer chamado 1×), `buscarPdf`
  retorna o armazenado, e ausência → `AppError 404` sem regenerar.

## Decisões (alinhadas ao plano e ao código real)

- Assinaturas de `gerarPdf({ html, numero, versao })` e `buscarPdf({ numero, versao })`
  alinhadas a `RenderizarHtmlInput` do `html-renderer.service.ts` (numero/versao não
  vivem no snapshot) para integração natural na Tarefa 40.
- Hash SHA-256 sobre os BYTES do PDF via `node:crypto` — `crypto.ts#hashDocumento`
  normaliza strings de documento e não serve para binário; não reutilizado.
- `pdfsDir`/`fs`/`renderizarPdf`/`hash` injetados (DI, padrão `criar*`): wiring real
  em `app.ts` (Tarefa 40) passará `env.PDFS_DIR`.
- Meta < 2s (RF-016.2) delegada ao Puppeteer com Chromium real; validada em
  integração/manual na Tarefa 40, não em teste unitário (Puppeteer mockado).

## Verificação (de `backend/`)

- `npm test` → 37 arquivos, 411 testes, todos passam (inclui os novos de pdf).
- `npm run test:coverage`:
  - `src/lib/pdf.ts` = 100% statements/branches/functions/lines.
  - `src/services/pdf.service.ts` = 100% lines/functions, 94.11% branches (≥80%).
  - Global = 98.49% lines (≥80%); todos os thresholds verdes.
- `npm run build` → `tsc` sem erros (strict + ESM Node16, imports `.js`).
- `npm run lint` → sem erros.

Temp dirs de teste limpos (nenhum `nidoc-pdf-*` remanescente). Nada commitado
(sem hook forçando); mudanças deixadas na working tree. `tasks.md` não alterado.
