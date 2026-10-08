import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarEmpresaRepository } from '../empresa.repository.js'
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
  id: 'empresa-id-1',
  tenant_id: 'tenant-1',
  tipo: 'cliente_pj' as const,
  razao_social: 'Acme Indústria Ltda',
  nome_fantasia: 'Acme',
  cnpj_hash: crypto.hashDocumento('11222333000181'),
  cnpj_encrypted: crypto.criptografar('11222333000181'),
  email_encrypted: crypto.criptografar('contato@acme.com'),
  telefone_encrypted: crypto.criptografar('11999990000'),
  endereco_encrypted: crypto.criptografar('Rua A, 123'),
  ativo: true,
  criado_em: new Date('2024-01-01'),
}

describe('EmpresaRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('criar()', () => {
    it('criptografa e faz hash do CNPJ quando presente (SHA-256)', async () => {
      const hashDocumentoSpy = vi.spyOn(crypto, 'hashDocumento')
      const criptografarSpy = vi.spyOn(crypto, 'criptografar')

      const insertBuilder = makeInsertBuilder(rowBase)
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarEmpresaRepository(db)
      await repo.criar({
        tenantId: 'tenant-1',
        tipo: 'cliente_pj',
        razaoSocial: 'Acme Indústria Ltda',
        nomeFantasia: 'Acme',
        cnpj: '11.222.333/0001-81',
        email: 'contato@acme.com',
        telefone: '11999990000',
        endereco: 'Rua A, 123',
      })

      expect(hashDocumentoSpy).toHaveBeenCalledWith('11.222.333/0001-81')
      expect(criptografarSpy).toHaveBeenCalledWith('11.222.333/0001-81')
      expect(criptografarSpy).toHaveBeenCalledWith('contato@acme.com')
      expect(criptografarSpy).toHaveBeenCalledWith('11999990000')
      expect(criptografarSpy).toHaveBeenCalledWith('Rua A, 123')
    })

    it('retorna empresa com campos sensíveis descriptografados', async () => {
      const insertBuilder = makeInsertBuilder(rowBase)
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarEmpresaRepository(db)
      const result = await repo.criar({
        tenantId: 'tenant-1',
        tipo: 'cliente_pj',
        razaoSocial: 'Acme Indústria Ltda',
        cnpj: '11222333000181',
      })

      expect(result.id).toBe('empresa-id-1')
      expect(result.razaoSocial).toBe('Acme Indústria Ltda')
      expect(result.nomeFantasia).toBe('Acme')
      expect(result.cnpj).toBe('11222333000181')
      expect(result.email).toBe('contato@acme.com')
      expect(result.telefone).toBe('11999990000')
      expect(result.endereco).toBe('Rua A, 123')
    })

    it('grava campos opcionais ausentes como null', async () => {
      const rowSemOpcionais = {
        ...rowBase,
        nome_fantasia: null,
        cnpj_hash: null,
        cnpj_encrypted: null,
        email_encrypted: null,
        telefone_encrypted: null,
        endereco_encrypted: null,
      }
      const insertBuilder = makeInsertBuilder(rowSemOpcionais)
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarEmpresaRepository(db)
      const result = await repo.criar({
        tenantId: 'tenant-1',
        tipo: 'cliente_pj',
        razaoSocial: 'Acme Indústria Ltda',
      })

      expect(result.cnpj).toBeNull()
      expect(result.nomeFantasia).toBeNull()
      expect(result.email).toBeNull()
      expect(result.telefone).toBeNull()
      expect(result.endereco).toBeNull()
    })

    it('grava cnpj_hash e cnpj_encrypted como null quando CNPJ ausente', async () => {
      const rowSemCnpj = { ...rowBase, cnpj_hash: null, cnpj_encrypted: null }
      const insertBuilder = makeInsertBuilder(rowSemCnpj)
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarEmpresaRepository(db)
      await repo.criar({
        tenantId: 'tenant-1',
        tipo: 'cliente_pj',
        razaoSocial: 'Acme Indústria Ltda',
      })

      expect(insertBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          cnpj_hash: null,
          cnpj_encrypted: null,
        }),
      )
    })
  })

  describe('buscarPorCnpjHash()', () => {
    it('retorna null quando não existe', async () => {
      const selectBuilder = makeSelectBuilder(undefined)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarEmpresaRepository(db)
      const result = await repo.buscarPorCnpjHash('tenant-1', 'hash-inexistente')

      expect(result).toBeNull()
    })

    it('retorna empresa mapeada quando encontrada', async () => {
      const selectBuilder = makeSelectBuilder(rowBase)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarEmpresaRepository(db)
      const result = await repo.buscarPorCnpjHash('tenant-1', 'hash-123')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('empresa-id-1')
    })
  })

  describe('buscarPorId()', () => {
    it('retorna null quando não existe', async () => {
      const selectBuilder = makeSelectBuilder(undefined)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarEmpresaRepository(db)
      const result = await repo.buscarPorId('tenant-1', 'id-inexistente')

      expect(result).toBeNull()
    })

    it('descriptografa os campos sensíveis', async () => {
      const selectBuilder = makeSelectBuilder(rowBase)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarEmpresaRepository(db)
      const result = await repo.buscarPorId('tenant-1', 'empresa-id-1')

      expect(result?.cnpj).toBe('11222333000181')
      expect(result?.email).toBe('contato@acme.com')
      expect(result?.telefone).toBe('11999990000')
      expect(result?.endereco).toBe('Rua A, 123')
    })
  })

  describe('buscarPorNomeETipo()', () => {
    it('busca por razão social com ILIKE e filtra por tipo', async () => {
      const selectBuilder = makeSelectBuilder([rowBase], true)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarEmpresaRepository(db)
      const result = await repo.buscarPorNomeETipo('tenant-1', 'acme', 'cliente_pj')

      expect(result).toHaveLength(1)
      expect(result[0]?.razaoSocial).toBe('Acme Indústria Ltda')
      // Deve ter usado operador ilike com padrão %acme%
      expect(selectBuilder.where).toHaveBeenCalledWith('razao_social', 'ilike', '%acme%')
      // Deve filtrar pelo tipo informado
      expect(selectBuilder.where).toHaveBeenCalledWith('tipo', '=', 'cliente_pj')
      // Deve filtrar apenas ativos
      expect(selectBuilder.where).toHaveBeenCalledWith('ativo', '=', true)
    })
  })

  describe('atualizar()', () => {
    it('atualiza apenas campos do cadastro e retorna empresa', async () => {
      const atualizado = { ...rowBase, razao_social: 'Acme S.A.' }
      const updateBuilder = makeUpdateBuilder(atualizado)
      const db = {
        updateTable: vi.fn().mockReturnValue(updateBuilder),
      } as unknown as Kysely<Database>

      const repo = criarEmpresaRepository(db)
      const result = await repo.atualizar('tenant-1', 'empresa-id-1', { razaoSocial: 'Acme S.A.' })

      expect(db.updateTable).toHaveBeenCalledWith('empresas')
      expect(result?.razaoSocial).toBe('Acme S.A.')
    })

    it('retorna null quando a empresa não existe', async () => {
      const updateBuilder = makeUpdateBuilder(undefined)
      const db = {
        updateTable: vi.fn().mockReturnValue(updateBuilder),
      } as unknown as Kysely<Database>

      const repo = criarEmpresaRepository(db)
      const result = await repo.atualizar('tenant-1', 'inexistente', { razaoSocial: 'X' })

      expect(result).toBeNull()
    })
  })

  describe('desativar()', () => {
    it('faz soft delete (ativo = false)', async () => {
      const updateBuilder = makeUpdateBuilder({ id: 'empresa-id-1' })
      const db = {
        updateTable: vi.fn().mockReturnValue(updateBuilder),
      } as unknown as Kysely<Database>

      const repo = criarEmpresaRepository(db)
      await repo.desativar('tenant-1', 'empresa-id-1')

      expect(updateBuilder.set).toHaveBeenCalledWith(expect.objectContaining({ ativo: false }))
    })
  })
})
