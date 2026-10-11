import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'
import type { Database } from '../types/database.js'
import { AppError } from '../errors/app-error.js'
import { calcularSubtotal, calcularTotal, calcularTotalItem } from '../lib/orcamento-calculo.js'

// -----------------------------------------------------------------------------
// Tipos de status do orçamento (espelha o CHECK da migration 001).
// -----------------------------------------------------------------------------
export const STATUS_ORCAMENTO = [
  'rascunho',
  'enviado',
  'aprovado',
  'reprovado',
  'expirado',
  'cancelado',
] as const

export type OrcamentoStatus = (typeof STATUS_ORCAMENTO)[number]

export type DescontoTipo = 'percentual' | 'fixo'

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------
export interface CriarOrcamentoItemInput {
  nome: string
  descricao?: string
  quantidade: number
  unidade?: string // default 'un' aplicado no insert
  valorUnitario: number
  descontoTipo?: DescontoTipo
  descontoValor?: number
  responsavelId?: string
  // 'ordem' é atribuída pelo repositório pela posição no array (1-based).
}

// Condição de pagamento estruturada (RF-005/RF-007). A `ordem` 1-based é
// atribuída pelo repositório pela posição no array (como os itens).
export interface CriarOrcamentoCondicaoPagamentoInput {
  descricao: string
  percentual: number
  marco?: string
  formaPagamento: string
}

export interface CriarOrcamentoInput {
  tenantId: string
  clienteId: string
  empresaClienteId?: string
  usuarioId: string
  titulo: string
  descricao?: string
  validadeDias?: number // default 30
  prazoEntregaDias?: number
  descontoGlobalTipo?: DescontoTipo
  descontoGlobalValor?: number
  observacoes?: string
  // Texto livre legado (coluna `condicoes_pagamento`), mantido só para o
  // pipeline de snapshot/PDF. A entrada estruturada é `condicoesPagamento`.
  condicoesPagamentoTexto?: string
  condicoesPagamento?: CriarOrcamentoCondicaoPagamentoInput[]
  itens: CriarOrcamentoItemInput[] // >= 1 (RF-005.4); validação de Zod é da tarefa 30
}

export interface AtualizarOrcamentoInput {
  clienteId?: string
  empresaClienteId?: string
  titulo?: string
  descricao?: string
  validadeDias?: number
  prazoEntregaDias?: number
  descontoGlobalTipo?: DescontoTipo
  descontoGlobalValor?: number
  observacoes?: string
  condicoesPagamentoTexto?: string
  // SUBSTITUI todas as condições quando informado (undefined mantém as atuais).
  condicoesPagamento?: CriarOrcamentoCondicaoPagamentoInput[]
  itens: CriarOrcamentoItemInput[] // SUBSTITUI todos os itens
}

// -----------------------------------------------------------------------------
// Outputs
// -----------------------------------------------------------------------------
export interface OrcamentoItemPublico {
  id: string
  ordem: number
  nome: string
  descricao: string | null
  quantidade: number
  unidade: string
  valorUnitario: number
  descontoTipo: DescontoTipo | null
  descontoValor: number | null
  total: number
  responsavelId: string | null
}

export interface OrcamentoCondicaoPagamentoPublico {
  id: string
  ordem: number
  descricao: string
  percentual: number
  marco: string | null
  formaPagamento: string
}

export interface OrcamentoComItens {
  id: string
  tenantId: string
  numero: string
  clienteId: string
  empresaClienteId: string | null
  usuarioId: string
  titulo: string
  descricao: string | null
  status: OrcamentoStatus
  dataEmissao: Date
  validadeDias: number
  prazoEntregaDias: number | null
  descontoGlobalTipo: DescontoTipo | null
  descontoGlobalValor: number | null
  subtotal: number
  total: number
  versaoAtual: number
  observacoes: string | null
  // Texto livre legado (coluna `condicoes_pagamento`), consumido pelo snapshot/PDF.
  condicoesPagamentoTexto: string | null
  // Lista estruturada de condições de pagamento (RF-005/RF-007).
  condicoesPagamento: OrcamentoCondicaoPagamentoPublico[]
  criadoEm: Date
  atualizadoEm: Date
  itens: OrcamentoItemPublico[]
}

