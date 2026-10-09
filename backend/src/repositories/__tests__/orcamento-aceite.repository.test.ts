import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarOrcamentoAceiteRepository } from '../orcamento-aceite.repository.js'
import type { RegistrarAceiteInput } from '../orcamento-aceite.repository.js'
import { AppError } from '../../errors/app-error.js'
import type { Kysely } from 'kysely'
import type { Database } from '../../types/database.js'

// -----------------------------------------------------------------------------
// Testes 100% mock-based (mesma convenção de orcamento-versao.repository.test):
// não sobe Postgres. A transação de `aprovarAceite` executa, nesta ordem, um
// advisory lock (SQL cru), um SELECT do estado do orçamento ligado à versão
// (SQL cru), e então o builder de insert em `orcamento_aceites` e o builder de
// update em `orcamentos`. O mock do executor resolve os SQLs crus por índice; os
// builders fluentes são injetados por `makeTrx`. A rede de segurança real
// (UNIQUE (versao_id)) é verificada em integração.
// -----------------------------------------------------------------------------

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

function makeUpdateBuilder() {
  const builder = {
    set: vi.fn(),
    where: vi.fn(),
    execute: vi.fn().mockResolvedValue([]),
  }
  builder.set.mockReturnValue(builder)
  builder.where.mockReturnValue(builder)
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

function aceiteRowBase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aceite-row-id',
    versao_id: 'versao-1',
    metodo: 'cliente',
    usuario_id: null,
    ip: '1.2.3.4',
    user_agent: 'agent',
    hash_documento: 'a'.repeat(64),
    justificativa: null,
    criado_em: new Date('2026-02-01'),
    ...overrides,
  }
}

const inputBase: RegistrarAceiteInput = {
  tenantId: 'tenant-1',
  versaoId: 'versao-1',
  metodo: 'cliente',
  ip: '1.2.3.4',
  userAgent: 'agent',
  hashDocumento: 'a'.repeat(64),
}

// Monta um mock de transação. O 1º SQL cru é o advisory lock; o 2º é o SELECT do
// estado do orçamento (status) ligado à versão. `statusOrcamento === undefined`
// → a versão/orçamento não existe (nenhuma linha).
function makeTrx(options: {
  insertAceite: ReturnType<typeof makeInsertBuilder>
  updateOrcamento: ReturnType<typeof makeUpdateBuilder>
  statusOrcamento?: string
}) {
  const sqlExecutado: string[] = []

  const executor = {
    transformQuery: (node: unknown) => node,
    compileQuery: (node: { sqlFragments?: string[] }) => ({
      sql: (node.sqlFragments ?? []).join('?'),
      parameters: [],
      query: node,
    }),
    executeQuery: (compiled: { sql: string }) => {
      sqlExecutado.push(compiled.sql)
      if (sqlExecutado.length === 1) return Promise.resolve({ rows: [{}] })
      if (options.statusOrcamento === undefined) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [{ status: options.statusOrcamento }] })
    },
    withPlugins: () => executor,
  }

  const trx = {
    getExecutor: () => executor,
    sqlExecutado,
    insertInto: vi.fn().mockReturnValue(options.insertAceite),
    updateTable: vi.fn().mockReturnValue(options.updateOrcamento),
  }
  return trx
}

function makeDbComTransacao(trx: unknown) {
  return {
    transaction: () => ({
      execute: (cb: (t: unknown) => unknown) => cb(trx),
    }),
  } as unknown as Kysely<Database>
}

