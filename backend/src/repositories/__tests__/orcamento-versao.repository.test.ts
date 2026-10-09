import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarOrcamentoVersaoRepository } from '../orcamento-versao.repository.js'
import type { CriarVersaoEnviarInput } from '../orcamento-versao.repository.js'
import { AppError } from '../../errors/app-error.js'
import { validarTokenPublico } from '../../lib/token.js'
import type { Kysely } from 'kysely'
import type { Database } from '../../types/database.js'

// -----------------------------------------------------------------------------
// Testes 100% mock-based (mesma convenção de orcamento.repository.test.ts): não
// sobe Postgres. "Isolamento de tenant" e versionamento sequencial são
// asserções sobre as queries montadas e sobre a ordem dos SQLs crus executados
// na transação (advisory lock + SELECT MAX). A rede de segurança real
// (UNIQUE (orcamento_id, versao)) é verificada em integração.
// -----------------------------------------------------------------------------

// Builders fluentes do Kysely.
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

function makeDeleteBuilder() {
  const builder = {
    where: vi.fn(),
    execute: vi.fn().mockResolvedValue([]),
  }
  builder.where.mockReturnValue(builder)
  return builder
}

// Linha retornada pelo insert em orcamento_versoes (snake_case). O `id` e o
// `token_publico` são definidos pelo repositório; aqui refletimos o que o insert
// receberia, reaproveitando os valores capturados pelo mock no próprio teste.
function versaoRowBase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'versao-row-id',
    orcamento_id: 'orc-1',
    versao: 1,
    template_id: 'template-1',
    pdf_path: null,
    pdf_hash: null,
    token_publico: 'uuid.hmac',
    enviado_em: new Date('2026-01-10'),
    expira_em: null,
    ...overrides,
  }
}

const inputBase: CriarVersaoEnviarInput = {
  tenantId: 'tenant-1',
  orcamentoId: 'orc-1',
  numero: 'ORC-2026-0001',
  snapshot: { cliente: { id: 'cliente-1' }, itens: [] },
  expiraEm: null,
}

