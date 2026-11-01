import { createHash } from 'node:crypto'
import { beforeEach, vi } from 'vitest'
import { emailsEnviados, estadoSmtp, limparEspioes } from './espioes.js'

// Serviços EXTERNOS simulados (único mock permitido na suíte):
//  - nodemailer: não há SMTP real; as mensagens são capturadas em `emailsEnviados`.
//  - lib/pdf (Puppeteer/Chromium): devolve bytes determinísticos derivados do HTML,
//    de modo que o pdf_hash varie com o conteúdo, como no PDF real.
// O serviço de PDF (gravação em disco, hash) e o de e-mail rodam de verdade.

vi.mock('nodemailer', () => {
  const createTransport = () => ({
    sendMail: async (opcoes: {
      from: string
      to: string
      subject: string
      text?: string
      html?: string
    }) => {
      if (estadoSmtp.falhar) {
        throw new Error('SMTP indisponível (simulado)')
      }
      emailsEnviados.push(opcoes)
      return { messageId: 'simulado' }
    },
  })
  return { default: { createTransport }, createTransport }
})

vi.mock('../lib/pdf.js', () => ({
  renderizarPdf: async (html: string): Promise<Buffer> =>
    Buffer.from(`%PDF-1.4 simulado ${createHash('sha256').update(html).digest('hex')}`),
}))

beforeEach(() => {
  limparEspioes()
})
