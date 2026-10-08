# Implementation Plan — Task 38: Gerador de PDF com Puppeteer

Escopo: criar `backend/src/lib/pdf.ts` (módulo baixo-nível que encapsula o
Puppeteer) e `backend/src/services/pdf.service.ts` (factory `criarPdfService`),
com testes Vitest em `__tests__/` ao lado de cada arquivo. Requisitos RF-016 e
RF-017. NÃO integra com envio/versionamento (Tarefa 40), NÃO implementa QR Code
(Tarefa 39), NÃO altera `versionamento.service.ts` nem
`orcamento-versao.repository.ts`.

## Decisões de design (fundamentadas no código lido)

- **`lib/pdf.ts` encapsula o Puppeteer.** Expõe `renderizarPdf(html: string):
  Promise<Buffer>`. Faz `puppeteer.launch()`, `browser.newPage()`,
  `page.setContent(html, { waitUntil: 'networkidle0' })`, `page.pdf({ format:
  'A4', printBackground: true })` e **sempre** fecha o browser (`finally`).
  Segue o padrão de módulo em `lib/` (ex.: `token.ts`, `crypto.ts`): funções
  exportadas, sem factory, sem estado externo persistente. O design (seção de
  stack) define Puppeteer como renderizador de PDF e `@page { size: A4 }` já é
  emitido pelo `html-renderer.service.ts`, então aqui reforçamos `format: 'A4'`
  no `page.pdf`.
- **Hash SHA-256 sobre os BYTES do PDF.** `crypto.ts#hashDocumento` normaliza
  string (remove `.`, `-`, `/`) e serve para documentos CPF/CNPJ — **não** serve
  para bytes de PDF. Portanto o service usa `node:crypto` diretamente:
  `createHash('sha256').update(buffer).digest('hex')`. Não há helper reutilizável
  adequado; não duplicar `hashDocumento`.
- **`PDFS_DIR` é injetado, não lido de `env` dentro do service.** O
  `vitest.config.ts` NÃO define `PDFS_DIR`, então `env.PDFS_DIR` cairia no default
  `/var/ni-doc/pdfs` (não gravável e perigoso em teste). A factory
  `criarPdfService` recebe `pdfsDir: string` como dependência (DI, padrão
  `criar*` do projeto). O wiring real em `app.ts` (Tarefa 40, fora de escopo)
  passará `env.PDFS_DIR`; os testes passam um diretório temporário via
  `node:os`/`node:fs`.
- **Filesystem injetado para testabilidade.** A factory recebe um `fs` mínimo
  (`{ writeFile, readFile, access, mkdir }`) tipado por interface própria
  (`PdfFileSystem`). Default: `node:fs/promises`. Permite testar imutabilidade e
  ausência sem tocar o disco real nem depender do SO. O renderizador
  (`renderizarPdf`) também é injetado para que os testes do service mockem a
  geração sem Puppeteer.
- **Nome de arquivo estável e único:** `{numero}-v{versao}.pdf` (RF-016 critério
  7, confirmado no requirements.md). Ex.: `ORC-2026-0001-v1.pdf`. Deriva de
  `numero` + `versao`, que são exatamente os campos que o
  `html-renderer.service.ts` já exige em `RenderizarHtmlInput` (não vêm no
  snapshot). Isso torna a futura integração (Tarefa 40) natural.
- **Imutabilidade (DoD + RF-016.6 + design seção 1.1):** antes de gravar,
  `gerarPdf` verifica se o arquivo já existe (`access`). Se existir, **não
  regenera nem sobrescreve** — lê o arquivo existente, recomputa o hash e
  retorna o resultado (idempotência preservando o documento oficial). Decisão:
  tratar re-chamada como no-op de escrita, retornando o conteúdo já em disco.
  Documentar essa escolha no comentário de topo.
- **Assinatura de `gerarPdf` alinhada ao renderer.** `gerarPdf` recebe
  `{ html, numero, versao }`: o HTML já montado pelo `html-renderer.service.ts`
  (cujo `renderizar` é síncrono e devolve `string`), mais `numero`/`versao` para
  o nome do arquivo. Mantém o service desacoplado do snapshot/template (o
  chamador da Tarefa 40 monta o HTML e passa adiante). `buscarPdf` recebe
  `{ numero, versao }` e resolve o mesmo caminho.
- **Performance < 2s:** não exercitada com Chromium real em teste unitário
  (Puppeteer é mockado por velocidade/determinismo). Documentar em comentário
  que a renderização real é delegada ao Puppeteer e a meta de 2s é validada em
  integração/manual. Marcar como **needs verification during implementation**.
- **Erros:** `buscarPdf` lança `AppError(404, 'PDF não encontrado')` quando o
  arquivo não existe (não regenera — RF/design: "Se ausente, retorna erro").
  `renderizarPdf` propaga erros do Puppeteer limpos (sem engolir), garantindo o
  fechamento do browser no `finally`.

## Assinaturas públicas

`backend/src/lib/pdf.ts`
```ts
export async function renderizarPdf(html: string): Promise<Buffer>
```

