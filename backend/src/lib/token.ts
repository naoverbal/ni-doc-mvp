import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

function getSecret(): string {
  const secret = process.env['SESSION_SECRET']
  if (!secret) throw new Error('SESSION_SECRET não definida')
  return secret
}

function calcularHmac(uuid: string, versaoId: string): string {
  return createHmac('sha256', getSecret())
    .update(`${uuid}:${versaoId}`)
    .digest('hex')
}

export function gerarTokenPublico(versaoId: string): string {
  const uuid = randomUUID()
  const hmac = calcularHmac(uuid, versaoId)
  return `${uuid}.${hmac}`
}

export function validarTokenPublico(token: string, versaoId: string): boolean {
  const dotIndex = token.indexOf('.')
  if (dotIndex === -1) return false
  const uuid = token.substring(0, dotIndex)
  const hmacFornecido = token.substring(dotIndex + 1)
  const hmacEsperado = calcularHmac(uuid, versaoId)
  const a = Buffer.from(hmacFornecido, 'hex')
  const b = Buffer.from(hmacEsperado, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
