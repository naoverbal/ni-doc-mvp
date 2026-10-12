import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarOrcamentoRepository } from '../orcamento.repository.js'
import type { CriarOrcamentoInput, AtualizarOrcamentoInput } from '../orcamento.repository.js'
import { AppError } from '../../errors/app-error.js'
import type { Kysely } from 'kysely'
import type { Database } from '../../types/database.js'

// -----------------------------------------------------------------------------
// Os testes de repositório deste projeto são 100% mock-based: NÃO sobem Postgres
// nem exercitam RLS de verdade (ver cliente/responsavel.repository.test.ts). Aqui
// "isolamento de tenant" é verificado como asserção de que as queries aplicam o
// filtro `.where('tenant_id', '=', tenantId)` (e, para itens, operam via
// `orcamento_id`). A verificação ponta-a-ponta de RLS e da ausência de race na
// numeração sob concorrência fica para testes de integração (mesma convenção do
// middleware `tenant.ts`); aqui a ausência de race é garantida pelo design
// (advisory lock transacional + leitura do MAX na mesma transação).
// -----------------------------------------------------------------------------

// Builders fluentes do Kysely (encadeáveis). Cada método retorna o próprio
// builder; os terminais resolvem com o resultado mockado.
function makeInsertBuilder(result: unknown, many = false) {
  const builder = {
    values: vi.fn(),
    returning: vi.fn(),
    executeTakeFirstOrThrow: vi.fn().mockResolvedValue(result),
    execute: vi.fn().mockResolvedValue(many ? result : [result]),
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
    offset: vi.fn(),
    executeTakeFirst: vi.fn().mockResolvedValue(result),
    execute: vi.fn().mockResolvedValue(many ? result : [result]),
  }
  builder.select.mockReturnValue(builder)
  builder.where.mockReturnValue(builder)
  builder.orderBy.mockReturnValue(builder)
  builder.limit.mockReturnValue(builder)
  builder.offset.mockReturnValue(builder)
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

function makeDeleteBuilder() {
  const builder = {
    where: vi.fn(),
    execute: vi.fn().mockResolvedValue([]),
  }
  builder.where.mockReturnValue(builder)
  return builder
}

// -----------------------------------------------------------------------------
// Linhas de banco (snake_case; NUMERIC como string do driver pg).
// -----------------------------------------------------------------------------
const orcamentoRowBase = {
  id: 'orc-1',
  tenant_id: 'tenant-1',
  numero: 'ORC-2026-0001',
  cliente_id: 'cliente-1',
  empresa_cliente_id: null,
  usuario_id: 'usuario-1',
  titulo: 'Proposta A',
  descricao: null,
  status: 'rascunho' as const,
  data_emissao: new Date('2026-01-10'),
  validade_dias: 30,
  desconto_global_tipo: null,
  desconto_global_valor: null,
  subtotal: '100.00',
  total: '100.00',
  versao_atual: 0,
  observacoes: null,
  condicoes_pagamento: null,
  prazo_entrega_dias: null,
  criado_em: new Date('2026-01-10'),
  atualizado_em: new Date('2026-01-10'),
}

const condicaoRowBase = {
  id: 'cond-1',
  orcamento_id: 'orc-1',
  ordem: 1,
  descricao: 'Entrada',
  percentual: '100.00',
  marco: null,
  forma_pagamento: 'PIX',
}

const itemRowBase = {
  id: 'item-1',
  orcamento_id: 'orc-1',
  ordem: 1,
  nome: 'Serviço X',
  descricao: null,
  quantidade: '2.0000',
  unidade: 'un',
  valor_unitario: '50.00',
  desconto_tipo: null,
  desconto_valor: null,
  total: '100.00',
  responsavel_id: null,
}

const criarInputBase: CriarOrcamentoInput = {
  tenantId: 'tenant-1',
  clienteId: 'cliente-1',
  usuarioId: 'usuario-1',
  titulo: 'Proposta A',
  itens: [{ nome: 'Serviço X', quantidade: 2, valorUnitario: 50 }],
}

// Monta um mock de transação. `cb` recebe o `trx`. As queries de SQL cru
// (advisory lock + MAX) são executadas via `sql.execute(trx)`, que usa
// `trx.getExecutor()`. O executor falso abaixo registra, em ordem, o SQL
// compilado e resolve a 1ª chamada (advisory lock) e a 2ª (SELECT MAX).
function makeTrx(options: {
  insertOrcamento?: ReturnType<typeof makeInsertBuilder>
  insertItens?: ReturnType<typeof makeInsertBuilder>
  insertCondicoes?: ReturnType<typeof makeInsertBuilder>
  updateOrcamento?: ReturnType<typeof makeUpdateBuilder>
  deleteItens?: ReturnType<typeof makeDeleteBuilder>
  deleteCondicoes?: ReturnType<typeof makeDeleteBuilder>
  // Condições relidas quando o update NÃO envia `condicoesPagamento`.
  selectCondicoes?: ReturnType<typeof makeSelectBuilder>
  maxSeq?: number | null
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
      return Promise.resolve({ rows: [{ max: options.maxSeq ?? null }] })
    },
    withPlugins: () => executor,
  }

  const trx = {
    getExecutor: () => executor,
    sqlExecutado,
    insertInto: vi.fn((tabela: string) => {
      if (tabela === 'orcamentos') return options.insertOrcamento
      if (tabela === 'orcamento_condicoes_pagamento') return options.insertCondicoes
      return options.insertItens
    }),
    updateTable: vi.fn().mockReturnValue(options.updateOrcamento),
    deleteFrom: vi.fn((tabela: string) => {
      if (tabela === 'orcamento_condicoes_pagamento') return options.deleteCondicoes
      return options.deleteItens
    }),
    selectFrom: vi.fn().mockReturnValue(options.selectCondicoes),
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

describe('OrcamentoRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('criar()', () => {
    it('insere orçamento + itens dentro de uma transação atômica', async () => {
      const insertOrcamento = makeInsertBuilder(orcamentoRowBase)
      const insertItens = makeInsertBuilder([itemRowBase], true)
      const trx = makeTrx({ insertOrcamento, insertItens, maxSeq: null })
      const transactionSpy = vi.fn(() => ({
        execute: (cb: (t: unknown) => unknown) => cb(trx),
      }))
      const db = { transaction: transactionSpy } as unknown as Kysely<Database>

      const repo = criarOrcamentoRepository({ db })
      await repo.criar(criarInputBase)

      expect(transactionSpy).toHaveBeenCalled()
      expect(trx.insertInto).toHaveBeenCalledWith('orcamentos')
      expect(trx.insertInto).toHaveBeenCalledWith('orcamento_itens')
    })

    it('gera numero ORC-{ANO}-0001 quando não há orçamentos no ano (MAX null)', async () => {
      const ano = new Date().getFullYear()
      const insertOrcamento = makeInsertBuilder({ ...orcamentoRowBase, numero: `ORC-${ano}-0001` })
      const insertItens = makeInsertBuilder([itemRowBase], true)
      const trx = makeTrx({ insertOrcamento, insertItens, maxSeq: null })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoRepository({ db })
      await repo.criar(criarInputBase)

      expect(insertOrcamento.values).toHaveBeenCalledWith(
        expect.objectContaining({ numero: `ORC-${ano}-0001` }),
      )
    })

    it('gera numero ORC-{ANO}-0043 quando o MAX existente é 42', async () => {
      const ano = new Date().getFullYear()
      const insertOrcamento = makeInsertBuilder(orcamentoRowBase)
      const insertItens = makeInsertBuilder([itemRowBase], true)
      const trx = makeTrx({ insertOrcamento, insertItens, maxSeq: 42 })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoRepository({ db })
      await repo.criar(criarInputBase)

      expect(insertOrcamento.values).toHaveBeenCalledWith(
        expect.objectContaining({ numero: `ORC-${ano}-0043` }),
      )
    })

    it('emite o advisory lock ANTES do SELECT de MAX (sem race condition)', async () => {
      const insertOrcamento = makeInsertBuilder(orcamentoRowBase)
      const insertItens = makeInsertBuilder([itemRowBase], true)
      const trx = makeTrx({ insertOrcamento, insertItens, maxSeq: null })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoRepository({ db })
      await repo.criar(criarInputBase)

      // Dois SQLs crus, na ordem: advisory lock, depois SELECT MAX.
      expect(trx.sqlExecutado).toHaveLength(2)
      expect(trx.sqlExecutado[0]).toContain('pg_advisory_xact_lock')
      expect(trx.sqlExecutado[1]).toContain('MAX')
    })

    it('insere status rascunho e ordem 1-based pela posição no array', async () => {
      const insertOrcamento = makeInsertBuilder(orcamentoRowBase)
      const insertItens = makeInsertBuilder([itemRowBase], true)
      const trx = makeTrx({ insertOrcamento, insertItens, maxSeq: null })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoRepository({ db })
      await repo.criar({
        ...criarInputBase,
        itens: [
          { nome: 'Primeiro', quantidade: 1, valorUnitario: 10 },
          { nome: 'Segundo', quantidade: 1, valorUnitario: 20 },
        ],
      })

      expect(insertOrcamento.values).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'rascunho' }),
      )
      expect(insertItens.values).toHaveBeenCalledWith([
        expect.objectContaining({ nome: 'Primeiro', ordem: 1 }),
        expect.objectContaining({ nome: 'Segundo', ordem: 2 }),
      ])
    })

    it('calcula subtotal e total via orcamento-calculo', async () => {
      const insertOrcamento = makeInsertBuilder(orcamentoRowBase)
      const insertItens = makeInsertBuilder([itemRowBase], true)
      const trx = makeTrx({ insertOrcamento, insertItens, maxSeq: null })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoRepository({ db })
      await repo.criar({
        ...criarInputBase,
        // 2 * 50 = 100 (subtotal); desconto global fixo 10 => total 90
        itens: [{ nome: 'Serviço X', quantidade: 2, valorUnitario: 50 }],
        descontoGlobalTipo: 'fixo',
        descontoGlobalValor: 10,
      })

      expect(insertOrcamento.values).toHaveBeenCalledWith(
        expect.objectContaining({ subtotal: '100', total: '90' }),
      )
    })

    it('retorna OrcamentoComItens com NUMERIC convertido para number', async () => {
      const insertOrcamento = makeInsertBuilder(orcamentoRowBase)
      const insertItens = makeInsertBuilder([itemRowBase], true)
      const trx = makeTrx({ insertOrcamento, insertItens, maxSeq: null })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoRepository({ db })
      const result = await repo.criar(criarInputBase)

      expect(result.subtotal).toBe(100)
      expect(result.total).toBe(100)
      expect(result.itens).toHaveLength(1)
      expect(result.itens[0]?.quantidade).toBe(2)
      expect(result.itens[0]?.valorUnitario).toBe(50)
      expect(result.itens[0]?.total).toBe(100)
    })
  })

  describe('condições de pagamento e prazo de entrega (RF-005/RF-007)', () => {
    it('persiste prazo_entrega_dias e condições com ordem 1-based na criação', async () => {
      const insertOrcamento = makeInsertBuilder(orcamentoRowBase)
      const insertItens = makeInsertBuilder([itemRowBase], true)
      const insertCondicoes = makeInsertBuilder([condicaoRowBase], true)
      const trx = makeTrx({ insertOrcamento, insertItens, insertCondicoes, maxSeq: null })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoRepository({ db })
      await repo.criar({
        ...criarInputBase,
        prazoEntregaDias: 15,
        condicoesPagamento: [
          { descricao: 'Entrada', percentual: 40, formaPagamento: 'PIX' },
          { descricao: 'Saldo', percentual: 60, marco: 'Na entrega', formaPagamento: 'Boleto' },
        ],
      })

      expect(insertOrcamento.values).toHaveBeenCalledWith(
        expect.objectContaining({ prazo_entrega_dias: 15 }),
      )
      expect(trx.insertInto).toHaveBeenCalledWith('orcamento_condicoes_pagamento')
      expect(insertCondicoes.values).toHaveBeenCalledWith([
        expect.objectContaining({
          ordem: 1,
          descricao: 'Entrada',
          percentual: '40',
          marco: null,
          forma_pagamento: 'PIX',
        }),
        expect.objectContaining({
          ordem: 2,
          descricao: 'Saldo',
          percentual: '60',
          marco: 'Na entrega',
          forma_pagamento: 'Boleto',
        }),
      ])
    })

    it('não insere condições quando a lista está vazia', async () => {
      const insertOrcamento = makeInsertBuilder(orcamentoRowBase)
      const insertItens = makeInsertBuilder([itemRowBase], true)
      const insertCondicoes = makeInsertBuilder([], true)
      const trx = makeTrx({ insertOrcamento, insertItens, insertCondicoes, maxSeq: null })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoRepository({ db })
      await repo.criar({ ...criarInputBase, condicoesPagamento: [] })

      expect(trx.insertInto).not.toHaveBeenCalledWith('orcamento_condicoes_pagamento')
    })

    it('SUBSTITUI as condições no update (apaga por orcamento_id e reinsere)', async () => {
      const updateOrcamento = makeUpdateBuilder(orcamentoRowBase)
      const insertItens = makeInsertBuilder([itemRowBase], true)
      const insertCondicoes = makeInsertBuilder([condicaoRowBase], true)
      const deleteItens = makeDeleteBuilder()
      const deleteCondicoes = makeDeleteBuilder()
      const trx = makeTrx({
        updateOrcamento,
        insertItens,
        insertCondicoes,
        deleteItens,
        deleteCondicoes,
      })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoRepository({ db })
      await repo.atualizar('tenant-1', 'orc-1', {
        itens: [{ nome: 'A', quantidade: 1, valorUnitario: 10 }],
        condicoesPagamento: [{ descricao: 'À vista', percentual: 100, formaPagamento: 'PIX' }],
      })

      expect(trx.deleteFrom).toHaveBeenCalledWith('orcamento_condicoes_pagamento')
      expect(deleteCondicoes.where).toHaveBeenCalledWith('orcamento_id', '=', 'orc-1')
      expect(trx.insertInto).toHaveBeenCalledWith('orcamento_condicoes_pagamento')
      expect(insertCondicoes.values).toHaveBeenCalledWith([
        expect.objectContaining({ ordem: 1, percentual: '100', forma_pagamento: 'PIX' }),
      ])
    })

    it('mantém as condições atuais no update quando o campo é omitido', async () => {
      const updateOrcamento = makeUpdateBuilder(orcamentoRowBase)
      const insertItens = makeInsertBuilder([itemRowBase], true)
      const deleteItens = makeDeleteBuilder()
      const deleteCondicoes = makeDeleteBuilder()
      const selectCondicoes = makeSelectBuilder([condicaoRowBase], true)
      const trx = makeTrx({
        updateOrcamento,
        insertItens,
        deleteItens,
        deleteCondicoes,
        selectCondicoes,
      })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoRepository({ db })
      const result = await repo.atualizar('tenant-1', 'orc-1', {
        titulo: 'Só título',
        itens: [{ nome: 'A', quantidade: 1, valorUnitario: 10 }],
      })

      // Não apaga nem reinsere condições; relê as existentes.
      expect(trx.deleteFrom).not.toHaveBeenCalledWith('orcamento_condicoes_pagamento')
      expect(result?.condicoesPagamento).toHaveLength(1)
      expect(result?.condicoesPagamento[0]?.descricao).toBe('Entrada')
    })

    it('atualiza prazo_entrega_dias quando informado', async () => {
      const updateOrcamento = makeUpdateBuilder(orcamentoRowBase)
      const insertItens = makeInsertBuilder([itemRowBase], true)
      const deleteItens = makeDeleteBuilder()
      const deleteCondicoes = makeDeleteBuilder()
      const insertCondicoes = makeInsertBuilder([], true)
      const trx = makeTrx({
        updateOrcamento,
        insertItens,
        deleteItens,
        deleteCondicoes,
        insertCondicoes,
      })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoRepository({ db })
      await repo.atualizar('tenant-1', 'orc-1', {
        prazoEntregaDias: 7,
        itens: [{ nome: 'A', quantidade: 1, valorUnitario: 10 }],
        condicoesPagamento: [],
      })

      expect(updateOrcamento.set).toHaveBeenCalledWith(
        expect.objectContaining({ prazo_entrega_dias: 7 }),
      )
    })
  })

  describe('buscarPorId()', () => {
    it('retorna null quando o orçamento não existe', async () => {
      const selectOrcamento = makeSelectBuilder(undefined)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectOrcamento),
      } as unknown as Kysely<Database>

      const repo = criarOrcamentoRepository({ db })
      const result = await repo.buscarPorId('tenant-1', 'inexistente')

      expect(result).toBeNull()
    })

    it('retorna o orçamento COM itens e condições ordenados por ordem ASC e filtra por tenant', async () => {
      const selectOrcamento = makeSelectBuilder(orcamentoRowBase)
      const selectItens = makeSelectBuilder([itemRowBase], true)
      const selectCondicoes = makeSelectBuilder([condicaoRowBase], true)
      const selectFrom = vi.fn((tabela: string) => {
        if (tabela === 'orcamentos') return selectOrcamento
        if (tabela === 'orcamento_condicoes_pagamento') return selectCondicoes
        return selectItens
      })
      const db = { selectFrom } as unknown as Kysely<Database>

      const repo = criarOrcamentoRepository({ db })
      const result = await repo.buscarPorId('tenant-1', 'orc-1')

      expect(selectOrcamento.where).toHaveBeenCalledWith('tenant_id', '=', 'tenant-1')
      expect(selectItens.orderBy).toHaveBeenCalledWith('ordem', 'asc')
      expect(selectCondicoes.orderBy).toHaveBeenCalledWith('ordem', 'asc')
      expect(result?.itens).toHaveLength(1)
      expect(result?.itens[0]?.total).toBe(100)
      // Condições estruturadas mapeadas (NUMERIC string → number).
      expect(result?.condicoesPagamento).toHaveLength(1)
      expect(result?.condicoesPagamento[0]?.percentual).toBe(100)
      expect(result?.condicoesPagamento[0]?.formaPagamento).toBe('PIX')
      expect(result?.prazoEntregaDias).toBeNull()
    })
  })

  describe('atualizar()', () => {
    it('retorna null quando o orçamento não existe para o tenant', async () => {
      const updateOrcamento = makeUpdateBuilder(undefined)
      const deleteItens = makeDeleteBuilder()
      const trx = makeTrx({ updateOrcamento, deleteItens })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoRepository({ db })
      const dados: AtualizarOrcamentoInput = {
        titulo: 'Novo',
        itens: [{ nome: 'A', quantidade: 1, valorUnitario: 10 }],
      }
      const result = await repo.atualizar('tenant-1', 'inexistente', dados)

      expect(result).toBeNull()
    })

    it('ocorre em transação, substitui itens e atualiza campos do orçamento', async () => {
      const updateOrcamento = makeUpdateBuilder(orcamentoRowBase)
      const insertItens = makeInsertBuilder([itemRowBase], true)
      const deleteItens = makeDeleteBuilder()
      const selectCondicoes = makeSelectBuilder([], true)
      const trx = makeTrx({ updateOrcamento, insertItens, deleteItens, selectCondicoes })
      const transactionSpy = vi.fn(() => ({
        execute: (cb: (t: unknown) => unknown) => cb(trx),
      }))
      const db = { transaction: transactionSpy } as unknown as Kysely<Database>

      const repo = criarOrcamentoRepository({ db })
      const dados: AtualizarOrcamentoInput = {
        titulo: 'Proposta Revisada',
        itens: [{ nome: 'A', quantidade: 1, valorUnitario: 10 }],
      }
      await repo.atualizar('tenant-1', 'orc-1', dados)

      expect(transactionSpy).toHaveBeenCalled()
      expect(trx.updateTable).toHaveBeenCalledWith('orcamentos')
      expect(updateOrcamento.set).toHaveBeenCalledWith(
        expect.objectContaining({ titulo: 'Proposta Revisada' }),
      )
      expect(updateOrcamento.where).toHaveBeenCalledWith('tenant_id', '=', 'tenant-1')
      // SUBSTITUI: apaga itens antigos por orcamento_id e reinsere.
      expect(trx.deleteFrom).toHaveBeenCalledWith('orcamento_itens')
      expect(deleteItens.where).toHaveBeenCalledWith('orcamento_id', '=', 'orc-1')
      expect(trx.insertInto).toHaveBeenCalledWith('orcamento_itens')
    })

    it('recalcula subtotal e total no update', async () => {
      const updateOrcamento = makeUpdateBuilder(orcamentoRowBase)
      const insertItens = makeInsertBuilder([itemRowBase], true)
      const deleteItens = makeDeleteBuilder()
      const selectCondicoes = makeSelectBuilder([], true)
      const trx = makeTrx({ updateOrcamento, insertItens, deleteItens, selectCondicoes })
      const db = makeDbComTransacao(trx)

      const repo = criarOrcamentoRepository({ db })
      await repo.atualizar('tenant-1', 'orc-1', {
        itens: [{ nome: 'A', quantidade: 3, valorUnitario: 10 }],
        descontoGlobalTipo: 'percentual',
        descontoGlobalValor: 10,
      })

      // subtotal 30; desconto 10% => total 27
      expect(updateOrcamento.set).toHaveBeenCalledWith(
        expect.objectContaining({ subtotal: '30', total: '27' }),
      )
    })
  })

  describe('listarPorTenant()', () => {
    function makeListaDb(options: { lista: unknown[]; total: string }) {
      const listaBuilder = makeSelectBuilder(options.lista, true)
      const countBuilder = makeSelectBuilder({ total: options.total })
      const selectFrom = vi.fn().mockReturnValueOnce(listaBuilder).mockReturnValueOnce(countBuilder)
      const db = { selectFrom } as unknown as Kysely<Database>
      return { db, listaBuilder, countBuilder }
    }

    it('filtra por tenant e retorna paginação com total', async () => {
      const { db, listaBuilder } = makeListaDb({ lista: [orcamentoRowBase], total: '5' })

      const repo = criarOrcamentoRepository({ db })
      const result = await repo.listarPorTenant('tenant-1')

      expect(listaBuilder.where).toHaveBeenCalledWith('tenant_id', '=', 'tenant-1')
      expect(result.total).toBe(5)
      expect(result.pagina).toBe(1)
      expect(result.tamanhoPagina).toBe(20)
      expect(result.itens).toHaveLength(1)
      // Lista enxuta: resumo não carrega o array de itens.
      expect(result.itens[0]).not.toHaveProperty('itens')
    })

    it('aplica filtro de status apenas quando informado', async () => {
      const { db, listaBuilder, countBuilder } = makeListaDb({
        lista: [orcamentoRowBase],
        total: '1',
      })

      const repo = criarOrcamentoRepository({ db })
      await repo.listarPorTenant('tenant-1', { status: 'enviado' })

      expect(listaBuilder.where).toHaveBeenCalledWith('status', '=', 'enviado')
      expect(countBuilder.where).toHaveBeenCalledWith('status', '=', 'enviado')
    })

    it('aplica limit/offset corretos para a página 2 (tamanho 20 => offset 20)', async () => {
      const { db, listaBuilder } = makeListaDb({ lista: [], total: '0' })

      const repo = criarOrcamentoRepository({ db })
      await repo.listarPorTenant('tenant-1', { pagina: 2, tamanhoPagina: 20 })

      expect(listaBuilder.limit).toHaveBeenCalledWith(20)
      expect(listaBuilder.offset).toHaveBeenCalledWith(20)
      expect(listaBuilder.orderBy).toHaveBeenCalledWith('criado_em', 'desc')
    })
  })

  describe('deletar()', () => {
    it('deleta quando status é rascunho, filtrando por tenant+id', async () => {
      const selectStatus = makeSelectBuilder({ status: 'rascunho' })
      const deleteBuilder = makeDeleteBuilder()
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectStatus),
        deleteFrom: vi.fn().mockReturnValue(deleteBuilder),
      } as unknown as Kysely<Database>

      const repo = criarOrcamentoRepository({ db })
      await repo.deletar('tenant-1', 'orc-1')

      expect(db.deleteFrom).toHaveBeenCalledWith('orcamentos')
      expect(deleteBuilder.where).toHaveBeenCalledWith('tenant_id', '=', 'tenant-1')
      expect(deleteBuilder.where).toHaveBeenCalledWith('id', '=', 'orc-1')
    })

    it('lança AppError(409) quando o status não é rascunho', async () => {
      const selectStatus = makeSelectBuilder({ status: 'enviado' })
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectStatus),
        deleteFrom: vi.fn(),
      } as unknown as Kysely<Database>

      const repo = criarOrcamentoRepository({ db })
      await expect(repo.deletar('tenant-1', 'orc-1')).rejects.toBeInstanceOf(AppError)
      await expect(repo.deletar('tenant-1', 'orc-1')).rejects.toMatchObject({ statusCode: 409 })
      expect(db.deleteFrom).not.toHaveBeenCalled()
    })

    it('lança AppError(404) quando o orçamento não existe para o tenant', async () => {
      const selectStatus = makeSelectBuilder(undefined)
      const db = {
        selectFrom: vi.fn().mockReturnValue(selectStatus),
        deleteFrom: vi.fn(),
      } as unknown as Kysely<Database>

      const repo = criarOrcamentoRepository({ db })
      await expect(repo.deletar('tenant-1', 'inexistente')).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })
})
