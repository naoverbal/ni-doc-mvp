import { describe, it, expect } from 'vitest'
import { gerarQrCodeDataUrl, QR_WIDTH } from '../qrcode.js'

// URL pública no formato /publico/orcamento/:token (RF-018/RF-019).
const URL_A = 'https://app.exemplo.com/publico/orcamento/uuid-a.hmac-a'
const URL_B = 'https://app.exemplo.com/publico/orcamento/uuid-b.hmac-b'

describe('qrcode', () => {
  it('retorna uma data URL PNG válida', async () => {
    const dataUrl = await gerarQrCodeDataUrl(URL_A)
    expect(typeof dataUrl).toBe('string')
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('reflete a URL de forma determinística', async () => {
    // URLs diferentes produzem data URLs diferentes (o conteúdo entra na
    // codificação) e a mesma URL produz resultado idêntico (estável), sem
    // precisar de leitor de QR.
    const [a1, a2, b1] = await Promise.all([
      gerarQrCodeDataUrl(URL_A),
      gerarQrCodeDataUrl(URL_A),
      gerarQrCodeDataUrl(URL_B),
    ])
    expect(a1).toBe(a2)
    expect(a1).not.toBe(b1)
  })

  it('usa tamanho mínimo escaneável (>= 200px)', () => {
    expect(QR_WIDTH).toBeGreaterThanOrEqual(200)
  })
})
