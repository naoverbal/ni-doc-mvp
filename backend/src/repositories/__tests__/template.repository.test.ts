import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarTemplateRepository, LAYOUT_PADRAO } from '../template.repository.js'
import type { Kysely } from 'kysely'
import type { Database } from '../../types/database.js'

// -----------------------------------------------------------------------------
// Testes 100% mock-based (mesma convenção de cliente/orcamento.repository.test).
// NÃO sobem Postgres nem exercitam RLS. "Isolamento de tenant" é verificado como
// asserção de que as queries aplicam `.where('tenant_id', '=', tenantId)`.
// A imutabilidade/versionamento é verificada afirmando que `salvar` só faz
// `insertInto('templates')` (nunca `updateTable`/`deleteFrom` em templates) e
// calcula `versao = max + 1`.
// -----------------------------------------------------------------------------

// Builders fluentes do Kysely (encadeáveis).
function makeInsertBuilder(result: unknown) {
  const builder = {
    values: vi.fn(),
    returning: vi.fn(),
    onConflict: vi.fn(),
    executeTakeFirstOrThrow: vi.fn().mockResolvedValue(result),
    execute: vi.fn().mockResolvedValue([result]),
  }
  builder.values.mockReturnValue(builder)
  builder.returning.mockReturnValue(builder)
  builder.onConflict.mockReturnValue(builder)
  return builder
}

function makeSelectBuilder(result: unknown) {
  const builder = {
    innerJoin: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
    executeTakeFirst: vi.fn().mockResolvedValue(result),
    execute: vi.fn().mockResolvedValue([result]),
  }
  builder.innerJoin.mockReturnValue(builder)
  builder.select.mockReturnValue(builder)
  builder.where.mockReturnValue(builder)
  return builder
}

const layoutRecebido = { formato: 'A4', orientacao: 'paisagem', secoes: [] }

const templateRowBase = {
  id: 'template-1',
  tenant_id: 'tenant-1',
  versao: 1,
  layout_json: LAYOUT_PADRAO,
  criado_em: new Date('2024-01-01'),
}

// Monta um mock de transação. `cb` recebe o `trx`. O advisory lock e o SELECT
// MAX são executados via `sql.execute(trx)` (usa `trx.getExecutor()`). O executor
// falso registra o SQL compilado e resolve a 1ª chamada (advisory lock) e a 2ª
// (SELECT MAX) com o `max` configurado.
function makeTrx(options: {
  insertTemplate?: ReturnType<typeof makeInsertBuilder>
  insertAtivo?: ReturnType<typeof makeInsertBuilder>
  maxVersao?: number | null
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
      return Promise.resolve({ rows: [{ max: options.maxVersao ?? null }] })
    },
    withPlugins: () => executor,
  }

  const trx = {
    getExecutor: () => executor,
    sqlExecutado,
    insertInto: vi.fn((tabela: string) => {
      if (tabela === 'templates') return options.insertTemplate
      return options.insertAtivo
    }),
    updateTable: vi.fn(),
    deleteFrom: vi.fn(),
  }
  return trx
}

function makeDbComTransacao(trx: unknown, extras: Record<string, unknown> = {}) {
  return {
    transaction: () => ({
      execute: (cb: (t: unknown) => unknown) => cb(trx),
    }),
    ...extras,
  } as unknown as Kysely<Database>
}