export interface OrcamentoResumo {
  id: string
  numero: string
  titulo: string
  status: OrcamentoStatus
  clienteId: string
  subtotal: number
  total: number
  versaoAtual: number
  dataEmissao: Date
  criadoEm: Date
}

export interface ListarOrcamentosFiltro {
  status?: OrcamentoStatus
  pagina?: number // 1-based, default 1
  tamanhoPagina?: number // default 20
}

export interface ListaOrcamentos {
  itens: OrcamentoResumo[]
  total: number
  pagina: number
  tamanhoPagina: number
}

export interface OrcamentoRepository {
  criar(input: CriarOrcamentoInput): Promise<OrcamentoComItens>
  buscarPorId(tenantId: string, id: string): Promise<OrcamentoComItens | null>
  atualizar(
    tenantId: string,
    id: string,
    dados: AtualizarOrcamentoInput,
  ): Promise<OrcamentoComItens | null>
  listarPorTenant(tenantId: string, filtro?: ListarOrcamentosFiltro): Promise<ListaOrcamentos>
  deletar(tenantId: string, id: string): Promise<void>
}

// -----------------------------------------------------------------------------
// Linhas do banco (snake_case). NUMERIC chega como string pelo driver `pg`.
// -----------------------------------------------------------------------------
interface OrcamentoRow {
  id: string
  tenant_id: string
  numero: string
  cliente_id: string
  empresa_cliente_id: string | null
  usuario_id: string
  titulo: string
  descricao: string | null
  status: OrcamentoStatus
  data_emissao: Date
  validade_dias: number
  desconto_global_tipo: DescontoTipo | null
  desconto_global_valor: string | null
  subtotal: string
  total: string
  versao_atual: number
  observacoes: string | null
  condicoes_pagamento: string | null
  prazo_entrega_dias: number | null
  criado_em: Date
  atualizado_em: Date
}

interface OrcamentoCondicaoPagamentoRow {
  id: string
  orcamento_id: string
  ordem: number
  descricao: string
  percentual: string
  marco: string | null
  forma_pagamento: string
}

interface OrcamentoItemRow {
  id: string
  orcamento_id: string
  ordem: number
  nome: string
  descricao: string | null
  quantidade: string
  unidade: string
  valor_unitario: string
  desconto_tipo: DescontoTipo | null
  desconto_valor: string | null
  total: string
  responsavel_id: string | null
}

// Converte NUMERIC (string do pg) para number, preservando null.
function numeroOpcional(valor: string | null): number | null {
  return valor === null ? null : Number(valor)
}

function mapRowItem(row: OrcamentoItemRow): OrcamentoItemPublico {
  return {
    id: row.id,
    ordem: row.ordem,
    nome: row.nome,
    descricao: row.descricao,
    quantidade: Number(row.quantidade),
    unidade: row.unidade,
    valorUnitario: Number(row.valor_unitario),
    descontoTipo: row.desconto_tipo,
    descontoValor: numeroOpcional(row.desconto_valor),
    total: Number(row.total),
    responsavelId: row.responsavel_id,
  }
}

function mapRowCondicaoPagamento(
  row: OrcamentoCondicaoPagamentoRow,
): OrcamentoCondicaoPagamentoPublico {
  return {
    id: row.id,
    ordem: row.ordem,
    descricao: row.descricao,
    percentual: Number(row.percentual),
    marco: row.marco,
    formaPagamento: row.forma_pagamento,
  }
}

