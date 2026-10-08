import { describe, it, expect } from 'vitest'
import { envSchema } from '../env.js'

// Base de variáveis válidas usada como ponto de partida nos cenários.
function envValido(): Record<string, string> {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    CRYPTO_KEY: Buffer.alloc(32).toString('base64'),
    SESSION_SECRET: 'segredo-com-pelo-menos-32-caracteres-aqui!!',
    PORT: '3000',
    NODE_ENV: 'production',
    PDFS_DIR: '/var/ni-doc/pdfs',
  }
}

describe('envSchema', () => {
  it('aceita um conjunto válido de variáveis', () => {
    const result = envSchema.safeParse(envValido())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.PORT).toBe(3000)
      expect(result.data.NODE_ENV).toBe('production')
    }
  })

  it('falha quando DATABASE_URL está ausente', () => {
    const env = envValido()
    delete env['DATABASE_URL']
    const result = envSchema.safeParse(env)
    expect(result.success).toBe(false)
  })

  it('falha quando DATABASE_URL não é uma URL válida', () => {
    const result = envSchema.safeParse({ ...envValido(), DATABASE_URL: 'nao-e-url' })
    expect(result.success).toBe(false)
  })

  it('falha quando CRYPTO_KEY está ausente', () => {
    const env = envValido()
    delete env['CRYPTO_KEY']
    const result = envSchema.safeParse(env)
    expect(result.success).toBe(false)
  })

  it('falha quando CRYPTO_KEY não é base64 de 32 bytes', () => {
    // 16 bytes em base64 — tamanho incorreto.
    const curto = Buffer.alloc(16).toString('base64')
    const result = envSchema.safeParse({ ...envValido(), CRYPTO_KEY: curto })
    expect(result.success).toBe(false)
  })

  it('falha quando CRYPTO_KEY não é base64 válido', () => {
    const result = envSchema.safeParse({ ...envValido(), CRYPTO_KEY: '!!! nao base64 !!!' })
    expect(result.success).toBe(false)
  })

  it('aceita CRYPTO_KEY base64 de exatamente 32 bytes', () => {
    const chave = Buffer.alloc(32, 7).toString('base64')
    const result = envSchema.safeParse({ ...envValido(), CRYPTO_KEY: chave })
    expect(result.success).toBe(true)
  })

  it('falha quando SESSION_SECRET tem menos de 32 caracteres', () => {
    const result = envSchema.safeParse({ ...envValido(), SESSION_SECRET: 'curto' })
    expect(result.success).toBe(false)
  })

  it('falha quando NODE_ENV é um valor inesperado', () => {
    const result = envSchema.safeParse({ ...envValido(), NODE_ENV: 'staging' })
    expect(result.success).toBe(false)
  })

  it('aplica os defaults de PORT, NODE_ENV e PDFS_DIR', () => {
    const env = envValido()
    delete env['PORT']
    delete env['NODE_ENV']
    delete env['PDFS_DIR']
    const result = envSchema.safeParse(env)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.PORT).toBe(3000)
      expect(result.data.NODE_ENV).toBe('development')
      expect(result.data.PDFS_DIR).toBe('/var/ni-doc/pdfs')
    }
  })

  it('aceita variáveis SMTP opcionais quando ausentes', () => {
    const result = envSchema.safeParse(envValido())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.SMTP_HOST).toBeUndefined()
    }
  })
})
