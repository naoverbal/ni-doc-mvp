import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { criarPdfService } from '../pdf.service.js'
import type { PdfService } from '../pdf.service.js'
import { AppError } from '../../errors/app-error.js'

// -----------------------------------------------------------------------------
// Testes do serviço de PDF. O renderer (`renderizarPdf`) é injetado como um
// `vi.fn()` que devolve um Buffer fixo — nenhum Chromium é lançado. Usa o `fs`
// real do `node:fs/promises` apontando para um diretório temporário isolado
// (NUNCA o `PDFS_DIR` real), limpo a cada teste.
// -----------------------------------------------------------------------------

const PDF_FAKE = Buffer.from('%PDF-1.4 conteúdo gerado')

describe('pdf.service', () => {
  let pdfsDir: string
  let renderizarPdf: ReturnType<typeof vi.fn>
  let service: PdfService

  beforeEach(async () => {
    pdfsDir = await mkdtemp(join(tmpdir(), 'nidoc-pdf-'))
    renderizarPdf = vi.fn(async () => PDF_FAKE)
    service = criarPdfService({ pdfsDir, renderizarPdf })
  })

  afterEach(async () => {
    await rm(pdfsDir, { recursive: true, force: true })
  })

  describe('gerarPdf', () => {
    it('renderiza, salva em disco e retorna buffer, caminho e hash', async () => {
      const resultado = await service.gerarPdf({
        html: '<html><body>orçamento</body></html>',
        numero: 'ORC-2026-0001',
        versao: 1,
      })

      expect(resultado.buffer.equals(PDF_FAKE)).toBe(true)
      expect(resultado.caminho).toBe(join(pdfsDir, 'ORC-2026-0001-v1.pdf'))

      // Arquivo realmente existe em disco com os bytes esperados.
      const emDisco = await readFile(resultado.caminho)
      expect(emDisco.equals(PDF_FAKE)).toBe(true)
    })

    it('calcula o hash como SHA-256 hex dos bytes do PDF', async () => {
      const resultado = await service.gerarPdf({
        html: '<html></html>',
        numero: 'ORC-2026-0001',
        versao: 1,
      })
      const esperado = createHash('sha256').update(PDF_FAKE).digest('hex')
      expect(resultado.hash).toBe(esperado)
    })

    it('passa o html para o renderer', async () => {
      const html = '<html><body>conteúdo</body></html>'
      await service.gerarPdf({ html, numero: 'ORC-2026-0001', versao: 1 })
      expect(renderizarPdf).toHaveBeenCalledWith(html)
    })

    it('é imutável: não regenera nem sobrescreve se o arquivo já existe', async () => {
      const input = { html: '<html></html>', numero: 'ORC-2026-0001', versao: 1 }
      const primeiro = await service.gerarPdf(input)
      const segundo = await service.gerarPdf(input)

      expect(renderizarPdf).toHaveBeenCalledTimes(1)
      expect(segundo.buffer.equals(primeiro.buffer)).toBe(true)
      expect(segundo.hash).toBe(primeiro.hash)
      expect(segundo.caminho).toBe(primeiro.caminho)
    })
  })

  describe('buscarPdf', () => {
    it('retorna o PDF já armazenado em disco', async () => {
      await service.gerarPdf({ html: '<html></html>', numero: 'ORC-2026-0001', versao: 1 })
      const buffer = await service.buscarPdf({ numero: 'ORC-2026-0001', versao: 1 })
      expect(buffer.equals(PDF_FAKE)).toBe(true)
    })

    it('lança AppError 404 quando o PDF não existe e não regenera', async () => {
      await expect(
        service.buscarPdf({ numero: 'ORC-2026-9999', versao: 1 }),
      ).rejects.toMatchObject({ statusCode: 404 })
      await expect(
        service.buscarPdf({ numero: 'ORC-2026-9999', versao: 1 }),
      ).rejects.toBeInstanceOf(AppError)
      expect(renderizarPdf).not.toHaveBeenCalled()
    })
  })

  it('usa os defaults (fs e hash reais) quando não injetados', async () => {
    const servicoPadrao = criarPdfService({ pdfsDir, renderizarPdf })
    const resultado = await servicoPadrao.gerarPdf({
      html: '<html></html>',
      numero: 'ORC-2026-0002',
      versao: 3,
    })
    expect(resultado.caminho).toBe(join(pdfsDir, 'ORC-2026-0002-v3.pdf'))
    await expect(access(resultado.caminho)).resolves.toBeUndefined()
  })
})