function mapRowOrcamento(
  row: OrcamentoRow,
  itens: OrcamentoItemPublico[],
  condicoesPagamento: OrcamentoCondicaoPagamentoPublico[],
): OrcamentoComItens {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    numero: row.numero,
    clienteId: row.cliente_id,
    empresaClienteId: row.empresa_cliente_id,
    usuarioId: row.usuario_id,
    titulo: row.titulo,
    descricao: row.descricao,
    status: row.status,
    dataEmissao: row.data_emissao,
    validadeDias: row.validade_dias,
    prazoEntregaDias: row.prazo_entrega_dias,
    descontoGlobalTipo: row.desconto_global_tipo,
    descontoGlobalValor: numeroOpcional(row.desconto_global_valor),
    subtotal: Number(row.subtotal),
    total: Number(row.total),
    versaoAtual: row.versao_atual,
    observacoes: row.observacoes,
    condicoesPagamentoTexto: row.condicoes_pagamento,
    condicoesPagamento,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
    itens,
  }
}

function mapRowResumo(row: OrcamentoRow): OrcamentoResumo {
  return {
    id: row.id,
    numero: row.numero,
    titulo: row.titulo,
    status: row.status,
    clienteId: row.cliente_id,
    subtotal: Number(row.subtotal),
    total: Number(row.total),
    versaoAtual: row.versao_atual,
    dataEmissao: row.data_emissao,
    criadoEm: row.criado_em,
  }
}

const COLUNAS_ORCAMENTO = [
  'id',
  'tenant_id',
  'numero',
  'cliente_id',
  'empresa_cliente_id',
  'usuario_id',
  'titulo',
  'descricao',
  'status',
  'data_emissao',
  'validade_dias',
  'desconto_global_tipo',
  'desconto_global_valor',
  'subtotal',
  'total',
  'versao_atual',
  'observacoes',
  'condicoes_pagamento',
  'prazo_entrega_dias',
  'criado_em',
  'atualizado_em',
] as const

const COLUNAS_CONDICAO = [
  'id',
  'orcamento_id',
  'ordem',
  'descricao',
  'percentual',
  'marco',
  'forma_pagamento',
] as const

const COLUNAS_ITEM = [
  'id',
  'orcamento_id',
  'ordem',
  'nome',
  'descricao',
  'quantidade',
  'unidade',
  'valor_unitario',
  'desconto_tipo',
  'desconto_valor',
  'total',
  'responsavel_id',
] as const

// Monta o desconto global (quando ambos tipo e valor estão presentes) para o cálculo.
function descontoGlobal(
  tipo: DescontoTipo | undefined,
  valor: number | undefined,
): { tipo: DescontoTipo; valor: number } | undefined {
  if (tipo === undefined || valor === undefined) return undefined
  return { tipo, valor }
}

