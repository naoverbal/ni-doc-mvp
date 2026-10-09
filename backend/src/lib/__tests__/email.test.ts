import { describe, it, expect, beforeEach, vi } from 'vitest'

// -----------------------------------------------------------------------------
// Testes da lib base de e-mail (`lib/email.ts`) — RF-022.
//
// O transporte SMTP (nodemailer) é MOCKADO: nenhum servidor real é contatado.
// O logger (pino) também é injetado como mock para verificar que falhas de
// envio são registradas sem quebrar o fluxo do chamador.
//
// Comportamentos cobertos:
//  (1) usa as configurações SMTP recebidas (from, destinatário, assunto, corpo);
//  (2) serializa/normaliza o destinatário (string única e lista -> string);
//  (3) falhas de envio são logadas (via logger) e engolidas (não lançam).
// -----------------------------------------------------------------------------

const sendMailMock = vi.fn<(opts: unknown) => Promise<{ messageId: string }>>()
const transporteMock = { sendMail: sendMailMock }

const createTransportMock = vi.fn<(config: Record<string, unknown>) => typeof transporteMock>(
  () => transporteMock,
)

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}))

const loggerMock = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}

const { criarEmail, criarTransporteSmtp } = await import('../email.js')

beforeEach(() => {
  vi.clearAllMocks()
  sendMailMock.mockResolvedValue({ messageId: 'id-123' })
})

describe('criarEmail', () => {
  it('envia usando o remetente (from) configurado e os campos da mensagem', async () => {
    const email = criarEmail({
      transporte: transporteMock,
      remetente: 'ni-doc <no-reply@ni-doc.app>',
      logger: loggerMock,
    })

    const resultado = await email.enviar({
      destinatario: 'cliente@exemplo.com',
      assunto: 'Seu orçamento',
      texto: 'Olá',
      html: '<p>Olá</p>',
    })

    expect(resultado).toBe(true)
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const opts = sendMailMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts['from']).toBe('ni-doc <no-reply@ni-doc.app>')
    expect(opts['subject']).toBe('Seu orçamento')
    expect(opts['text']).toBe('Olá')
    expect(opts['html']).toBe('<p>Olá</p>')
  })

  it('serializa um destinatário único', async () => {
    const email = criarEmail({
      transporte: transporteMock,
      remetente: 'remetente@ni-doc.app',
      logger: loggerMock,
    })

    await email.enviar({ destinatario: 'cliente@exemplo.com', assunto: 'A', texto: 'B' })

    const opts = sendMailMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts['to']).toBe('cliente@exemplo.com')
  })

  it('serializa uma lista de destinatários em string separada por vírgula', async () => {
    const email = criarEmail({
      transporte: transporteMock,
      remetente: 'remetente@ni-doc.app',
      logger: loggerMock,
    })

    await email.enviar({
      destinatario: ['a@exemplo.com', 'b@exemplo.com'],
      assunto: 'A',
      texto: 'B',
    })

    const opts = sendMailMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts['to']).toBe('a@exemplo.com, b@exemplo.com')
  })

  it('normaliza o destinatário removendo entradas vazias e espaços', async () => {
    const email = criarEmail({
      transporte: transporteMock,
      remetente: 'remetente@ni-doc.app',
      logger: loggerMock,
    })

    await email.enviar({
      destinatario: ['  a@exemplo.com  ', '', '   ', 'b@exemplo.com'],
      assunto: 'A',
      texto: 'B',
    })

    const opts = sendMailMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts['to']).toBe('a@exemplo.com, b@exemplo.com')
  })

  it('não envia e retorna false quando não há destinatário válido', async () => {
    const email = criarEmail({
      transporte: transporteMock,
      remetente: 'remetente@ni-doc.app',
      logger: loggerMock,
    })

    const resultado = await email.enviar({ destinatario: ['', '   '], assunto: 'A', texto: 'B' })

    expect(resultado).toBe(false)
    expect(sendMailMock).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalledTimes(1)
  })

  it('loga a falha e retorna false sem lançar quando o envio rejeita', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('SMTP indisponível'))
    const email = criarEmail({
      transporte: transporteMock,
      remetente: 'remetente@ni-doc.app',
      logger: loggerMock,
    })

    const resultado = await email.enviar({
      destinatario: 'cliente@exemplo.com',
      assunto: 'A',
      texto: 'B',
    })

    expect(resultado).toBe(false)
    expect(loggerMock.error).toHaveBeenCalledTimes(1)
    const [contexto] = loggerMock.error.mock.calls[0] as [Record<string, unknown>, string]
    expect(contexto['erro']).toBeInstanceOf(Error)
  })

  it('registra sucesso em log informativo', async () => {
    const email = criarEmail({
      transporte: transporteMock,
      remetente: 'remetente@ni-doc.app',
      logger: loggerMock,
    })

    await email.enviar({ destinatario: 'cliente@exemplo.com', assunto: 'A', texto: 'B' })

    expect(loggerMock.info).toHaveBeenCalledTimes(1)
  })
})

describe('criarTransporteSmtp', () => {
  it('cria o transporte com as configurações SMTP informadas', () => {
    const transporte = criarTransporteSmtp({
      host: 'smtp.exemplo.com',
      porta: 587,
      usuario: 'user',
      senha: 'pass',
    })

    expect(transporte).toBe(transporteMock)
    expect(createTransportMock).toHaveBeenCalledTimes(1)
    const config = createTransportMock.mock.calls[0]?.[0] ?? {}
    expect(config['host']).toBe('smtp.exemplo.com')
    expect(config['port']).toBe(587)
    expect(config['secure']).toBe(false)
    expect(config['auth']).toEqual({ user: 'user', pass: 'pass' })
  })

  it('usa conexão segura (secure) quando a porta é 465', () => {
    criarTransporteSmtp({ host: 'smtp.exemplo.com', porta: 465, usuario: 'u', senha: 'p' })

    const config = createTransportMock.mock.calls[0]?.[0] ?? {}
    expect(config['secure']).toBe(true)
  })

  it('omite auth quando usuário e senha não são informados', () => {
    criarTransporteSmtp({ host: 'smtp.exemplo.com', porta: 25 })

    const config = createTransportMock.mock.calls[0]?.[0] ?? {}
    expect(config['auth']).toBeUndefined()
  })
})