`backend/src/services/pdf.service.ts`
```ts
export interface PdfFileSystem {
  writeFile(caminho: string, dados: Buffer): Promise<void>
  readFile(caminho: string): Promise<Buffer>
  access(caminho: string): Promise<void>        // rejeita se não existe
  mkdir(caminho: string, opts: { recursive: true }): Promise<string | undefined>
}

export interface GerarPdfInput {
  html: string
  numero: string   // ex.: 'ORC-2026-0001'
  versao: number   // ex.: 1
}

export interface GerarPdfResultado {
  buffer: Buffer
  caminho: string  // caminho absoluto do arquivo em disco
  hash: string     // SHA-256 hex dos bytes do PDF
}

export interface BuscarPdfInput {
  numero: string
  versao: number
}

export interface PdfService {
  gerarPdf(input: GerarPdfInput): Promise<GerarPdfResultado>
  buscarPdf(input: BuscarPdfInput): Promise<Buffer>
}

export interface PdfServiceDeps {
  pdfsDir: string
  renderizarPdf?: (html: string) => Promise<Buffer>   // default: lib/pdf.ts
  fs?: PdfFileSystem                                   // default: node:fs/promises
  hash?: (buffer: Buffer) => string                    // default: sha256 node:crypto
}

export function criarPdfService(deps: PdfServiceDeps): PdfService
```

Notas de implementação:
- Imports relativos com `.js` (Node16 ESM): `import { renderizarPdf } from '../lib/pdf.js'`,
  `import { AppError } from '../errors/app-error.js'`.
- Prettier: aspas simples, SEM ponto e vírgula, 2 espaços, trailing commas `all`,
  largura 100. Identificadores/comentários em pt-BR.
- Comentário de topo em cada arquivo no estilo dos demais services (bloco
  `// ----`), explicando propósito, escopo e decisões (imutabilidade, hash sobre
  bytes, mock de Puppeteer em teste, meta de 2s delegada ao Puppeteer).
- `gerarPdf`: resolve `caminho = join(pdfsDir, '${numero}-v${versao}.pdf')`;
  garante o diretório (`mkdir recursive`); se `access(caminho)` resolve (já
  existe) → lê o buffer existente, computa hash, retorna sem reescrever; senão →
  `renderizarPdf(html)`, computa hash, `writeFile`, retorna. Usar `node:path`.
- `buscarPdf`: resolve o mesmo caminho; `readFile`; em erro de ausência
  (`ENOENT` / `access` falhando) lança `AppError(404, 'PDF não encontrado')`.

## Ordem TDD (escrever teste → ver falhar → implementar → passar → refatorar)

- [ ] 1. Escrever `backend/src/lib/__tests__/pdf.test.ts` (RED) mockando o Puppeteer.
      Mock de `puppeteer` com `vi.mock('puppeteer', ...)` expondo
      `launch → browser { newPage → page { setContent, pdf }, close }`. Casos:
      (a) `renderizarPdf(html)` retorna o Buffer devolvido por `page.pdf`;
      (b) chama `page.pdf` com `{ format: 'A4', printBackground: true }` (assert
      via `expect(pageMock.pdf).toHaveBeenCalledWith(expect.objectContaining({
      format: 'A4' }))`); (c) `page.setContent` recebe o html; (d) `browser.close`
      é chamado mesmo quando `page.pdf` rejeita (envolver em try + assert no
      finally). O `page.pdf` do Puppeteer retorna `Uint8Array`; o mock devolve
      `Buffer.from(...)` e o teste valida `Buffer.isBuffer(resultado)`.
      Files: backend/src/lib/__tests__/pdf.test.ts
      Verify: `npm test -- src/lib/__tests__/pdf.test.ts` (de dentro de `backend/`)
      — os testes existem e FALHAM porque `pdf.ts` ainda não existe.

- [ ] 2. Implementar `backend/src/lib/pdf.ts` (GREEN).
      `renderizarPdf` com launch/newPage/setContent/pdf/close conforme as
      decisões; garantir `Buffer.from(resultado)` quando `page.pdf` devolver
      `Uint8Array`; `try/finally` para fechar o browser. Comentário de topo em
      pt-BR.
      Files: backend/src/lib/pdf.ts
      Verify: `npm test -- src/lib/__tests__/pdf.test.ts` — todos os testes passam.

