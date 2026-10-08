import { describe, it, expect } from 'vitest'

// Teste dummy que valida a configuração do Vitest no backend.
// Confirma que o runner executa, que os globals estão disponíveis e que o
// setupFiles aplicou as variáveis de ambiente de teste.
describe('setup do Vitest', () => {
  it('executa testes com sucesso', () => {
    expect(true).toBe(true)
  })

  it('expõe os globals de teste', () => {
    expect(typeof describe).toBe('function')
    expect(typeof it).toBe('function')
    expect(typeof expect).toBe('function')
  })

  it('aplica as variáveis de ambiente de teste via setupFiles', () => {
    expect(process.env['NODE_ENV']).toBe('test')
    expect(process.env['DATABASE_URL']).toBe('postgresql://test:test@localhost:5432/test')
    expect(process.env['SESSION_SECRET']).toBe('test-secret-com-pelo-menos-32-caracteres-aqui')
    expect(process.env['CRYPTO_KEY']).toBeDefined()
  })
})
