import { describe, it, expect } from 'vitest'
import { hashSenha, verificarSenha } from '../senha.js'

describe('senha', () => {
  it('hashSenha retorna string diferente para a mesma senha (salt aleatório)', async () => {
    const h1 = await hashSenha('minhasenha')
    const h2 = await hashSenha('minhasenha')
    expect(h1).not.toBe(h2)
  })

  it('verificarSenha retorna true para senha correta', async () => {
    const hash = await hashSenha('senhavalida')
    expect(await verificarSenha('senhavalida', hash)).toBe(true)
  })

  it('verificarSenha retorna false para senha errada', async () => {
    const hash = await hashSenha('senhavalida')
    expect(await verificarSenha('errada', hash)).toBe(false)
  })

  it('usa parâmetros Argon2id corretos', async () => {
    const hash = await hashSenha('teste')
    // Hash Argon2 começa com $argon2id$
    expect(hash).toMatch(/^\$argon2id\$/)
    // Verifica parâmetros no hash: m=65536,t=3,p=4
    expect(hash).toContain('m=65536')
    expect(hash).toContain('t=3')
    expect(hash).toContain('p=4')
  })

  it('verificarSenha retorna false para hash mal-formado', async () => {
    const resultado = await verificarSenha('qualquer', '$invalido$')
    expect(resultado).toBe(false)
  })
})
