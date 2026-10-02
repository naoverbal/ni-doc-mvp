import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarUsuarioRepository } from '../usuario.repository.js'
import * as crypto from '../../lib/crypto.js'
import * as senha from '../../lib/senha.js'
import type { Kysely } from 'kysely'
import type { Database } from '../../types/database.js'

// Helpers para construir o mock fluent do Kysely
function makeInsertBuilder(result: unknown) {
  const builder = {
    values: vi.fn(),
    returning: vi.fn(),
    executeTakeFirstOrThrow: vi.fn().mockResolvedValue(result),
  }
  builder.values.mockReturnValue(builder)
  builder.returning.mockReturnValue(builder)
  return builder
}

function makeSelectBuilder(result: unknown) {
  const builder = {
    select: vi.fn(),
    where: vi.fn(),
    executeTakeFirst: vi.fn().mockResolvedValue(result),
  }
  builder.select.mockReturnValue(builder)
  builder.where.mockReturnValue(builder)
  return builder
}

const rowBase = {
  id: 'user-id-1',
  tenant_id: 'tenant-1',
  nome: 'João Silva',
  email_encrypted: crypto.criptografar('joao@exemplo.com'),
  senha_hash: '$argon2id$hash',
  papel: 'admin' as const,
  ativo: true,
  criado_em: new Date('2024-01-01'),
}

describe('UsuarioRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('criar()', () => {
    it('chama hashDocumento e criptografar para o email', async () => {
      const hashDocumentoSpy = vi.spyOn(crypto, 'hashDocumento')
      const criptografarSpy = vi.spyOn(crypto, 'criptografar')
      vi.spyOn(senha, 'hashSenha').mockResolvedValue('$argon2id$hash')

      const insertBuilder = makeInsertBuilder(rowBase)
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarUsuarioRepository(db)
      await repo.criar({
        tenantId: 'tenant-1',
        nome: 'João Silva',
        email: 'Joao@Exemplo.com',
        senha: 'senha123',
        papel: 'admin',
      })

      // Deve normalizar para lowercase antes de hash
      expect(hashDocumentoSpy).toHaveBeenCalledWith('joao@exemplo.com')
      expect(criptografarSpy).toHaveBeenCalledWith('joao@exemplo.com')
    })

    it('chama hashSenha com a senha em texto plano', async () => {
      const hashSenhaSpy = vi.spyOn(senha, 'hashSenha').mockResolvedValue('$argon2id$hash')

      const insertBuilder = makeInsertBuilder(rowBase)
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarUsuarioRepository(db)
      await repo.criar({
        tenantId: 'tenant-1',
        nome: 'João',
        email: 'joao@exemplo.com',
        senha: 'minhasenha',
        papel: 'admin',
      })

      expect(hashSenhaSpy).toHaveBeenCalledWith('minhasenha')
    })

    it('retorna UsuarioPublico com email descriptografado', async () => {
      vi.spyOn(senha, 'hashSenha').mockResolvedValue('$argon2id$hash')

      const insertBuilder = makeInsertBuilder(rowBase)
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarUsuarioRepository(db)
      const result = await repo.criar({
        tenantId: 'tenant-1',
        nome: 'João Silva',
        email: 'joao@exemplo.com',
        senha: 'senha123',
        papel: 'admin',
      })

      expect(result.email).toBe('joao@exemplo.com')
      expect(result.id).toBe('user-id-1')
      expect(result).not.toHaveProperty('senhaHash')
    })
  })

  describe('buscarPorEmail()', () => {
    it('retorna null quando usuário não existe', async () => {
      const selectBuilder = makeSelectBuilder(undefined)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarUsuarioRepository(db)
      const result = await repo.buscarPorEmail('naoexiste@exemplo.com')

      expect(result).toBeNull()
    })

    it('retorna usuário com email descriptografado e senhaHash', async () => {
      const selectBuilder = makeSelectBuilder(rowBase)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarUsuarioRepository(db)
      const result = await repo.buscarPorEmail('joao@exemplo.com')

      expect(result).not.toBeNull()
      expect(result?.email).toBe('joao@exemplo.com')
      expect(result?.senhaHash).toBe('$argon2id$hash')
    })

    it('busca pelo hash do email (não pelo email em texto plano)', async () => {
      const hashDocumentoSpy = vi.spyOn(crypto, 'hashDocumento')
      const selectBuilder = makeSelectBuilder(null)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarUsuarioRepository(db)
      await repo.buscarPorEmail('Joao@Exemplo.com')

      expect(hashDocumentoSpy).toHaveBeenCalledWith('joao@exemplo.com')
    })
  })

  describe('buscarPorId()', () => {
    it('retorna null quando usuário não existe', async () => {
      const selectBuilder = makeSelectBuilder(undefined)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarUsuarioRepository(db)
      const result = await repo.buscarPorId('id-inexistente')

      expect(result).toBeNull()
    })

    it('retorna usuário com email descriptografado', async () => {
      const rowSemSenha = { ...rowBase }
      const selectBuilder = makeSelectBuilder(rowSemSenha)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarUsuarioRepository(db)
      const result = await repo.buscarPorId('user-id-1')

      expect(result).not.toBeNull()
      expect(result?.email).toBe('joao@exemplo.com')
      expect(result?.id).toBe('user-id-1')
    })
  })
})
