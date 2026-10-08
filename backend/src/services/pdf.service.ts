import { createHash } from 'node:crypto'
import * as fsPromises from 'node:fs/promises'
import { join } from 'node:path'
import { renderizarPdf as renderizarPdfPadrao } from '../lib/pdf.js'
import { AppError } from '../errors/app-error.js'

// -----------------------------------------------------------------------------
// Serviço de geração e recuperação de PDFs de orçamento (RF-016, RF-017).
//
// Decisões de design:
//  - Hash SHA-256 sobre os BYTES do PDF (via `node:crypto`). `crypto.ts#hashDocumento`
//    normaliza strings de documento (CPF/CNPJ) e NÃO serve para bytes binários,
//    então não é reutilizado aqui.
//  - IMUTABILIDADE / sem regeneração: `gerarPdf` nunca sobrescreve um PDF já
//    existente. Se o arquivo já está em disco, lê o conteúdo existente, recomputa
//    o hash e retorna — tratando a re-chamada como no-op de escrita, preservando
//    o documento oficial emitido. `buscarPdf` nunca regenera: se o arquivo não
//    existe, lança `AppError(404)`.
//  - Dependências injetadas (padrão `criar*`): `pdfsDir` (o wiring real em
//    `app.ts`, na Tarefa 40, passa `env.PDFS_DIR`), além de `renderizarPdf`,
//    `fs` e `hash` com defaults — isso mantém o service testável sem Chromium
//    nem acesso ao `PDFS_DIR` real.
//  - Assinaturas alinhadas ao `html-renderer.service.ts`: `gerarPdf` recebe o
//    HTML já montado mais `numero`/`versao` (que não vivem no snapshot), de modo
//    que a integração envio→PDF (Tarefa 40) seja natural. O nome do arquivo é
//    estável e único: `{numero}-v{versao}.pdf` (RF-016.7).
//  - Meta de performance < 2s (RF-016.2) é responsabilidade do Puppeteer com
//    Chromium real, validada em integração/manual (Tarefa 40), não aqui.
// -----------------------------------------------------------------------------

// Subconjunto mínimo do `node:fs/promises` usado pelo serviço. Permite injetar
// um filesystem alternativo nos testes sem depender do SO.
export interface PdfFileSystem {
  writeFile(caminho: string, dados: Buffer): Promise<void>
  readFile(caminho: string): Promise<Buffer>
  access(caminho: string): Promise<void>
  mkdir(caminho: string, opts: { recursive: true }): Promise<string | undefined>
}

export interface GerarPdfInput {
  // HTML já montado pelo `html-renderer.service.ts`.
  html: string
  // Número do orçamento (ex.: 'ORC-2026-0001') — compõe o nome do arquivo.
  numero: string
  // Número da versão (ex.: 1) — compõe o nome do arquivo.
  versao: number
}

export interface GerarPdfResultado {
  buffer: Buffer
  // Caminho absoluto do arquivo gravado em disco.
  caminho: string
  // SHA-256 hex dos bytes do PDF.
  hash: string
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
  renderizarPdf?: (html: string) => Promise<Buffer>
  fs?: PdfFileSystem
  hash?: (buffer: Buffer) => string
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

// Adapta o `node:fs/promises` ao contrato mínimo `PdfFileSystem`.
const fsPadrao: PdfFileSystem = {
  writeFile: (caminho, dados) => fsPromises.writeFile(caminho, dados),
  readFile: (caminho) => fsPromises.readFile(caminho),
  access: (caminho) => fsPromises.access(caminho),
  mkdir: (caminho, opts) => fsPromises.mkdir(caminho, opts),
}

// Nome de arquivo estável e único por orçamento+versão (RF-016.7).
function nomeArquivo(numero: string, versao: number): string {
  return `${numero}-v${versao}.pdf`
}

export function criarPdfService(deps: PdfServiceDeps): PdfService {
  const renderizar = deps.renderizarPdf ?? renderizarPdfPadrao
  const fs = deps.fs ?? fsPadrao
  const hash = deps.hash ?? sha256Hex

  function resolverCaminho(numero: string, versao: number): string {
    return join(deps.pdfsDir, nomeArquivo(numero, versao))
  }

  // Resolve se o arquivo já existe sem lançar (true/false).
  async function existe(caminho: string): Promise<boolean> {
    try {
      await fs.access(caminho)
      return true
    } catch {
      return false
    }
  }

  return {
    async gerarPdf(input: GerarPdfInput): Promise<GerarPdfResultado> {
      const caminho = resolverCaminho(input.numero, input.versao)

      // Imutabilidade: se já existe, não regenera nem sobrescreve — reusa os
      // bytes já gravados e apenas recomputa o hash.
      if (await existe(caminho)) {
        const buffer = await fs.readFile(caminho)
        return { buffer, caminho, hash: hash(buffer) }
      }

      await fs.mkdir(deps.pdfsDir, { recursive: true })
      const buffer = await renderizar(input.html)
      await fs.writeFile(caminho, buffer)
      return { buffer, caminho, hash: hash(buffer) }
    },

    async buscarPdf(input: BuscarPdfInput): Promise<Buffer> {
      const caminho = resolverCaminho(input.numero, input.versao)
      try {
        return await fs.readFile(caminho)
      } catch {
        // Ausência não regenera (RF-017): o PDF emitido é imutável.
        throw new AppError(404, 'PDF não encontrado')
      }
    },
  }
}