// Gera a próxima sequência do número ORC-{ANO}-{SEQ} dentro da transação.
//
// Numeração sequencial por tenant+ano SEM race condition (RF-005):
//  1. advisory lock transacional por (tenant, ano) — serializa a geração apenas
//     para o mesmo tenant/ano, liberado no commit/rollback;
//  2. lê o MAX da sequência existente para o tenant naquele ano;
//  3. próximo = (max ?? 0) + 1.
// O UNIQUE (tenant_id, numero) é a rede de segurança final. Como o schema atual
// não possui sequence por-tenant+ano (migrations 001–003), a geração é feita
// aqui, sem nova migration (fora do escopo da tarefa 28).
async function gerarNumero(
  trx: Transaction<Database>,
  tenantId: string,
  ano: number,
): Promise<string> {
  // `sql.execute(trx)` compila e executa o SQL cru na mesma transação.
  await sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId + ':' + ano}))`.execute(trx)

  const prefixo = `ORC-${ano}-`
  const resultado = await sql<{ max: number | null }>`
      SELECT MAX(CAST(SUBSTRING(numero FROM 'ORC-[0-9]{4}-([0-9]+)$') AS INTEGER)) AS max
      FROM orcamentos
      WHERE tenant_id = ${tenantId} AND numero LIKE ${prefixo + '%'}
    `.execute(trx)

  const max = resultado.rows[0]?.max ?? null
  const seq = (max ?? 0) + 1
  return `${prefixo}${String(seq).padStart(4, '0')}`
}

/**
 * Factory do repositório de orçamentos.
 *
 * Diferença de assinatura em relação aos repositórios vizinhos
 * (`criarClienteRepository(db)`, posicional): o enunciado da tarefa 28 exige
 * explicitamente `criarOrcamentoRepository({ db })` (parâmetro objeto). Seguimos
 * o enunciado por ser a autoridade máxima; o comportamento interno espelha os
 * demais repositórios (interface + mapRow* snake_case↔camelCase, Kysely).
 */
export function criarOrcamentoRepository(deps: { db: Kysely<Database> }): OrcamentoRepository {
  const { db } = deps

  // Insere os itens de um orçamento dentro da transação, atribuindo `ordem`
  // 1-based pela posição no array e calculando o total de cada item.
  async function inserirItens(
    trx: Transaction<Database>,
    orcamentoId: string,
    itens: CriarOrcamentoItemInput[],
  ): Promise<OrcamentoItemPublico[]> {
    // NUMERIC: as colunas são tipadas como string (driver pg); envie strings.
    const valores = itens.map((item, indice) => ({
      orcamento_id: orcamentoId,
      ordem: indice + 1,
      nome: item.nome,
      descricao: item.descricao ?? null,
      quantidade: String(item.quantidade),
      unidade: item.unidade ?? 'un',
      valor_unitario: String(item.valorUnitario),
      desconto_tipo: item.descontoTipo ?? null,
      desconto_valor: item.descontoValor !== undefined ? String(item.descontoValor) : null,
      total: String(
        calcularTotalItem({
          quantidade: item.quantidade,
          valorUnitario: item.valorUnitario,
          descontoTipo: item.descontoTipo,
          descontoValor: item.descontoValor,
        }),
      ),
      responsavel_id: item.responsavelId ?? null,
    }))

    const rows = await trx
      .insertInto('orcamento_itens')
      .values(valores)
      .returning(COLUNAS_ITEM)
      .execute()

    return (rows as OrcamentoItemRow[]).map(mapRowItem)
  }

  // Lê os itens de um orçamento ordenados por `ordem` ASC.
  async function buscarItens(id: string): Promise<OrcamentoItemPublico[]> {
    const rows = await db
      .selectFrom('orcamento_itens')
      .select(COLUNAS_ITEM)
      .where('orcamento_id', '=', id)
      .orderBy('ordem', 'asc')
      .execute()

    return (rows as OrcamentoItemRow[]).map(mapRowItem)
  }

  // Insere as condições de pagamento na transação, com `ordem` 1-based pela
  // posição no array. Lista vazia é permitida (retorna []).
  async function inserirCondicoes(
    trx: Transaction<Database>,
    orcamentoId: string,
    condicoes: CriarOrcamentoCondicaoPagamentoInput[],
  ): Promise<OrcamentoCondicaoPagamentoPublico[]> {
    if (condicoes.length === 0) return []

    const valores = condicoes.map((condicao, indice) => ({
      orcamento_id: orcamentoId,
      ordem: indice + 1,
      descricao: condicao.descricao,
      // NUMERIC: a coluna é tipada como string (driver pg); envie string.
      percentual: String(condicao.percentual),
      marco: condicao.marco ?? null,
      forma_pagamento: condicao.formaPagamento,
    }))

    const rows = await trx
      .insertInto('orcamento_condicoes_pagamento')
      .values(valores)
      .returning(COLUNAS_CONDICAO)
      .execute()

    return (rows as OrcamentoCondicaoPagamentoRow[]).map(mapRowCondicaoPagamento)
  }

  // Lê as condições de pagamento de um orçamento ordenadas por `ordem` ASC.
  async function buscarCondicoes(id: string): Promise<OrcamentoCondicaoPagamentoPublico[]> {
    const rows = await db
      .selectFrom('orcamento_condicoes_pagamento')
      .select(COLUNAS_CONDICAO)
      .where('orcamento_id', '=', id)
      .orderBy('ordem', 'asc')
      .execute()

    return (rows as OrcamentoCondicaoPagamentoRow[]).map(mapRowCondicaoPagamento)
  }

  return {
    async criar(input: CriarOrcamentoInput): Promise<OrcamentoComItens> {
      const subtotal = calcularSubtotal(
        input.itens.map((item) => ({
          quantidade: item.quantidade,
          valorUnitario: item.valorUnitario,
          descontoTipo: item.descontoTipo,
          descontoValor: item.descontoValor,
        })),
      )
      const total = calcularTotal(
        subtotal,
        descontoGlobal(input.descontoGlobalTipo, input.descontoGlobalValor),
      )

      // Ano derivado no app (data_emissao usa o default CURRENT_DATE do banco).
      const ano = new Date().getFullYear()

      return db.transaction().execute(async (trx) => {
        const numero = await gerarNumero(trx, input.tenantId, ano)

        const orcamentoRow = await trx
          .insertInto('orcamentos')
          .values({
            tenant_id: input.tenantId,
            numero,
            cliente_id: input.clienteId,
            empresa_cliente_id: input.empresaClienteId ?? null,
            usuario_id: input.usuarioId,
            titulo: input.titulo,
            descricao: input.descricao ?? null,
            status: 'rascunho',
            validade_dias: input.validadeDias ?? 30,
            desconto_global_tipo: input.descontoGlobalTipo ?? null,
            desconto_global_valor:
              input.descontoGlobalValor !== undefined ? String(input.descontoGlobalValor) : null,
            subtotal: String(subtotal),
            total: String(total),
            observacoes: input.observacoes ?? null,
            condicoes_pagamento: input.condicoesPagamentoTexto ?? null,
            prazo_entrega_dias: input.prazoEntregaDias ?? null,
          })
          .returning(COLUNAS_ORCAMENTO)
          .executeTakeFirstOrThrow()

        const orcamentoId = (orcamentoRow as OrcamentoRow).id
        const itens = await inserirItens(trx, orcamentoId, input.itens)
        const condicoes = await inserirCondicoes(trx, orcamentoId, input.condicoesPagamento ?? [])

        return mapRowOrcamento(orcamentoRow as OrcamentoRow, itens, condicoes)
      })
    },

    async buscarPorId(tenantId: string, id: string): Promise<OrcamentoComItens | null> {
      const row = await db
        .selectFrom('orcamentos')
        .select(COLUNAS_ORCAMENTO)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst()

      if (!row) return null

      const itens = await buscarItens(id)
      const condicoes = await buscarCondicoes(id)
      return mapRowOrcamento(row as OrcamentoRow, itens, condicoes)
    },

    async atualizar(
      tenantId: string,
      id: string,
      dados: AtualizarOrcamentoInput,
    ): Promise<OrcamentoComItens | null> {
      const subtotal = calcularSubtotal(
        dados.itens.map((item) => ({
          quantidade: item.quantidade,
          valorUnitario: item.valorUnitario,
          descontoTipo: item.descontoTipo,
          descontoValor: item.descontoValor,
        })),
      )
      const total = calcularTotal(
        subtotal,
        descontoGlobal(dados.descontoGlobalTipo, dados.descontoGlobalValor),
      )

      return db.transaction().execute(async (trx) => {
        const set: Record<string, unknown> = {
          atualizado_em: new Date(),
          subtotal: String(subtotal),
          total: String(total),
        }

        if (dados.clienteId !== undefined) set['cliente_id'] = dados.clienteId
        if (dados.empresaClienteId !== undefined) set['empresa_cliente_id'] = dados.empresaClienteId
        if (dados.titulo !== undefined) set['titulo'] = dados.titulo
        if (dados.descricao !== undefined) set['descricao'] = dados.descricao
        if (dados.validadeDias !== undefined) set['validade_dias'] = dados.validadeDias
        if (dados.prazoEntregaDias !== undefined) set['prazo_entrega_dias'] = dados.prazoEntregaDias
        if (dados.descontoGlobalTipo !== undefined)
          set['desconto_global_tipo'] = dados.descontoGlobalTipo
        if (dados.descontoGlobalValor !== undefined)
          set['desconto_global_valor'] = String(dados.descontoGlobalValor)
        if (dados.observacoes !== undefined) set['observacoes'] = dados.observacoes
        if (dados.condicoesPagamentoTexto !== undefined)
          set['condicoes_pagamento'] = dados.condicoesPagamentoTexto

        const orcamentoRow = await trx
          .updateTable('orcamentos')
          .set(set)
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .returning(COLUNAS_ORCAMENTO)
          .executeTakeFirst()

        if (!orcamentoRow) return null

        // SUBSTITUI os itens: apaga os antigos e reinsere os novos.
        await trx.deleteFrom('orcamento_itens').where('orcamento_id', '=', id).execute()

        const itens = await inserirItens(trx, id, dados.itens)

        // SUBSTITUI as condições apenas quando informadas; `undefined` mantém as
        // atuais (relê do banco para preservar o retorno completo).
        let condicoes: OrcamentoCondicaoPagamentoPublico[]
        if (dados.condicoesPagamento !== undefined) {
          await trx
            .deleteFrom('orcamento_condicoes_pagamento')
            .where('orcamento_id', '=', id)
            .execute()
          condicoes = await inserirCondicoes(trx, id, dados.condicoesPagamento)
        } else {
          const rows = await trx
            .selectFrom('orcamento_condicoes_pagamento')
            .select(COLUNAS_CONDICAO)
            .where('orcamento_id', '=', id)
            .orderBy('ordem', 'asc')
            .execute()
          condicoes = (rows as OrcamentoCondicaoPagamentoRow[]).map(mapRowCondicaoPagamento)
        }

        return mapRowOrcamento(orcamentoRow as OrcamentoRow, itens, condicoes)
      })
    },

    async listarPorTenant(
      tenantId: string,
      filtro?: ListarOrcamentosFiltro,
    ): Promise<ListaOrcamentos> {
      const pagina = filtro?.pagina ?? 1
      const tamanhoPagina = filtro?.tamanhoPagina ?? 20
      const offset = (pagina - 1) * tamanhoPagina

      let listaQuery = db
        .selectFrom('orcamentos')
        .select(COLUNAS_ORCAMENTO)
        .where('tenant_id', '=', tenantId)

      let countQuery = db
        .selectFrom('orcamentos')
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .where('tenant_id', '=', tenantId)

      if (filtro?.status !== undefined) {
        listaQuery = listaQuery.where('status', '=', filtro.status)
        countQuery = countQuery.where('status', '=', filtro.status)
      }

      const rows = await listaQuery
        .orderBy('criado_em', 'desc')
        .limit(tamanhoPagina)
        .offset(offset)
        .execute()

      const totalRow = await countQuery.executeTakeFirst()
      const total = totalRow ? Number((totalRow as { total: string }).total) : 0

      return {
        itens: (rows as OrcamentoRow[]).map(mapRowResumo),
        total,
        pagina,
        tamanhoPagina,
      }
    },

    async deletar(tenantId: string, id: string): Promise<void> {
      const row = await db
        .selectFrom('orcamentos')
        .select(['status'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst()

      if (!row) {
        throw new AppError(404, 'Orçamento não encontrado')
      }

      if ((row as { status: OrcamentoStatus }).status !== 'rascunho') {
        throw new AppError(409, 'Só é possível excluir orçamentos em rascunho')
      }

      // Os itens são removidos em cascata (ON DELETE CASCADE).
      await db
        .deleteFrom('orcamentos')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .execute()
    },
  }
}