describe('TemplateRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('criarTemplatePadrao()', () => {
    it('insere versao 1 com layout_json padrão quando não há templates (max null)', async () => {
      const insertTemplate = makeInsertBuilder(templateRowBase)
      const insertAtivo = makeInsertBuilder({})
      const trx = makeTrx({ insertTemplate, insertAtivo, maxVersao: null })
      const db = makeDbComTransacao(trx)

      const repo = criarTemplateRepository({ db })
      const result = await repo.criarTemplatePadrao('tenant-1')

      expect(trx.insertInto).toHaveBeenCalledWith('templates')
      expect(insertTemplate.values).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: 'tenant-1',
          versao: 1,
          layout_json: JSON.stringify(LAYOUT_PADRAO),
        }),
      )
      expect(result.versao).toBe(1)
    })

    it('grava o ponteiro de template ativo com o id da linha criada', async () => {
      const insertTemplate = makeInsertBuilder(templateRowBase)
      const insertAtivo = makeInsertBuilder({})
      const trx = makeTrx({ insertTemplate, insertAtivo, maxVersao: null })
      const db = makeDbComTransacao(trx)

      const repo = criarTemplateRepository({ db })
      await repo.criarTemplatePadrao('tenant-1')

      expect(trx.insertInto).toHaveBeenCalledWith('tenants_template_ativo')
      expect(insertAtivo.values).toHaveBeenCalledWith(
        expect.objectContaining({ tenant_id: 'tenant-1', template_id: 'template-1' }),
      )
      expect(insertAtivo.onConflict).toHaveBeenCalled()
    })

    it('retorna TemplatePublico com layoutJson mapeado (camelCase)', async () => {
      const insertTemplate = makeInsertBuilder(templateRowBase)
      const insertAtivo = makeInsertBuilder({})
      const trx = makeTrx({ insertTemplate, insertAtivo, maxVersao: null })
      const db = makeDbComTransacao(trx)

      const repo = criarTemplateRepository({ db })
      const result = await repo.criarTemplatePadrao('tenant-1')

      expect(result).toMatchObject({
        id: 'template-1',
        tenantId: 'tenant-1',
        versao: 1,
        layoutJson: LAYOUT_PADRAO,
      })
      expect(result.criadoEm).toBeInstanceOf(Date)
    })
  })

  describe('salvar()', () => {
    it('calcula versao = max + 1 e insere nova linha (append-only)', async () => {
      const novaLinha = {
        ...templateRowBase,
        id: 'template-4',
        versao: 4,
        layout_json: layoutRecebido,
      }
      const insertTemplate = makeInsertBuilder(novaLinha)
      const insertAtivo = makeInsertBuilder({})
      const trx = makeTrx({ insertTemplate, insertAtivo, maxVersao: 3 })
      const db = makeDbComTransacao(trx)

      const repo = criarTemplateRepository({ db })
      const result = await repo.salvar({ tenantId: 'tenant-1', layoutJson: layoutRecebido })

      expect(insertTemplate.values).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: 'tenant-1',
          versao: 4,
          layout_json: JSON.stringify(layoutRecebido),
        }),
      )
      expect(result.versao).toBe(4)
    })

    it('nunca sobrescreve versão existente (sem updateTable/deleteFrom em templates)', async () => {
      const insertTemplate = makeInsertBuilder({ ...templateRowBase, versao: 2 })
      const insertAtivo = makeInsertBuilder({})
      const trx = makeTrx({ insertTemplate, insertAtivo, maxVersao: 1 })
      const db = makeDbComTransacao(trx)

      const repo = criarTemplateRepository({ db })
      await repo.salvar({ tenantId: 'tenant-1', layoutJson: layoutRecebido })

      expect(trx.insertInto).toHaveBeenCalledWith('templates')
      expect(trx.updateTable).not.toHaveBeenCalled()
      expect(trx.deleteFrom).not.toHaveBeenCalled()
    })

    it('emite o advisory lock ANTES do SELECT de MAX (sem race condition)', async () => {
      const insertTemplate = makeInsertBuilder({ ...templateRowBase, versao: 2 })
      const insertAtivo = makeInsertBuilder({})
      const trx = makeTrx({ insertTemplate, insertAtivo, maxVersao: 1 })
      const db = makeDbComTransacao(trx)

      const repo = criarTemplateRepository({ db })
      await repo.salvar({ tenantId: 'tenant-1', layoutJson: layoutRecebido })

      expect(trx.sqlExecutado).toHaveLength(2)
      expect(trx.sqlExecutado[0]).toContain('pg_advisory_xact_lock')
      expect(trx.sqlExecutado[1]).toContain('MAX')
    })

    it('faz upsert do ponteiro ativo para o novo template_id', async () => {
      const novaLinha = { ...templateRowBase, id: 'template-2', versao: 2 }
      const insertTemplate = makeInsertBuilder(novaLinha)
      const insertAtivo = makeInsertBuilder({})
      const trx = makeTrx({ insertTemplate, insertAtivo, maxVersao: 1 })
      const db = makeDbComTransacao(trx)

      const repo = criarTemplateRepository({ db })
      await repo.salvar({ tenantId: 'tenant-1', layoutJson: layoutRecebido })

      expect(trx.insertInto).toHaveBeenCalledWith('tenants_template_ativo')
      expect(insertAtivo.values).toHaveBeenCalledWith(
        expect.objectContaining({ tenant_id: 'tenant-1', template_id: 'template-2' }),
      )
      expect(insertAtivo.onConflict).toHaveBeenCalled()
    })

    it('retorna TemplatePublico com a nova versao e o layoutJson recebido', async () => {
      const novaLinha = {
        ...templateRowBase,
        id: 'template-2',
        versao: 2,
        layout_json: layoutRecebido,
      }
      const insertTemplate = makeInsertBuilder(novaLinha)
      const insertAtivo = makeInsertBuilder({})
      const trx = makeTrx({ insertTemplate, insertAtivo, maxVersao: 1 })
      const db = makeDbComTransacao(trx)

      const repo = criarTemplateRepository({ db })
      const result = await repo.salvar({ tenantId: 'tenant-1', layoutJson: layoutRecebido })

      expect(result.versao).toBe(2)
      expect(result.layoutJson).toEqual(layoutRecebido)
    })
  })

  describe('buscarAtivo()', () => {
    it('retorna null quando não há ponteiro/linha ativa', async () => {
      const selectBuilder = makeSelectBuilder(undefined)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarTemplateRepository({ db })
      const result = await repo.buscarAtivo('tenant-1')

      expect(result).toBeNull()
    })

    it('retorna a versão ativa (join com tenants_template_ativo) filtrando por tenant', async () => {
      const selectBuilder = makeSelectBuilder(templateRowBase)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarTemplateRepository({ db })
      const result = await repo.buscarAtivo('tenant-1')

      expect(db.selectFrom).toHaveBeenCalledWith('tenants_template_ativo')
      expect(selectBuilder.innerJoin).toHaveBeenCalled()
      expect(selectBuilder.where).toHaveBeenCalledWith(
        'tenants_template_ativo.tenant_id',
        '=',
        'tenant-1',
      )
      expect(result?.id).toBe('template-1')
    })
  })

  describe('buscarPorId()', () => {
    it('retorna null quando a versão não existe', async () => {
      const selectBuilder = makeSelectBuilder(undefined)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarTemplateRepository({ db })
      const result = await repo.buscarPorId('tenant-1', 'inexistente')

      expect(result).toBeNull()
    })

    it('retorna a versão específica filtrando por tenant_id E id', async () => {
      const selectBuilder = makeSelectBuilder(templateRowBase)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repo = criarTemplateRepository({ db })
      const result = await repo.buscarPorId('tenant-1', 'template-1')

      expect(db.selectFrom).toHaveBeenCalledWith('templates')
      expect(selectBuilder.where).toHaveBeenCalledWith('tenant_id', '=', 'tenant-1')
      expect(selectBuilder.where).toHaveBeenCalledWith('id', '=', 'template-1')
      expect(result?.id).toBe('template-1')
    })
  })

  describe('DoD — imutabilidade/versionamento', () => {
    it('salvar após max=1 insere versao 2 e mantém a v1 recuperável por buscarPorId', async () => {
      // 1) salvar: insere versao 2 sem tocar na v1 (nenhum update/delete).
      const insertTemplate = makeInsertBuilder({ ...templateRowBase, id: 'template-2', versao: 2 })
      const insertAtivo = makeInsertBuilder({})
      const trx = makeTrx({ insertTemplate, insertAtivo, maxVersao: 1 })
      const dbSalvar = makeDbComTransacao(trx)

      const repoSalvar = criarTemplateRepository({ db: dbSalvar })
      const salvo = await repoSalvar.salvar({ tenantId: 'tenant-1', layoutJson: layoutRecebido })

      expect(salvo.versao).toBe(2)
      expect(trx.updateTable).not.toHaveBeenCalled()
      expect(trx.deleteFrom).not.toHaveBeenCalled()

      // 2) buscarPorId da v1 continua recuperável (linha v1 persiste).
      const selectBuilder = makeSelectBuilder(templateRowBase)
      const dbBusca = {
        selectFrom: vi.fn().mockReturnValue(selectBuilder),
      } as unknown as Kysely<Database>

      const repoBusca = criarTemplateRepository({ db: dbBusca })
      const v1 = await repoBusca.buscarPorId('tenant-1', 'template-1')

      expect(v1?.versao).toBe(1)
      expect(v1?.id).toBe('template-1')
    })
  })
})
