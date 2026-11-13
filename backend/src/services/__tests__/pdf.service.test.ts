import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, access, writeFile, mkdir, link, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { criarPdfService } from '../pdf.service.js'
import type { PdfFileSystem, PdfService } from '../pdf.service.js'
import { AppError } from '../../errors/app-error.js'

// -----------------------------------------------------------------------------
// Testes do serviço de PDF. O renderer (`renderizarPdf`) é injetado como um
// `vi.fn()` que devolve um Buffer fixo — nenhum Chromium é lançado. Usa o `fs`
// real do `node:fs/promises` apontando para um diretório temporário isolado
// (NUNCA o `PDFS_DIR` real), limpo a cada teste.
// -----------------------------------------------------------------------------

const PDF_FAKE = Buffer.from('%PDF-1.4 conteúdo gerado')
const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'

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
        tenantId: TENANT_A,
        html: '<html><body>orçamento</body></html>',
        numero: 'ORC-2026-0001',
        versao: 1,
      })

      expect(resultado.buffer.equals(PDF_FAKE)).toBe(true)
      expect(resultado.caminho).toBe(join(pdfsDir, TENANT_A, 'ORC-2026-0001-v1.pdf'))

      // Arquivo realmente existe em disco com os bytes esperados.
      const emDisco = await readFile(resultado.caminho)
      expect(emDisco.equals(PDF_FAKE)).toBe(true)
    })

    it('calcula o hash como SHA-256 hex dos bytes do PDF', async () => {
      const resultado = await service.gerarPdf({
        tenantId: TENANT_A,
        html: '<html></html>',
        numero: 'ORC-2026-0001',
        versao: 1,
      })
      const esperado = createHash('sha256').update(PDF_FAKE).digest('hex')
      expect(resultado.hash).toBe(esperado)
    })

    it('passa o html para o renderer', async () => {
      const html = '<html><body>conteúdo</body></html>'
      await service.gerarPdf({ tenantId: TENANT_A, html, numero: 'ORC-2026-0001', versao: 1 })
      expect(renderizarPdf).toHaveBeenCalledWith(html)
    })

    it('é imutável: não regenera nem sobrescreve se o arquivo já existe', async () => {
      const input = {
        tenantId: TENANT_A,
        html: '<html></html>',
        numero: 'ORC-2026-0001',
        versao: 1,
      }
      const primeiro = await service.gerarPdf(input)
      const segundo = await service.gerarPdf(input)

      expect(renderizarPdf).toHaveBeenCalledTimes(1)
      expect(segundo.buffer.equals(primeiro.buffer)).toBe(true)
      expect(segundo.hash).toBe(primeiro.hash)
      expect(segundo.caminho).toBe(primeiro.caminho)
    })
  })

  describe('órfãos do envio (substituirExistente, criado, removerPdf)', () => {
    const base = { tenantId: TENANT_A, html: '<html></html>', numero: 'ORC-2026-0001', versao: 1 }

    it('informa criado=true quando grava o arquivo e criado=false quando reaproveita o existente', async () => {
      const primeiro = await service.gerarPdf(base)
      const segundo = await service.gerarPdf(base)

      expect(primeiro.criado).toBe(true)
      expect(segundo.criado).toBe(false)
    })

    it('com substituirExistente, descarta o arquivo órfão e gera o PDF de novo', async () => {
      const orfao = Buffer.from('PDF-ORFAO-com-QR-de-outro-token')
      await mkdir(join(pdfsDir, TENANT_A), { recursive: true })
      const caminho = join(pdfsDir, TENANT_A, 'ORC-2026-0001-v1.pdf')
      await writeFile(caminho, orfao)

      const resultado = await service.gerarPdf({ ...base, substituirExistente: true })

      expect(resultado.criado).toBe(true)
      expect(renderizarPdf).toHaveBeenCalledTimes(1)
      expect(resultado.buffer.equals(PDF_FAKE)).toBe(true)
      expect((await readFile(caminho)).equals(PDF_FAKE)).toBe(true)
      expect(resultado.hash).toBe(createHash('sha256').update(PDF_FAKE).digest('hex'))
    })

    it('sem substituirExistente, o arquivo preexistente continua sendo reaproveitado (imutabilidade)', async () => {
      const oficial = Buffer.from('PDF-OFICIAL')
      await mkdir(join(pdfsDir, TENANT_A), { recursive: true })
      await writeFile(join(pdfsDir, TENANT_A, 'ORC-2026-0001-v1.pdf'), oficial)

      const resultado = await service.gerarPdf(base)

      expect(renderizarPdf).not.toHaveBeenCalled()
      expect(resultado.buffer.equals(oficial)).toBe(true)
      expect(resultado.criado).toBe(false)
    })

    it('removerPdf apaga o arquivo e não falha se ele não existe', async () => {
      const gerado = await service.gerarPdf(base)

      await service.removerPdf(base)
      await expect(access(gerado.caminho)).rejects.toThrow()
      await expect(service.removerPdf(base)).resolves.toBeUndefined()
    })
  })

  describe('escrita atômica', () => {
    it('quando a gravação do PDF falha no meio, então o arquivo final não existe e uma nova chamada gera o PDF de novo', async () => {
      // Filesystem real, exceto pela PRIMEIRA escrita: grava só metade dos bytes
      // e lança, como numa queda do processo ou disco cheio no meio da escrita.
      let escritas = 0
      const fsComFalha: PdfFileSystem = {
        writeFile: async (caminho, dados) => {
          escritas += 1
          if (escritas === 1) {
            await writeFile(caminho, dados.subarray(0, Math.floor(dados.length / 2)))
            throw new Error('falha simulada no meio da escrita')
          }
          await writeFile(caminho, dados)
        },
        readFile: (caminho) => readFile(caminho),
        access: (caminho) => access(caminho),
        mkdir: (caminho, opts) => mkdir(caminho, opts),
        link: (origem, destino) => link(origem, destino),
        rm: (caminho) => rm(caminho, { force: true }),
      }
      const servico = criarPdfService({ pdfsDir, renderizarPdf, fs: fsComFalha })
      const input = {
        tenantId: TENANT_A,
        html: '<html></html>',
        numero: 'ORC-2026-0001',
        versao: 1,
      }
      const caminhoFinal = join(pdfsDir, TENANT_A, 'ORC-2026-0001-v1.pdf')

      await expect(servico.gerarPdf(input)).rejects.toThrow('falha simulada')
      await expect(access(caminhoFinal)).rejects.toMatchObject({ code: 'ENOENT' })

      const segunda = await servico.gerarPdf(input)

      expect(renderizarPdf).toHaveBeenCalledTimes(2)
      expect(segunda.buffer.equals(PDF_FAKE)).toBe(true)
      expect((await readFile(caminhoFinal)).equals(PDF_FAKE)).toBe(true)
      // Nenhum temporário fica para trás no diretório do tenant.
      expect(await readdir(join(pdfsDir, TENANT_A))).toEqual(['ORC-2026-0001-v1.pdf'])
    })
  })

  describe('buscarPdf', () => {
    it('retorna o PDF já armazenado em disco', async () => {
      await service.gerarPdf({
        tenantId: TENANT_A,
        html: '<html></html>',
        numero: 'ORC-2026-0001',
        versao: 1,
      })
      const buffer = await service.buscarPdf({
        tenantId: TENANT_A,
        numero: 'ORC-2026-0001',
        versao: 1,
      })
      expect(buffer.equals(PDF_FAKE)).toBe(true)
    })

    it('lança AppError 404 quando o PDF não existe e não regenera', async () => {
      await expect(
        service.buscarPdf({ tenantId: TENANT_A, numero: 'ORC-2026-9999', versao: 1 }),
      ).rejects.toMatchObject({ statusCode: 404 })
      await expect(
        service.buscarPdf({ tenantId: TENANT_A, numero: 'ORC-2026-9999', versao: 1 }),
      ).rejects.toBeInstanceOf(AppError)
      expect(renderizarPdf).not.toHaveBeenCalled()
    })
  })

  it('usa os defaults (fs e hash reais) quando não injetados', async () => {
    const servicoPadrao = criarPdfService({ pdfsDir, renderizarPdf })
    const resultado = await servicoPadrao.gerarPdf({
      tenantId: TENANT_A,
      html: '<html></html>',
      numero: 'ORC-2026-0002',
      versao: 3,
    })
    expect(resultado.caminho).toBe(join(pdfsDir, TENANT_A, 'ORC-2026-0002-v3.pdf'))
    await expect(access(resultado.caminho)).resolves.toBeUndefined()
  })

  describe('isolamento por tenant (auditoria B-11)', () => {
    it('quando dois tenants têm o mesmo número e versão, então cada um grava e lê o próprio PDF', async () => {
      renderizarPdf
        .mockResolvedValueOnce(Buffer.from('%PDF conteúdo do tenant A'))
        .mockResolvedValueOnce(Buffer.from('%PDF conteúdo do tenant B'))
      const base = { html: '<html></html>', numero: 'ORC-2026-0001', versao: 1 }

      const a = await service.gerarPdf({ ...base, tenantId: TENANT_A })
      const b = await service.gerarPdf({ ...base, tenantId: TENANT_B })

      expect(renderizarPdf).toHaveBeenCalledTimes(2)
      expect(a.caminho).not.toBe(b.caminho)
      expect(a.hash).not.toBe(b.hash)
      const lidoA = await service.buscarPdf({
        tenantId: TENANT_A,
        numero: 'ORC-2026-0001',
        versao: 1,
      })
      const lidoB = await service.buscarPdf({
        tenantId: TENANT_B,
        numero: 'ORC-2026-0001',
        versao: 1,
      })
      expect(lidoA.toString()).toBe('%PDF conteúdo do tenant A')
      expect(lidoB.toString()).toBe('%PDF conteúdo do tenant B')
    })

    it('quando o tenant não é um UUID, então recusa antes de tocar o disco', async () => {
      const base = { html: '<html></html>', numero: 'ORC-2026-0001', versao: 1 }
      await expect(service.gerarPdf({ ...base, tenantId: '../outro' })).rejects.toThrow(
        'tenantId inválido',
      )
      await expect(
        service.buscarPdf({ tenantId: '../outro', numero: 'ORC-2026-0001', versao: 1 }),
      ).rejects.toThrow('tenantId inválido')
      expect(renderizarPdf).not.toHaveBeenCalled()
    })
  })
})
