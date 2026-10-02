import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'

beforeAll(() => {
  process.env['SESSION_SECRET'] = 'segredo-de-teste-fixo-para-hmac-token'
})

const { gerarTokenPublico, validarTokenPublico } = await import('../token.js')

describe('token', () => {
  it('gerarTokenPublico retorna string no formato uuid.hmac', () => {
    const token = gerarTokenPublico('versao-123')
    const partes = token.split('.')
    expect(partes.length).toBe(2)
    expect(partes[0]).toHaveLength(36)
  })

  it('dois tokens para o mesmo versaoId são diferentes', () => {
    const t1 = gerarTokenPublico('versao-abc')
    const t2 = gerarTokenPublico('versao-abc')
    expect(t1).not.toBe(t2)
  })

  it('validarTokenPublico retorna true para token válido', () => {
    const versaoId = 'versao-xyz'
    const token = gerarTokenPublico(versaoId)
    expect(validarTokenPublico(token, versaoId)).toBe(true)
  })

  it('validarTokenPublico retorna false se HMAC foi alterado', () => {
    const token = gerarTokenPublico('versao-test')
    const [uuid] = token.split('.')
    const tokenAdulterado = `${uuid}.hmacfalsificado`
    expect(validarTokenPublico(tokenAdulterado, 'versao-test')).toBe(false)
  })

  it('validarTokenPublico retorna false se UUID foi alterado', () => {
    const versaoId = 'versao-test'
    const token = gerarTokenPublico(versaoId)
    const [, hmac] = token.split('.')
    const tokenAdulterado = `uuid-falso-123456789012345678901234.${hmac}`
    expect(validarTokenPublico(tokenAdulterado, versaoId)).toBe(false)
  })

  it('validarTokenPublico retorna false para HMAC com caractere não-hex', () => {
    const versaoId = randomUUID()
    const tokenValido = gerarTokenPublico(versaoId)
    const [uuid] = tokenValido.split('.')
    const tokenInvalido = `${uuid}.ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ`
    expect(validarTokenPublico(tokenInvalido, versaoId)).toBe(false)
  })

  it('validarTokenPublico retorna false para token sem ponto', () => {
    expect(validarTokenPublico('tokensemponto', 'versao-qualquer')).toBe(false)
  })
})
