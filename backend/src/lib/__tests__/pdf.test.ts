import { describe, it, expect, beforeEach, vi } from 'vitest'

// -----------------------------------------------------------------------------
// Testes do wrapper de baixo nível do Puppeteer (`lib/pdf.ts`). O Puppeteer é
// MOCKADO — nenhum Chromium real é baixado ou lançado — para manter os testes
// rápidos e determinísticos. Validamos: o Buffer retornado, as opções A4
// passadas a `page.pdf`, o HTML passado a `page.setContent` e o fechamento do
// browser mesmo quando a renderização falha.
// -----------------------------------------------------------------------------

type ManipuladorRequisicao = (requisicao: {
  url: () => string
  continue: () => Promise<void>
  abort: (motivo?: string) => Promise<void>
}) => void
const pageMock = {
  setJavaScriptEnabled: vi.fn<(ligado: boolean) => Promise<void>>(),
  setRequestInterception: vi.fn<(ligado: boolean) => Promise<void>>(),
  on: vi.fn<(evento: string, manipulador: ManipuladorRequisicao) => void>(),
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

const { renderizarPdf, requisicaoPermitida } = await import('../pdf.js')

beforeEach(() => {
  vi.clearAllMocks()
  pageMock.setContent.mockResolvedValue(undefined)
  pageMock.setJavaScriptEnabled.mockResolvedValue(undefined)
  pageMock.setRequestInterception.mockResolvedValue(undefined)
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

describe('isolamento do Chromium (auditoria B-5)', () => {
  function requisicaoFalsa(url: string) {
    return {
      url: () => url,
      continue: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    }
  }

  async function manipulador(): Promise<ManipuladorRequisicao> {
    await renderizarPdf('<html></html>')
    const chamada = pageMock.on.mock.calls.find(([evento]) => evento === 'request')
    if (chamada === undefined) throw new Error('listener de request não registrado')
    return chamada[1]
  }

  it('desliga o JavaScript e liga a interceptação antes de carregar o HTML', async () => {
    await renderizarPdf('<html></html>')
    expect(pageMock.setJavaScriptEnabled).toHaveBeenCalledWith(false)
    expect(pageMock.setRequestInterception).toHaveBeenCalledWith(true)
    const ordemInterceptacao = pageMock.setRequestInterception.mock.invocationCallOrder[0] ?? 0
    const ordemConteudo = pageMock.setContent.mock.invocationCallOrder[0] ?? 0
    expect(ordemInterceptacao).toBeLessThan(ordemConteudo)
  })

  it('permite apenas data: e about:', () => {
    expect(requisicaoPermitida('data:image/png;base64,AAAA')).toBe(true)
    expect(requisicaoPermitida('about:blank')).toBe(true)
    expect(requisicaoPermitida('http://169.254.169.254/latest/meta-data')).toBe(false)
    expect(requisicaoPermitida('https://exemplo.com/logo.png')).toBe(false)
    expect(requisicaoPermitida('file:///etc/passwd')).toBe(false)
  })

  it('aborta requisições externas e deixa passar data URLs', async () => {
    const tratar = await manipulador()
    const externa = requisicaoFalsa('http://127.0.0.1:5432/')
    const arquivo = requisicaoFalsa('file:///etc/passwd')
    const imagem = requisicaoFalsa('data:image/png;base64,AAAA')
    tratar(externa)
    tratar(arquivo)
    tratar(imagem)
    expect(externa.abort).toHaveBeenCalledWith('blockedbyclient')
    expect(externa.continue).not.toHaveBeenCalled()
    expect(arquivo.abort).toHaveBeenCalledWith('blockedbyclient')
    expect(imagem.continue).toHaveBeenCalled()
    expect(imagem.abort).not.toHaveBeenCalled()
  })
})