- [ ] 3. Escrever `backend/src/services/__tests__/pdf.service.test.ts` (RED).
      Usar diretório temporário isolado: `await mkdtemp(join(tmpdir(),
      'nidoc-pdf-'))` em `beforeEach`, injetado como `pdfsDir`; `rm(dir, {
      recursive: true, force: true })` em `afterEach`. Preferir o `fs` real do
      `node:fs/promises` (default) apontado ao tmp dir para também cobrir a
      escrita/leitura em disco; injetar `renderizarPdf` como `vi.fn()` que
      devolve um Buffer fixo (NÃO lança Chromium). Casos:
      - `gerarPdf` retorna `{ buffer, caminho, hash }`: buffer é o do renderer,
        `caminho` termina em `ORC-2026-0001-v1.pdf`, e o arquivo existe em disco
        (`readFile` confere bytes).
      - `hash` é o SHA-256 hex dos bytes do PDF (comparar com
        `createHash('sha256').update(buffer).digest('hex')`).
      - imutabilidade: chamar `gerarPdf` duas vezes com o mesmo `numero/versao`
        não reescreve (o segundo retorno tem o mesmo buffer/hash do primeiro e
        `renderizarPdf` NÃO é chamado na segunda vez — `toHaveBeenCalledTimes(1)`).
      - A4: assert de que `renderizarPdf` recebeu o html (o formato A4 é
        responsabilidade do `lib/pdf.ts`, já coberto no passo 1; aqui garantir o
        encadeamento html→renderer).
      - `buscarPdf` retorna o PDF já armazenado (após `gerarPdf`, `buscarPdf`
        devolve o mesmo Buffer).
      - `buscarPdf` de arquivo ausente lança `AppError` com `statusCode: 404` e
        NÃO chama `renderizarPdf` (não regenera).
      Files: backend/src/services/__tests__/pdf.service.test.ts
      Verify: `npm test -- src/services/__tests__/pdf.service.test.ts` — testes
      existem e FALHAM (service inexistente).

- [ ] 4. Implementar `backend/src/services/pdf.service.ts` (GREEN).
      `criarPdfService` com defaults (`renderizarPdf` da lib, `fs` =
      `node:fs/promises`, `hash` = sha256 via `node:crypto`). Implementar
      `gerarPdf` (mkdir recursive, checagem de existência → no-op imutável,
      senão render+hash+write) e `buscarPdf` (readFile; ausência → AppError 404).
      Comentário de topo documentando: hash sobre bytes, imutabilidade/no-regen,
      meta de 2s delegada ao Puppeteer (não testada com Chromium real).
      Files: backend/src/services/pdf.service.ts
      Verify: `npm test -- src/services/__tests__/pdf.service.test.ts` — passam.

- [ ] 5. Refatorar e rodar a suíte completa + lint + build.
      Revisar nomes pt-BR, remover duplicação, garantir imports com `.js`.
      Files: (ajustes finos em) backend/src/lib/pdf.ts, backend/src/services/pdf.service.ts
      Verify (de dentro de `backend/`):
      - `npm test` — toda a suíte verde (nenhuma regressão).
      - `npm run lint` — sem erros.
      - `npm run build` — `tsc` compila sem erros de tipo (strict,
        noUncheckedIndexedAccess, noImplicitOverride).

- [ ] 6. Verificar cobertura.
      Files: nenhum (medição).
      Verify: `npm run test:coverage` — `src/lib/pdf.ts` em 100% de linhas/branches
      e `src/services/pdf.service.ts` ≥ 80%; threshold global de 80% permanece
      verde. Se `lib/pdf.ts` ficar < 100%, adicionar caso de teste faltante
      (ex.: ramo de erro com `browser.close` no finally) antes de concluir.

## Como o Puppeteer é mockado (passo 1)

```ts
import { vi } from 'vitest'

const pageMock = {
  setContent: vi.fn().mockResolvedValue(undefined),
  pdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
}
const browserMock = {
  newPage: vi.fn().mockResolvedValue(pageMock),
  close: vi.fn().mockResolvedValue(undefined),
}
vi.mock('puppeteer', () => ({
  default: { launch: vi.fn().mockResolvedValue(browserMock) },
}))
```
Puppeteer está no `node_modules` do root (hoisted por workspaces); o mock evita
baixar/lançar Chromium, mantendo os testes rápidos e determinísticos.

## Isolamento de PDFs de teste (passo 3)

Nunca usar o `PDFS_DIR` real. Em cada teste de service, criar um diretório
temporário com `mkdtemp(join(os.tmpdir(), 'nidoc-pdf-'))` e injetá-lo como
`pdfsDir`; limpar com `rm(dir, { recursive: true, force: true })` no `afterEach`.

## Comandos de verificação (resumo, rodar de `backend/`)

- `npm test` — suíte Vitest completa (DoD de "verde").
- `npm run lint` — ESLint.
- `npm run build` — `tsc` type-check.
- `npm run test:coverage` — thresholds (lib 100%, service ≥80%, global ≥80%).

## Pontos a confirmar durante a implementação (needs verification)

- **Meta < 2s (RF-016.2 / DoD):** não validável em teste unitário com Puppeteer
  mockado. Confirmar em integração/manual com Chromium real na Tarefa 40;
  registrar como pendência de verificação, não dismissar.
- **Formato do retorno de `page.pdf`:** nas versões recentes do Puppeteer retorna
  `Uint8Array`. Confirmar ao implementar e converter com `Buffer.from(...)` se
  necessário para honrar o contrato `Promise<Buffer>`.
- **Barrel/exports:** se algum índice de `services`/`lib` reexportar módulos,
  acrescentar as novas exportações apenas se estritamente necessário para
  compilar; caso contrário, não tocar em outros arquivos.
