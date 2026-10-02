import { describe, it, expect } from 'vitest'

// Configurar variáveis de ambiente para testes ANTES de qualquer acesso ao módulo env.ts
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test'
process.env['CRYPTO_KEY'] = Buffer.alloc(32).toString('base64')
process.env['SESSION_SECRET'] = 'test-secret-com-pelo-menos-32-caracteres-aqui'
process.env['NODE_ENV'] = 'test'

// Validação do setup — este arquivo confirma que o Vitest está configurado corretamente.
describe('setup', () => {
  it('vitest está funcionando', () => {
    expect(true).toBe(true)
  })

  it('globals estão disponíveis', () => {
    expect(typeof describe).toBe('function')
    expect(typeof it).toBe('function')
    expect(typeof expect).toBe('function')
  })
})