// Monta um mock de transação. Os SQLs crus (advisory lock, SELECT MAX, SELECT
// template_id) são executados via `sql.execute(trx)` → `trx.getExecutor()`. O
// executor falso registra a ordem e resolve cada chamada por índice.
function makeTrx(options: {
  insertVersao: ReturnType<typeof makeInsertBuilder>
  updateOrcamento: ReturnType<typeof makeUpdateBuilder>
  deleteAceites: ReturnType<typeof makeDeleteBuilder>
  maxVersao?: number | null
  templateId?: string | null
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
      // 1ª: advisory lock → sem linhas úteis.
      if (sqlExecutado.length === 1) return Promise.resolve({ rows: [{}] })
      // 2ª: SELECT MAX(versao).
      if (sqlExecutado.length === 2) {
        return Promise.resolve({ rows: [{ max: options.maxVersao ?? null }] })
      }
      // 3ª: SELECT template_id ativo.
      const templateId = options.templateId === undefined ? 'template-1' : options.templateId
      if (templateId === null) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [{ template_id: templateId }] })
    },
    withPlugins: () => executor,
  }

  const trx = {
    getExecutor: () => executor,
    sqlExecutado,
    insertInto: vi.fn().mockReturnValue(options.insertVersao),
    updateTable: vi.fn().mockReturnValue(options.updateOrcamento),
    deleteFrom: vi.fn().mockReturnValue(options.deleteAceites),
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

describe('OrcamentoVersaoRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cria a versão 1 no primeiro envio (MAX null) e marca o orçamento como enviado', async () => {
    const insertVersao = makeInsertBuilder(versaoRowBase({ versao: 1 }))
    const updateOrcamento = makeUpdateBuilder()
    const deleteAceites = makeDeleteBuilder()
    const trx = makeTrx({ insertVersao, updateOrcamento, deleteAceites, maxVersao: null })
    const transactionSpy = vi.fn(() => ({
      execute: (cb: (t: unknown) => unknown) => cb(trx),
    }))
    const db = { transaction: transactionSpy } as unknown as Kysely<Database>

    const repo = criarOrcamentoVersaoRepository({ db })
    const versao = await repo.criarVersaoEnviar(inputBase)

    expect(transactionSpy).toHaveBeenCalled()
    expect(trx.insertInto).toHaveBeenCalledWith('orcamento_versoes')
    expect(insertVersao.values).toHaveBeenCalledWith(expect.objectContaining({ versao: 1 }))
    expect(trx.updateTable).toHaveBeenCalledWith('orcamentos')
    expect(updateOrcamento.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'enviado', versao_atual: 1 }),
    )
    expect(versao.versao).toBe(1)
  })

  it('cria a versão N+1 em envios subsequentes (MAX 3 => versao 4)', async () => {
    const insertVersao = makeInsertBuilder(versaoRowBase({ versao: 4 }))
    const updateOrcamento = makeUpdateBuilder()
    const deleteAceites = makeDeleteBuilder()
    const trx = makeTrx({ insertVersao, updateOrcamento, deleteAceites, maxVersao: 3 })
    const db = makeDbComTransacao(trx)

    const repo = criarOrcamentoVersaoRepository({ db })
    await repo.criarVersaoEnviar(inputBase)

    expect(insertVersao.values).toHaveBeenCalledWith(expect.objectContaining({ versao: 4 }))
    expect(updateOrcamento.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'enviado', versao_atual: 4 }),
    )
  })

  it('gera um token público único e válido para o id da versão inserida', async () => {
    const insertVersao = makeInsertBuilder(versaoRowBase())
    const updateOrcamento = makeUpdateBuilder()
    const deleteAceites = makeDeleteBuilder()
    const trx = makeTrx({ insertVersao, updateOrcamento, deleteAceites, maxVersao: null })
    const db = makeDbComTransacao(trx)

    const repo = criarOrcamentoVersaoRepository({ db })
    await repo.criarVersaoEnviar(inputBase)

    const valoresInseridos = insertVersao.values.mock.calls[0]?.[0] as {
      id: string
      token_publico: string
    }
    expect(valoresInseridos.token_publico).toMatch(/^[0-9a-f-]+\.[0-9a-f]+$/)
    expect(validarTokenPublico(valoresInseridos.token_publico, valoresInseridos.id)).toBe(true)
  })

  it('resolve o template ativo do tenant e usa no insert', async () => {
    const insertVersao = makeInsertBuilder(versaoRowBase({ template_id: 'template-ativo' }))
    const updateOrcamento = makeUpdateBuilder()
    const deleteAceites = makeDeleteBuilder()
    const trx = makeTrx({
      insertVersao,
      updateOrcamento,
      deleteAceites,
      maxVersao: null,
      templateId: 'template-ativo',
    })
    const db = makeDbComTransacao(trx)

    const repo = criarOrcamentoVersaoRepository({ db })
    await repo.criarVersaoEnviar(inputBase)

    expect(insertVersao.values).toHaveBeenCalledWith(
      expect.objectContaining({ template_id: 'template-ativo' }),
    )
  })

  it('lança AppError(409) quando o tenant não possui template ativo', async () => {
    const insertVersao = makeInsertBuilder(versaoRowBase())
    const updateOrcamento = makeUpdateBuilder()
    const deleteAceites = makeDeleteBuilder()
    const trx = makeTrx({
      insertVersao,
      updateOrcamento,
      deleteAceites,
      maxVersao: null,
      templateId: null,
    })
    const db = makeDbComTransacao(trx)

    const repo = criarOrcamentoVersaoRepository({ db })
    await expect(repo.criarVersaoEnviar(inputBase)).rejects.toBeInstanceOf(AppError)
    await expect(repo.criarVersaoEnviar(inputBase)).rejects.toMatchObject({ statusCode: 409 })
    expect(insertVersao.values).not.toHaveBeenCalled()
  })

  it('invalida o aceite anterior removendo aceites das versões do orçamento', async () => {
    const insertVersao = makeInsertBuilder(versaoRowBase())
    const updateOrcamento = makeUpdateBuilder()
    const deleteAceites = makeDeleteBuilder()
    const trx = makeTrx({ insertVersao, updateOrcamento, deleteAceites, maxVersao: 1 })
    const db = makeDbComTransacao(trx)

    const repo = criarOrcamentoVersaoRepository({ db })
    await repo.criarVersaoEnviar(inputBase)

    expect(trx.deleteFrom).toHaveBeenCalledWith('orcamento_aceites')
    expect(deleteAceites.where).toHaveBeenCalled()
  })

  it('insere pdf_path e pdf_hash nulos quando não há callback de geração de PDF', async () => {
    const insertVersao = makeInsertBuilder(versaoRowBase())
    const updateOrcamento = makeUpdateBuilder()
    const deleteAceites = makeDeleteBuilder()
    const trx = makeTrx({ insertVersao, updateOrcamento, deleteAceites, maxVersao: null })
    const db = makeDbComTransacao(trx)

    const repo = criarOrcamentoVersaoRepository({ db })
    await repo.criarVersaoEnviar(inputBase)

    expect(insertVersao.values).toHaveBeenCalledWith(
      expect.objectContaining({ pdf_path: null, pdf_hash: null }),
    )
  })

  it('invoca gerarPdfDaVersao na transação e persiste pdf_path/pdf_hash no insert', async () => {
    const insertVersao = makeInsertBuilder(
      versaoRowBase({ pdf_path: '/pdfs/ORC-2026-0001-v1.pdf', pdf_hash: 'abc123' }),
    )
    const updateOrcamento = makeUpdateBuilder()
    const deleteAceites = makeDeleteBuilder()
    const trx = makeTrx({
      insertVersao,
      updateOrcamento,
      deleteAceites,
      maxVersao: null,
      templateId: 'template-ativo',
    })
    const db = makeDbComTransacao(trx)

    const gerarPdfDaVersao = vi
      .fn()
      .mockResolvedValue({ pdfPath: '/pdfs/ORC-2026-0001-v1.pdf', pdfHash: 'abc123' })

    const repo = criarOrcamentoVersaoRepository({ db })
    await repo.criarVersaoEnviar({ ...inputBase, gerarPdfDaVersao })

    // O callback recebe os dados resolvidos dentro da transação.
    expect(gerarPdfDaVersao).toHaveBeenCalledWith(
      expect.objectContaining({
        versao: 1,
        numero: 'ORC-2026-0001',
        templateId: 'template-ativo',
        tokenPublico: expect.any(String),
      }),
    )
    // O retorno popula pdf_path/pdf_hash no mesmo insert.
    expect(insertVersao.values).toHaveBeenCalledWith(
      expect.objectContaining({ pdf_path: '/pdfs/ORC-2026-0001-v1.pdf', pdf_hash: 'abc123' }),
    )
  })

  it('propaga erro do gerarPdfDaVersao e não executa o insert da versão (rollback)', async () => {
    const insertVersao = makeInsertBuilder(versaoRowBase())
    const updateOrcamento = makeUpdateBuilder()
    const deleteAceites = makeDeleteBuilder()
    const trx = makeTrx({ insertVersao, updateOrcamento, deleteAceites, maxVersao: null })
    const db = makeDbComTransacao(trx)

    const gerarPdfDaVersao = vi.fn().mockRejectedValue(new AppError(500, 'falha ao gerar PDF'))

    const repo = criarOrcamentoVersaoRepository({ db })
    await expect(
      repo.criarVersaoEnviar({ ...inputBase, gerarPdfDaVersao }),
    ).rejects.toMatchObject({ statusCode: 500 })

    expect(insertVersao.values).not.toHaveBeenCalled()
    expect(updateOrcamento.set).not.toHaveBeenCalled()
  })

  it('emite o advisory lock ANTES do SELECT MAX (sem race condition)', async () => {
    const insertVersao = makeInsertBuilder(versaoRowBase())
    const updateOrcamento = makeUpdateBuilder()
    const deleteAceites = makeDeleteBuilder()
    const trx = makeTrx({ insertVersao, updateOrcamento, deleteAceites, maxVersao: null })
    const db = makeDbComTransacao(trx)

    const repo = criarOrcamentoVersaoRepository({ db })
    await repo.criarVersaoEnviar(inputBase)

    expect(trx.sqlExecutado[0]).toContain('pg_advisory_xact_lock')
    expect(trx.sqlExecutado[1]).toContain('MAX')
  })

  it('mapeia a linha retornada para OrcamentoVersaoPublica (camelCase)', async () => {
    const insertVersao = makeInsertBuilder(
      versaoRowBase({ id: 'v-9', orcamento_id: 'orc-1', versao: 2, template_id: 'template-7' }),
    )
    const updateOrcamento = makeUpdateBuilder()
    const deleteAceites = makeDeleteBuilder()
    const trx = makeTrx({ insertVersao, updateOrcamento, deleteAceites, maxVersao: 1 })
    const db = makeDbComTransacao(trx)

    const repo = criarOrcamentoVersaoRepository({ db })
    const versao = await repo.criarVersaoEnviar(inputBase)

    expect(versao.id).toBe('v-9')
    expect(versao.orcamentoId).toBe('orc-1')
    expect(versao.versao).toBe(2)
    expect(versao.templateId).toBe('template-7')
    expect(versao.pdfPath).toBeNull()
    expect(versao.pdfHash).toBeNull()
  })
})
