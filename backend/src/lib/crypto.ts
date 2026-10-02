import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const ALGO = 'aes-256-gcm'

function getKey(): Buffer {
  const raw = process.env['CRYPTO_KEY']
  if (!raw) throw new Error('CRYPTO_KEY não definida')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('CRYPTO_KEY deve ter 32 bytes')
  return key
}

export function criptografar(texto: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
}

export function descriptografar(dados: string): string {
  const key = getKey()
  const buf = Buffer.from(dados, 'base64')
  const iv = buf.subarray(0, IV_LENGTH)
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export function hashDocumento(texto: string): string {
  const normalizado = texto.replace(/[.\-/]/g, '')
  return createHash('sha256').update(normalizado, 'utf8').digest('hex')
}
