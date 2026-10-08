import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarAuditoriaRepository } from '../auditoria.repository.js'
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
    selectAll: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    execute: vi.fn().mockResolvedValue(result),
  }
  builder.selectAll.mockReturnValue(builder)
  builder.where.mockReturnValue(builder)
  builder.orderBy.mockReturnValue(builder)
  builder.limit.mockReturnValue(builder)
  builder.offset.mockReturnValue(builder)
  return builder
}

const eventoRow = {
  id: 'evento-id-1',
  tenant_id: 'tenant-1',
  usuario_id: 'user-1',
  acao: 'login',
  entidade: 'usuarios',
  entidade_id: 'user-1',
  estado_anterior: null,
  estado_novo: null,
  ip: '127.0.0.1',
  user_agent: 'test-agent',
  criado_em: new Date('2024-01-01'),
}

describe('AuditoriaRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('criar()', () => {
    it('insere o evento com todos os campos', async () => {
      const insertBuilder = makeInsertBuilder({ id: 'evento-id-1' })
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarAuditoriaRepository(db)
      const result = await repo.criar({
        tenantId: 'tenant-1',
        usuarioId: 'user-1',
        acao: 'atualizar',
        entidade: 'orcamentos',
        entidadeId: 'orc-1',
        estadoAnterior: { status: 'rascunho' },
        estadoNovo: { status: 'enviado' },
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      })

      expect(db.insertInto).toHaveBeenCalledWith('eventos_auditoria')
      expect(insertBuilder.values).toHaveBeenCalledWith({
        tenant_id: 'tenant-1',
        usuario_id: 'user-1',
        acao: 'atualizar',
        entidade: 'orcamentos',
        entidade_id: 'orc-1',
        estado_anterior: JSON.stringify({ status: 'rascunho' }),
        estado_novo: JSON.stringify({ status: 'enviado' }),
        ip: '127.0.0.1',
        user_agent: 'test-agent',
      })
      expect(insertBuilder.returning).toHaveBeenCalledWith('id')
      expect(result).toEqual({ id: 'evento-id-1' })
    })

    it('serializa estadoAnterior e estadoNovo como JSON (JSONB)', async () => {
      const insertBuilder = makeInsertBuilder({ id: 'evento-id-2' })
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarAuditoriaRepository(db)
      await repo.criar({
        tenantId: 'tenant-1',
        acao: 'atualizar',
        entidade: 'clientes',
        estadoAnterior: { nome: 'Antigo', valores: [1, 2, 3] },
        estadoNovo: { nome: 'Novo', valores: [4, 5] },
      })

      const valores = insertBuilder.values.mock.calls[0]?.[0] as {
        estado_anterior: string
        estado_novo: string
      }
      // Devem ser strings JSON válidas e desserializáveis para os objetos originais
      expect(typeof valores.estado_anterior).toBe('string')
      expect(typeof valores.estado_novo).toBe('string')
      expect(JSON.parse(valores.estado_anterior)).toEqual({ nome: 'Antigo', valores: [1, 2, 3] })
      expect(JSON.parse(valores.estado_novo)).toEqual({ nome: 'Novo', valores: [4, 5] })
    })

    it('usa null para campos opcionais ausentes', async () => {
      const insertBuilder = makeInsertBuilder({ id: 'evento-id-3' })
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarAuditoriaRepository(db)
      await repo.criar({
        tenantId: 'tenant-1',
        acao: 'criar_orcamento',
        entidade: 'orcamentos',
      })

      expect(insertBuilder.values).toHaveBeenCalledWith({
        tenant_id: 'tenant-1',
        usuario_id: null,
        acao: 'criar_orcamento',
        entidade: 'orcamentos',
        entidade_id: null,
        estado_anterior: null,
        estado_novo: null,
        ip: null,
        user_agent: null,
      })
    })

    it('diferencia null de undefined ao serializar estados', async () => {
      const insertBuilder = makeInsertBuilder({ id: 'evento-id-4' })
      const db = {
        insertInto: vi.fn().mockReturnValue(insertBuilder),
      } as unknown as Kysely<Database>

      const repo = criarAuditoriaRepository(db)
      // estadoAnterior explicitamente null é um valor válido e deve ser serializado
      await repo.criar({
        tenantId: 'tenant-1',
        acao: 'remover',
        entidade: 'clientes',
        estadoAnterior: null,
        estadoNovo: undefined,
      })

      const valores = insertBuilder.values.mock.calls[0]?.[0] as {
        estado_anterior: string | null
        estado_novo: string | null
      }
      expect(valores.estado_anterior).toBe(JSON.stringify(null))
      expect(valores.estado_novo).toBeNull()
    })
  })

  describe('listar()', () => {
    it('filtra sempre pelo tenant e ordena por criado_em desc', async () => {
      const selectBuilder = makeSelectBuilder([eventoRow])
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarAuditoriaRepository(db)
      const result = await repo.listar({ tenantId: 'tenant-1' })

      expect(db.selectFrom).toHaveBeenCalledWith('eventos_auditoria')
      expect(selectBuilder.where).toHaveBeenCalledWith('tenant_id', '=', 'tenant-1')
      expect(selectBuilder.orderBy).toHaveBeenCalledWith('criado_em', 'desc')
      expect(result).toEqual([eventoRow])
    })

    it('filtra por entidade quando informada', async () => {
      const selectBuilder = makeSelectBuilder([eventoRow])
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarAuditoriaRepository(db)
      await repo.listar({ tenantId: 'tenant-1', entidade: 'usuarios' })

      expect(selectBuilder.where).toHaveBeenCalledWith('entidade', '=', 'usuarios')
    })

    it('respeita o isolamento por tenant (filtra pelo tenant solicitado)', async () => {
      const selectBuilder = makeSelectBuilder([])
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarAuditoriaRepository(db)
      const result = await repo.listar({ tenantId: 'outro-tenant', entidade: 'usuarios' })

      expect(selectBuilder.where).toHaveBeenCalledWith('tenant_id', '=', 'outro-tenant')
      expect(result).toEqual([])
    })

    it('aplica filtros de entidadeId, usuarioId e período', async () => {
      const selectBuilder = makeSelectBuilder([eventoRow])
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const de = new Date('2024-01-01T00:00:00Z')
      const ate = new Date('2024-12-31T23:59:59Z')

      const repo = criarAuditoriaRepository(db)
      await repo.listar({
        tenantId: 'tenant-1',
        entidade: 'orcamentos',
        entidadeId: 'orc-1',
        usuarioId: 'user-1',
        de,
        ate,
      })

      expect(selectBuilder.where).toHaveBeenCalledWith('entidade_id', '=', 'orc-1')
      expect(selectBuilder.where).toHaveBeenCalledWith('usuario_id', '=', 'user-1')
      expect(selectBuilder.where).toHaveBeenCalledWith('criado_em', '>=', de)
      expect(selectBuilder.where).toHaveBeenCalledWith('criado_em', '<=', ate)
    })

    it('usa paginação padrão (página 1, limite 50)', async () => {
      const selectBuilder = makeSelectBuilder([])
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarAuditoriaRepository(db)
      await repo.listar({ tenantId: 'tenant-1' })

      expect(selectBuilder.limit).toHaveBeenCalledWith(50)
      expect(selectBuilder.offset).toHaveBeenCalledWith(0)
    })

    it('calcula offset a partir de pagina e limite informados', async () => {
      const selectBuilder = makeSelectBuilder([])
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarAuditoriaRepository(db)
      await repo.listar({ tenantId: 'tenant-1', pagina: 3, limite: 10 })

      expect(selectBuilder.limit).toHaveBeenCalledWith(10)
      expect(selectBuilder.offset).toHaveBeenCalledWith(20)
    })
  })
})
