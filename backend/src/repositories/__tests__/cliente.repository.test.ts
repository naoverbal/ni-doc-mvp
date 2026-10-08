import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarClienteRepository } from '../cliente.repository.js'
import * as crypto from '../../lib/crypto.js'
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

function makeSelectBuilder(result: unknown, many = false) {
  const builder = {
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    executeTakeFirst: vi.fn().mockResolvedValue(result),
    execute: vi.fn().mockResolvedValue(many ? result : [result]),
  }
  builder.select.mockReturnValue(builder)
  builder.where.mockReturnValue(builder)
  builder.orderBy.mockReturnValue(builder)
  builder.limit.mockReturnValue(builder)
  return builder
}

function makeUpdateBuilder(result: unknown) {
  const builder = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
    executeTakeFirst: vi.fn().mockResolvedValue(result),
  }
  builder.set.mockReturnValue(builder)
  builder.where.mockReturnValue(builder)
  builder.returning.mockReturnValue(builder)
  return builder
}

const rowBase = {
  id: 'cliente-id-1',
  tenant_id: 'tenant-1',
  tipo_pessoa: 'PF' as const,
  nome: 'Maria Silva',
  documento_encrypted: crypto.criptografar('52998224725'),
  email_encrypted: crypto.criptografar('maria@exemplo.com'),
  telefone_encrypted: crypto.criptografar('11999990000'),
  endereco_encrypted: crypto.criptografar('Rua A, 123'),
  observacoes: null,
  ativo: true,
  criado_em: new Date('2024-01-01'),
}

describe('ClienteRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('criar()', () => {
    it('criptografa e faz hash do documento (SHA-256)', async () => {
      const hashDocumentoSpy = vi.spyOn(crypto, 'hashDocumento')
      const criptografarSpy = vi.spyOn(crypto, 'criptografar')

      const insertBuilder = makeInsertBuilder(rowBase)
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarClienteRepository(db)
      await repo.criar({
        tenantId: 'tenant-1',
        tipoPessoa: 'PF',
        nome: 'Maria Silva',
        documento: '529.982.247-25',
        email: 'maria@exemplo.com',
        telefone: '11999990000',
        endereco: 'Rua A, 123',
      })

      expect(hashDocumentoSpy).toHaveBeenCalledWith('529.982.247-25')
      expect(criptografarSpy).toHaveBeenCalledWith('529.982.247-25')
      expect(criptografarSpy).toHaveBeenCalledWith('maria@exemplo.com')
      expect(criptografarSpy).toHaveBeenCalledWith('11999990000')
      expect(criptografarSpy).toHaveBeenCalledWith('Rua A, 123')
    })

    it('retorna cliente com campos sensíveis descriptografados', async () => {
      const insertBuilder = makeInsertBuilder(rowBase)
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarClienteRepository(db)
      const result = await repo.criar({
        tenantId: 'tenant-1',
        tipoPessoa: 'PF',
        nome: 'Maria Silva',
        documento: '52998224725',
      })

      expect(result.id).toBe('cliente-id-1')
      expect(result.documento).toBe('52998224725')
      expect(result.email).toBe('maria@exemplo.com')
      expect(result.telefone).toBe('11999990000')
      expect(result.endereco).toBe('Rua A, 123')
    })

    it('grava campos opcionais ausentes como null', async () => {
      const rowSemOpcionais = {
        ...rowBase,
        email_encrypted: null,
        telefone_encrypted: null,
        endereco_encrypted: null,
      }
      const insertBuilder = makeInsertBuilder(rowSemOpcionais)
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarClienteRepository(db)
      const result = await repo.criar({
        tenantId: 'tenant-1',
        tipoPessoa: 'PF',
        nome: 'Maria Silva',
        documento: '52998224725',
      })

      expect(result.email).toBeNull()
      expect(result.telefone).toBeNull()
      expect(result.endereco).toBeNull()
      // Valores inseridos para opcionais ausentes devem ser null
      expect(insertBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          email_encrypted: null,
          telefone_encrypted: null,
          endereco_encrypted: null,
        }),
      )
    })
  })

  describe('buscarPorDocumentoHash()', () => {
    it('retorna null quando não existe', async () => {
      const selectBuilder = makeSelectBuilder(undefined)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarClienteRepository(db)
      const result = await repo.buscarPorDocumentoHash('tenant-1', 'hash-inexistente')

      expect(result).toBeNull()
    })

    it('busca pelo hash do documento (não pelo documento em texto plano)', async () => {
      const selectBuilder = makeSelectBuilder(rowBase)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarClienteRepository(db)
      const result = await repo.buscarPorDocumentoHash('tenant-1', 'hash-123')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('cliente-id-1')
    })
  })

  describe('buscarPorId()', () => {
    it('retorna null quando não existe', async () => {
      const selectBuilder = makeSelectBuilder(undefined)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarClienteRepository(db)
      const result = await repo.buscarPorId('tenant-1', 'id-inexistente')

      expect(result).toBeNull()
    })

    it('descriptografa os campos sensíveis', async () => {
      const selectBuilder = makeSelectBuilder(rowBase)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarClienteRepository(db)
      const result = await repo.buscarPorId('tenant-1', 'cliente-id-1')

      expect(result?.documento).toBe('52998224725')
      expect(result?.email).toBe('maria@exemplo.com')
      expect(result?.telefone).toBe('11999990000')
      expect(result?.endereco).toBe('Rua A, 123')
    })
  })

  describe('buscarPorNome()', () => {
    it('busca por nome com ILIKE (autocomplete)', async () => {
      const selectBuilder = makeSelectBuilder([rowBase], true)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarClienteRepository(db)
      const result = await repo.buscarPorNome('tenant-1', 'mar')

      expect(result).toHaveLength(1)
      expect(result[0]?.nome).toBe('Maria Silva')
      // Deve ter usado operador ilike com padrão %mar%
      expect(selectBuilder.where).toHaveBeenCalledWith('nome', 'ilike', '%mar%')
    })
  })

  describe('atualizar()', () => {
    it('atualiza apenas campos do cadastro e retorna cliente', async () => {
      const atualizado = { ...rowBase, nome: 'Maria Souza' }
      const updateBuilder = makeUpdateBuilder(atualizado)
      const db = {
        updateTable: vi.fn().mockReturnValue(updateBuilder),
      } as unknown as Kysely<Database>

      const repo = criarClienteRepository(db)
      const result = await repo.atualizar('tenant-1', 'cliente-id-1', { nome: 'Maria Souza' })

      expect(db.updateTable).toHaveBeenCalledWith('clientes')
      expect(result?.nome).toBe('Maria Souza')
    })

    it('retorna null quando o cliente não existe', async () => {
      const updateBuilder = makeUpdateBuilder(undefined)
      const db = {
        updateTable: vi.fn().mockReturnValue(updateBuilder),
      } as unknown as Kysely<Database>

      const repo = criarClienteRepository(db)
      const result = await repo.atualizar('tenant-1', 'inexistente', { nome: 'X' })

      expect(result).toBeNull()
    })
  })

  describe('desativar()', () => {
    it('faz soft delete (ativo = false)', async () => {
      const updateBuilder = makeUpdateBuilder({ id: 'cliente-id-1' })
      const db = {
        updateTable: vi.fn().mockReturnValue(updateBuilder),
      } as unknown as Kysely<Database>

      const repo = criarClienteRepository(db)
      await repo.desativar('tenant-1', 'cliente-id-1')

      expect(updateBuilder.set).toHaveBeenCalledWith(expect.objectContaining({ ativo: false }))
    })
  })
})
