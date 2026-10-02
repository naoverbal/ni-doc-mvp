import { describe, it, expect } from 'vitest'

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