describe('OrcamentoAceiteRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('aprovarAceite()', () => {
    it('insere o aceite com metodo, hash e evidências e marca o orçamento como aprovado', async () => {
      const insertAceite = makeInsertBuilder(aceiteRowBase())
      const updateOrcamento = makeUpdateBuilder()
      const trx = makeTrx({ insertAceite, updateOrcamento, statusOrcamento: 'enviado' })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoAceiteRepository({ db })
      const aceite = await repo.aprovarAceite(inputBase)

      expect(trx.insertInto).toHaveBeenCalledWith('orcamento_aceites')
      expect(insertAceite.values).toHaveBeenCalledWith(
        expect.objectContaining({
          versao_id: 'versao-1',
          metodo: 'cliente',
          hash_documento: 'a'.repeat(64),
          ip: '1.2.3.4',
          user_agent: 'agent',
          usuario_id: null,
          justificativa: null,
        }),
      )
      expect(trx.updateTable).toHaveBeenCalledWith('orcamentos')
      expect(updateOrcamento.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'aprovado' }),
      )
      expect(updateOrcamento.where).toHaveBeenCalledWith('tenant_id', '=', 'tenant-1')
      expect(aceite.versaoId).toBe('versao-1')
      expect(aceite.metodo).toBe('cliente')
    })

    it('registra usuario_id e justificativa no aceite de operador', async () => {
      const insertAceite = makeInsertBuilder(
        aceiteRowBase({ metodo: 'operador', usuario_id: 'op-1', justificativa: 'cliente aceitou' }),
      )
      const updateOrcamento = makeUpdateBuilder()
      const trx = makeTrx({ insertAceite, updateOrcamento, statusOrcamento: 'enviado' })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoAceiteRepository({ db })
      const aceite = await repo.aprovarAceite({
        tenantId: 'tenant-1',
        versaoId: 'versao-1',
        metodo: 'operador',
        usuarioId: 'op-1',
        justificativa: 'cliente aceitou',
        hashDocumento: 'a'.repeat(64),
      })

      expect(insertAceite.values).toHaveBeenCalledWith(
        expect.objectContaining({
          metodo: 'operador',
          usuario_id: 'op-1',
          justificativa: 'cliente aceitou',
          ip: null,
          user_agent: null,
        }),
      )
      expect(aceite.metodo).toBe('operador')
      expect(aceite.usuarioId).toBe('op-1')
      expect(aceite.justificativa).toBe('cliente aceitou')
    })

    it('emite o advisory lock ANTES do SELECT de estado (sem race condition)', async () => {
      const insertAceite = makeInsertBuilder(aceiteRowBase())
      const updateOrcamento = makeUpdateBuilder()
      const trx = makeTrx({ insertAceite, updateOrcamento, statusOrcamento: 'enviado' })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoAceiteRepository({ db })
      await repo.aprovarAceite(inputBase)

      expect(trx.sqlExecutado[0]).toContain('pg_advisory_xact_lock')
    })

    it('lança AppError(409) quando o orçamento já está aprovado (aceite duplicado)', async () => {
      const insertAceite = makeInsertBuilder(aceiteRowBase())
      const updateOrcamento = makeUpdateBuilder()
      const trx = makeTrx({ insertAceite, updateOrcamento, statusOrcamento: 'aprovado' })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoAceiteRepository({ db })
      await expect(repo.aprovarAceite(inputBase)).rejects.toBeInstanceOf(AppError)
      await expect(repo.aprovarAceite(inputBase)).rejects.toMatchObject({ statusCode: 409 })
      expect(insertAceite.values).not.toHaveBeenCalled()
    })

    it('lança AppError(409) quando a versão/orçamento não existe', async () => {
      const insertAceite = makeInsertBuilder(aceiteRowBase())
      const updateOrcamento = makeUpdateBuilder()
      const trx = makeTrx({ insertAceite, updateOrcamento })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoAceiteRepository({ db })
      await expect(repo.aprovarAceite(inputBase)).rejects.toMatchObject({ statusCode: 409 })
      expect(insertAceite.values).not.toHaveBeenCalled()
    })

    it('mapeia a linha inserida para AceitePublico (camelCase)', async () => {
      const insertAceite = makeInsertBuilder(
        aceiteRowBase({ id: 'ac-9', versao_id: 'v-9', ip: null, user_agent: null }),
      )
      const updateOrcamento = makeUpdateBuilder()
      const trx = makeTrx({ insertAceite, updateOrcamento, statusOrcamento: 'enviado' })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoAceiteRepository({ db })
      const aceite = await repo.aprovarAceite(inputBase)

      expect(aceite.id).toBe('ac-9')
      expect(aceite.versaoId).toBe('v-9')
      expect(aceite.ip).toBeNull()
      expect(aceite.userAgent).toBeNull()
      expect(aceite.hashDocumento).toBe('a'.repeat(64))
      expect(aceite.criadoEm).toBeInstanceOf(Date)
    })
  })

  describe('buscarPorVersao()', () => {
    it('retorna o aceite mapeado quando existe', async () => {
      const selectBuilder = makeSelectBuilder(aceiteRowBase({ metodo: 'operador', usuario_id: 'op-1' }))
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarOrcamentoAceiteRepository({ db })
      const aceite = await repo.buscarPorVersao('versao-1')

      expect(db.selectFrom).toHaveBeenCalledWith('orcamento_aceites')
      expect(selectBuilder.where).toHaveBeenCalledWith('versao_id', '=', 'versao-1')
      expect(aceite?.metodo).toBe('operador')
      expect(aceite?.usuarioId).toBe('op-1')
    })

    it('retorna null quando não há aceite para a versão', async () => {
      const selectBuilder = makeSelectBuilder(undefined)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarOrcamentoAceiteRepository({ db })
      const aceite = await repo.buscarPorVersao('versao-x')

      expect(aceite).toBeNull()
    })
  })
})
