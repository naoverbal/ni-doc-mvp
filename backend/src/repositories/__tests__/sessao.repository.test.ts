import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarSessaoRepository } from '../sessao.repository.js'
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

function makeDeleteBuilder() {
  const builder = {
    where: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
  }
  builder.where.mockReturnValue(builder)
  return builder
}

function makeUpdateBuilder() {
  const builder = {
    set: vi.fn(),
    where: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
  }
  builder.set.mockReturnValue(builder)
  builder.where.mockReturnValue(builder)
  return builder
}

const expiraEm = new Date('2024-06-01T20:00:00Z')
const sessaoRow = {
  id: 'sessao-id-1',
  usuario_id: 'user-1',
  expira_em: expiraEm,
  ultima_atividade: new Date('2024-06-01T12:00:00Z'),
}

describe('SessaoRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('criar()', () => {
    it('insere a sessão e retorna id e expiraEm', async () => {
      const insertBuilder = makeInsertBuilder({ id: 'sessao-id-1', expira_em: expiraEm })
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarSessaoRepository(db)
      const result = await repo.criar({
        usuarioId: 'user-1',
        ip: '10.0.0.1',
        userAgent: 'vitest',
        expiraEm,
      })

      expect(db.insertInto).toHaveBeenCalledWith('sessoes')
      expect(insertBuilder.values).toHaveBeenCalledWith({
        usuario_id: 'user-1',
        ip: '10.0.0.1',
        user_agent: 'vitest',
        expira_em: expiraEm,
      })
      expect(result).toEqual({ id: 'sessao-id-1', expiraEm })
    })

    it('usa null para ip e userAgent ausentes', async () => {
      const insertBuilder = makeInsertBuilder({ id: 'sessao-id-2', expira_em: expiraEm })
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarSessaoRepository(db)
      await repo.criar({ usuarioId: 'user-1', expiraEm })

      expect(insertBuilder.values).toHaveBeenCalledWith({
        usuario_id: 'user-1',
        ip: null,
        user_agent: null,
        expira_em: expiraEm,
      })
    })
  })

  describe('buscarPorId()', () => {
    it('retorna null quando a sessão não existe', async () => {
      const selectBuilder = makeSelectBuilder(undefined)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarSessaoRepository(db)
      const result = await repo.buscarPorId('inexistente')

      expect(result).toBeNull()
    })

    it('mapeia a linha para SessaoAtiva', async () => {
      const selectBuilder = makeSelectBuilder(sessaoRow)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarSessaoRepository(db)
      const result = await repo.buscarPorId('sessao-id-1')

      expect(result).toEqual({
        id: 'sessao-id-1',
        usuarioId: 'user-1',
        expiraEm,
        ultimaAtividade: sessaoRow.ultima_atividade,
      })
    })
  })

  describe('invalidar()', () => {
    it('deleta a sessão pelo id', async () => {
      const deleteBuilder = makeDeleteBuilder()
      const db = {
        deleteFrom: vi.fn().mockReturnValue(deleteBuilder),
      } as unknown as Kysely<Database>

      const repo = criarSessaoRepository(db)
      await repo.invalidar('sessao-id-1')

      expect(db.deleteFrom).toHaveBeenCalledWith('sessoes')
      expect(deleteBuilder.where).toHaveBeenCalledWith('id', '=', 'sessao-id-1')
      expect(deleteBuilder.execute).toHaveBeenCalledOnce()
    })
  })

  describe('atualizarAtividade()', () => {
    it('atualiza ultima_atividade da sessão', async () => {
      const updateBuilder = makeUpdateBuilder()
      const db = {
        updateTable: vi.fn().mockReturnValue(updateBuilder),
      } as unknown as Kysely<Database>

      const repo = criarSessaoRepository(db)
      await repo.atualizarAtividade('sessao-id-1')

      expect(db.updateTable).toHaveBeenCalledWith('sessoes')
      expect(updateBuilder.set).toHaveBeenCalledOnce()
      const setArg = updateBuilder.set.mock.calls[0]?.[0] as { ultima_atividade: Date }
      expect(setArg.ultima_atividade).toBeInstanceOf(Date)
      expect(updateBuilder.where).toHaveBeenCalledWith('id', '=', 'sessao-id-1')
      expect(updateBuilder.execute).toHaveBeenCalledOnce()
    })
  })
})
