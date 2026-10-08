import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarResponsavelRepository } from '../responsavel.repository.js'
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
  id: 'responsavel-id-1',
  tenant_id: 'tenant-1',
  nome: 'João Engenheiro',
  registro_profissional: 'CREA-123456',
  email_encrypted: crypto.criptografar('joao@exemplo.com'),
  telefone_encrypted: crypto.criptografar('11988887777'),
  ativo: true,
  criado_em: new Date('2024-01-01'),
}

describe('ResponsavelRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('criar()', () => {
    it('criptografa email/telefone e passa registro profissional em texto plano', async () => {
      const criptografarSpy = vi.spyOn(crypto, 'criptografar')

      const insertBuilder = makeInsertBuilder(rowBase)
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarResponsavelRepository(db)
      await repo.criar({
        tenantId: 'tenant-1',
        nome: 'João Engenheiro',
        registroProfissional: 'CREA-123456',
        email: 'joao@exemplo.com',
        telefone: '11988887777',
      })

      expect(criptografarSpy).toHaveBeenCalledWith('joao@exemplo.com')
      expect(criptografarSpy).toHaveBeenCalledWith('11988887777')
      expect(insertBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          nome: 'João Engenheiro',
          registro_profissional: 'CREA-123456',
        }),
      )
    })

    it('retorna responsável com campos sensíveis descriptografados', async () => {
      const insertBuilder = makeInsertBuilder(rowBase)
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarResponsavelRepository(db)
      const result = await repo.criar({
        tenantId: 'tenant-1',
        nome: 'João Engenheiro',
      })

      expect(result.id).toBe('responsavel-id-1')
      expect(result.registroProfissional).toBe('CREA-123456')
      expect(result.email).toBe('joao@exemplo.com')
      expect(result.telefone).toBe('11988887777')
    })

    it('grava campos opcionais ausentes como null', async () => {
      const rowSemOpcionais = {
        ...rowBase,
        registro_profissional: null,
        email_encrypted: null,
        telefone_encrypted: null,
      }
      const insertBuilder = makeInsertBuilder(rowSemOpcionais)
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarResponsavelRepository(db)
      const result = await repo.criar({
        tenantId: 'tenant-1',
        nome: 'João Engenheiro',
      })

      expect(result.registroProfissional).toBeNull()
      expect(result.email).toBeNull()
      expect(result.telefone).toBeNull()
      // Valores inseridos para opcionais ausentes devem ser null
      expect(insertBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          registro_profissional: null,
          email_encrypted: null,
          telefone_encrypted: null,
        }),
      )
    })
  })

  describe('buscarPorId()', () => {
    it('retorna null quando não existe', async () => {
      const selectBuilder = makeSelectBuilder(undefined)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarResponsavelRepository(db)
      const result = await repo.buscarPorId('tenant-1', 'id-inexistente')

      expect(result).toBeNull()
    })

    it('descriptografa os campos sensíveis', async () => {
      const selectBuilder = makeSelectBuilder(rowBase)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarResponsavelRepository(db)
      const result = await repo.buscarPorId('tenant-1', 'responsavel-id-1')

      expect(result?.registroProfissional).toBe('CREA-123456')
      expect(result?.email).toBe('joao@exemplo.com')
      expect(result?.telefone).toBe('11988887777')
    })
  })

  describe('buscarPorNome()', () => {
    it('busca por nome com ILIKE (autocomplete) filtrando ativos', async () => {
      const selectBuilder = makeSelectBuilder([rowBase], true)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarResponsavelRepository(db)
      const result = await repo.buscarPorNome('tenant-1', 'joa')

      expect(result).toHaveLength(1)
      expect(result[0]?.nome).toBe('João Engenheiro')
      // Deve ter usado operador ilike com padrão %joa%
      expect(selectBuilder.where).toHaveBeenCalledWith('nome', 'ilike', '%joa%')
      expect(selectBuilder.where).toHaveBeenCalledWith('ativo', '=', true)
    })
  })

  describe('atualizar()', () => {
    it('atualiza apenas campos do cadastro e retorna responsável', async () => {
      const atualizado = { ...rowBase, nome: 'João Souza' }
      const updateBuilder = makeUpdateBuilder(atualizado)
      const db = {
        updateTable: vi.fn().mockReturnValue(updateBuilder),
      } as unknown as Kysely<Database>

      const repo = criarResponsavelRepository(db)
      const result = await repo.atualizar('tenant-1', 'responsavel-id-1', { nome: 'João Souza' })

      expect(db.updateTable).toHaveBeenCalledWith('responsaveis_tecnicos')
      expect(result?.nome).toBe('João Souza')
    })

    it('retorna null quando o responsável não existe', async () => {
      const updateBuilder = makeUpdateBuilder(undefined)
      const db = {
        updateTable: vi.fn().mockReturnValue(updateBuilder),
      } as unknown as Kysely<Database>

      const repo = criarResponsavelRepository(db)
      const result = await repo.atualizar('tenant-1', 'inexistente', { nome: 'X' })

      expect(result).toBeNull()
    })
  })

  describe('desativar()', () => {
    it('faz soft delete (ativo = false)', async () => {
      const updateBuilder = makeUpdateBuilder({ id: 'responsavel-id-1' })
      const db = {
        updateTable: vi.fn().mockReturnValue(updateBuilder),
      } as unknown as Kysely<Database>

      const repo = criarResponsavelRepository(db)
      await repo.desativar('tenant-1', 'responsavel-id-1')

      expect(updateBuilder.set).toHaveBeenCalledWith(expect.objectContaining({ ativo: false }))
    })
  })
})
