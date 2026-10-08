import { describe, it, expect, beforeEach, vi } from 'vitest'

// -----------------------------------------------------------------------------
// Testes do wrapper de baixo nível do Puppeteer (`lib/pdf.ts`). O Puppeteer é
// MOCKADO — nenhum Chromium real é baixado ou lançado — para manter os testes
// rápidos e determinísticos. Validamos: o Buffer retornado, as opções A4
// passadas a `page.pdf`, o HTML passado a `page.setContent` e o fechamento do
// browser mesmo quando a renderização falha.
// -----------------------------------------------------------------------------

const pageMock = {
  setContent: vi.fn<(html: string, opts?: unknown) => Promise<void>>(),
  pdf: vi.fn<(opts?: unknown) => Promise<Uint8Array>>(),
}
const browserMock = {
  newPage: vi.fn(async () => pageMock),
  close: vi.fn(async () => undefined),
}
const launchMock = vi.fn(async () => browserMock)

vi.mock('puppeteer', () => ({
  default: { launch: launchMock },
}))

const { renderizarPdf } = await import('../pdf.js')

beforeEach(() => {
  vi.clearAllMocks()
  pageMock.setContent.mockResolvedValue(undefined)
  pageMock.pdf.mockResolvedValue(Uint8Array.from(Buffer.from('%PDF-1.4 fake')))
})

describe('renderizarPdf', () => {
  it('retorna um Buffer com os bytes do PDF gerado', async () => {
    const resultado = await renderizarPdf('<html><body>oi</body></html>')
    expect(Buffer.isBuffer(resultado)).toBe(true)
    expect(resultado.toString()).toBe('%PDF-1.4 fake')
  })

  it('passa o HTML recebido para page.setContent', async () => {
    const html = '<html><body>orçamento</body></html>'
    await renderizarPdf(html)
    expect(pageMock.setContent).toHaveBeenCalledTimes(1)
    expect(pageMock.setContent.mock.calls[0]?.[0]).toBe(html)
  })

  it('gera o PDF no formato A4 com printBackground', async () => {
    await renderizarPdf('<html></html>')
    expect(pageMock.pdf).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'A4', printBackground: true }),
    )
  })

  it('fecha o browser mesmo quando page.pdf rejeita', async () => {
    pageMock.pdf.mockRejectedValueOnce(new Error('falha no puppeteer'))
    await expect(renderizarPdf('<html></html>')).rejects.toThrow('falha no puppeteer')
    expect(browserMock.close).toHaveBeenCalledTimes(1)
  })

  it('fecha o browser no caminho de sucesso', async () => {
    await renderizarPdf('<html></html>')
    expect(browserMock.close).toHaveBeenCalledTimes(1)
  })
})
