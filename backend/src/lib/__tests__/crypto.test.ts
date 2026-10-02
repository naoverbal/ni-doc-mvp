import { describe, it, expect, beforeAll } from 'vitest'

// Definir CRYPTO_KEY antes de importar o módulo
beforeAll(() => {
  process.env['CRYPTO_KEY'] = Buffer.from('12345678901234567890123456789012').toString('base64')
})

// Importação dinâmica para garantir que env está definida
const { criptografar, descriptografar, hashDocumento } = await import('../crypto.js')

describe('crypto', () => {
  describe('criptografar / descriptografar', () => {
    it('criptografar retorna string diferente do input', () => {
      const resultado = criptografar('texto secreto')
      expect(resultado).not.toBe('texto secreto')
    })

    it('round-trip: descriptografar(criptografar(x)) === x', () => {
      const original = 'dados sensiveis 123'
      expect(descriptografar(criptografar(original))).toBe(original)
    })

    it('dois criptografar do mesmo input produzem resultados diferentes (IV aleatório)', () => {
      const c1 = criptografar('mesmo texto')
      const c2 = criptografar('mesmo texto')
      expect(c1).not.toBe(c2)
    })

    it('descriptografar lança erro se authTag for adulterado', () => {
      const criptografado = criptografar('texto')
      const buf = Buffer.from(criptografado, 'base64')
      // authTag fica nos bytes 12-28 (após IV de 12 bytes)
      buf[12] = buf[12]! ^ 0xff
      const adulterado = buf.toString('base64')
      expect(() => descriptografar(adulterado)).toThrow()
    })
  })

  describe('hashDocumento', () => {
    it('retorna o mesmo hash para o mesmo input', () => {
      expect(hashDocumento('abc')).toBe(hashDocumento('abc'))
    })

    it('normaliza removendo pontuação antes de fazer o hash', () => {
      expect(hashDocumento('123.456.789-00')).toBe(hashDocumento('12345678900'))
    })
  })
})
