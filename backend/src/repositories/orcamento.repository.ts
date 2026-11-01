import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'
import type { Database } from '../types/database.js'
import { AppError } from '../errors/app-error.js'
import { calcularSubtotal, calcularTotal, calcularTotalItem } from '../lib/orcamento-calculo.js'
import { calcularHashConteudo } from '../lib/orcamento-hash.js'
import { dataCivilNoFuso } from '../lib/validade.js'

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

export const STATUS_REABRIVEL = ['reprovado', 'cancelado', 'expirado'] as const

export type StatusReabrivel = (typeof STATUS_REABRIVEL)[number]

export type ResultadoDeletar =
  | { resultado: 'removido' }
  | { resultado: 'restaurado'; statusRestaurado: StatusReabrivel }

export interface OrcamentoRepository {
  criar(input: CriarOrcamentoInput): Promise<OrcamentoComItens>
  buscarPorId(tenantId: string, id: string): Promise<OrcamentoComItens | null>
  atualizar(
    tenantId: string,
    id: string,
    dados: AtualizarOrcamentoInput,
  ): Promise<OrcamentoComItens | null>
  listarPorTenant(tenantId: string, filtro?: ListarOrcamentosFiltro): Promise<ListaOrcamentos>
  // Exclui um rascunho. Rascunho NUNCA enviado é removido de verdade
  // (`removido`). Rascunho REABERTO (tem versões) nunca apaga o histórico: o
  // orçamento volta ao status de origem (reprovado | cancelado | expirado) com o
  // conteúdo da última versão enviada (`restaurado`). Tudo em transação, com lock
  // de linha: exclusões concorrentes serializam e a perdedora recebe 404/409.
  deletar(tenantId: string, id: string): Promise<ResultadoDeletar>
  // Reabre (reprovado | cancelado | expirado → rascunho) em transação, travando a
  // linha e relendo o status: reaberturas concorrentes serializam e só uma vence.
  // 404 se não existir no tenant; 409 se o status não permitir. Renova
  // `data_emissao` para a data civil da reabertura (mantém `validade_dias`) e
  // guarda o status de origem. Devolve o status anterior.
  reabrir(tenantId: string, id: string): Promise<{ statusAnterior: StatusReabrivel }>
  // Cancela (enviado | aprovado → cancelado) em transação, travando a linha
  // (`FOR UPDATE`) e relendo o status: cancelamentos concorrentes serializam e só
  // um vence. 404 se não existir no tenant; 409 se o status não permitir. Só o
  // status muda (versões, aceites e comprovantes ficam intactos). Devolve o
  // status anterior.
  cancelar(tenantId: string, id: string): Promise<{ statusAnterior: OrcamentoStatus }>
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

// Índice único parcial (migration 007) que impede o mesmo usuário de criar o
// mesmo orçamento (cliente + título + itens) duas vezes.
const INDICE_CONTEUDO_DUPLICADO = 'uq_orcamentos_conteudo'

function ehConteudoDuplicado(erro: unknown): boolean {
  if (typeof erro !== 'object' || erro === null) return false
  const { code, constraint } = erro as { code?: string; constraint?: string }
  return code === '23505' && constraint === INDICE_CONTEUDO_DUPLICADO
}

function erroConteudoDuplicado(): AppError {
  return new AppError(409, 'Já existe um orçamento seu com o mesmo cliente, título e itens')
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

function ehStatusReabrivel(status: string): status is StatusReabrivel {
  return (STATUS_REABRIVEL as readonly string[]).includes(status)
}

// Conteúdo editável de um orçamento, lido do snapshot imutável da última versão.
// `titulo`/`descricao` só existem em snapshots gerados a partir da tarefa 68;
// versões anteriores não os trazem e esses campos ficam como estão.
interface ConteudoSnapshot {
  clienteId: string | null
  empresaClienteId: string | null
  titulo: string | null
  descricao: string | null | undefined
  itens: CriarOrcamentoItemInput[]
  responsaveisDosItens: (string | null)[]
  condicoes: CriarOrcamentoCondicaoPagamentoInput[]
  descontoGlobal: { tipo: DescontoTipo; valor: number } | null
  subtotal: number
  total: number
  condicoesPagamentoTexto: string | null
  prazoEntregaDias: number | null
  observacoes: string | null
  dataEmissao: string | null
  validadeDias: number | null
}

type Json = Record<string, unknown>

function objeto(valor: unknown): Json | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Json)
    : null
}

function textoOuNull(valor: unknown): string | null {
  return typeof valor === 'string' ? valor : null
}

function numeroOuNull(valor: unknown): number | null {
  return typeof valor === 'number' ? valor : null
}

function lerConteudoSnapshot(snapshot: unknown): ConteudoSnapshot {
  const raiz = objeto(snapshot) ?? {}
  const itensBrutos = Array.isArray(raiz['itens']) ? raiz['itens'] : []
  const responsaveisDosItens: (string | null)[] = []
  const itens: CriarOrcamentoItemInput[] = itensBrutos.map((bruto) => {
    const item = objeto(bruto) ?? {}
    const responsavel = objeto(item['responsavel'])
    responsaveisDosItens.push(textoOuNull(responsavel?.['id']))
    const descontoTipo = item['desconto_tipo']
    return {
      nome: textoOuNull(item['nome']) ?? '',
      descricao: textoOuNull(item['descricao']) ?? undefined,
      quantidade: numeroOuNull(item['quantidade']) ?? 0,
      unidade: textoOuNull(item['unidade']) ?? undefined,
      valorUnitario: numeroOuNull(item['valor_unitario']) ?? 0,
      descontoTipo:
        descontoTipo === 'percentual' || descontoTipo === 'fixo' ? descontoTipo : undefined,
      descontoValor: numeroOuNull(item['desconto_valor']) ?? undefined,
    }
  })

  const condicoesBrutas = Array.isArray(raiz['condicoes_pagamento_lista'])
    ? raiz['condicoes_pagamento_lista']
    : []
  const condicoes: CriarOrcamentoCondicaoPagamentoInput[] = condicoesBrutas.map((bruta) => {
    const condicao = objeto(bruta) ?? {}
    return {
      descricao: textoOuNull(condicao['descricao']) ?? '',
      percentual: numeroOuNull(condicao['percentual']) ?? 0,
      marco: textoOuNull(condicao['marco']) ?? undefined,
      formaPagamento: textoOuNull(condicao['forma_pagamento']) ?? '',
    }
  })

  const desconto = objeto(raiz['desconto_global'])
  const tipoDesconto = desconto?.['tipo']
  const valorDesconto = numeroOuNull(desconto?.['valor'])
  let descontoGlobal: { tipo: DescontoTipo; valor: number } | null = null
  if ((tipoDesconto === 'percentual' || tipoDesconto === 'fixo') && valorDesconto !== null) {
    descontoGlobal = { tipo: tipoDesconto, valor: valorDesconto }
  }

  return {
    clienteId: textoOuNull(objeto(raiz['cliente'])?.['id']),
    empresaClienteId: textoOuNull(objeto(raiz['empresa_cliente'])?.['id']),
    titulo: textoOuNull(raiz['titulo']),
    descricao: 'descricao' in raiz ? textoOuNull(raiz['descricao']) : undefined,
    itens,
    responsaveisDosItens,
    condicoes,
    descontoGlobal,
    subtotal: numeroOuNull(raiz['subtotal']) ?? 0,
    total: numeroOuNull(raiz['total']) ?? 0,
    condicoesPagamentoTexto: textoOuNull(raiz['condicoes_pagamento']),
    prazoEntregaDias: numeroOuNull(raiz['prazo_entrega_dias']),
    observacoes: textoOuNull(raiz['observacoes']),
    dataEmissao: textoOuNull(raiz['data_emissao']),
    validadeDias: numeroOuNull(raiz['validade_dias']),
  }
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

  // Devolve um rascunho reaberto ao status de origem, restaurando o conteúdo
  // editável (itens, condições e campos) a partir do snapshot da ÚLTIMA versão
  // enviada e descartando as edições do rascunho. Versões, PDFs e aceites não são
  // tocados. Referências (cliente, empresa, responsável) que não existam mais no
  // tenant são mantidas como estão no orçamento (ou omitidas, no caso do item),
  // para respeitar os triggers de integridade entre tenants.
  async function restaurarUltimaVersao(
    trx: Transaction<Database>,
    tenantId: string,
    id: string,
    statusOrigem: StatusReabrivel,
  ): Promise<void> {
    const ultima = await trx
      .selectFrom('orcamento_versoes')
      .select('snapshot')
      .where('orcamento_id', '=', id)
      .orderBy('versao', 'desc')
      .limit(1)
      .executeTakeFirst()
    if (!ultima) {
      throw new AppError(409, 'Rascunho reaberto sem versão enviada para restaurar')
    }

    const snapshot: unknown =
      typeof ultima.snapshot === 'string' ? JSON.parse(ultima.snapshot) : ultima.snapshot
    const conteudo = lerConteudoSnapshot(snapshot)

    const existe = async (
      tabela: 'clientes' | 'empresas' | 'responsaveis_tecnicos',
      refId: string | null,
    ): Promise<boolean> => {
      if (refId === null) return false
      const achado = await trx
        .selectFrom(tabela)
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', refId)
        .executeTakeFirst()
      return achado !== undefined
    }

    const set: Record<string, unknown> = {
      status: statusOrigem,
      status_reaberto_de: null,
      atualizado_em: new Date(),
      subtotal: String(conteudo.subtotal),
      total: String(conteudo.total),
      desconto_global_tipo: conteudo.descontoGlobal?.tipo ?? null,
      desconto_global_valor:
        conteudo.descontoGlobal !== null ? String(conteudo.descontoGlobal.valor) : null,
      condicoes_pagamento: conteudo.condicoesPagamentoTexto,
      prazo_entrega_dias: conteudo.prazoEntregaDias,
      observacoes: conteudo.observacoes,
    }
    if (conteudo.titulo !== null) set['titulo'] = conteudo.titulo
    if (conteudo.descricao !== undefined) set['descricao'] = conteudo.descricao
    if (conteudo.validadeDias !== null) set['validade_dias'] = conteudo.validadeDias
    if (conteudo.dataEmissao !== null) {
      set['data_emissao'] = sql<Date>`${conteudo.dataEmissao}::date`
    }
    if (await existe('clientes', conteudo.clienteId)) set['cliente_id'] = conteudo.clienteId
    set['empresa_cliente_id'] = (await existe('empresas', conteudo.empresaClienteId))
      ? conteudo.empresaClienteId
      : null

    await trx
      .updateTable('orcamentos')
      .set(set)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .execute()

    const itens: CriarOrcamentoItemInput[] = []
    for (const [indice, item] of conteudo.itens.entries()) {
      const responsavelId = conteudo.responsaveisDosItens[indice] ?? null
      itens.push(
        (await existe('responsaveis_tecnicos', responsavelId))
          ? { ...item, responsavelId: responsavelId as string }
          : item,
      )
    }
    await trx.deleteFrom('orcamento_itens').where('orcamento_id', '=', id).execute()
    if (itens.length > 0) {
      await inserirItens(trx, id, itens)
    }
    await trx.deleteFrom('orcamento_condicoes_pagamento').where('orcamento_id', '=', id).execute()
    await inserirCondicoes(trx, id, conteudo.condicoes)
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

      const conteudoHash = calcularHashConteudo({
        clienteId: input.clienteId,
        titulo: input.titulo,
        itens: input.itens,
      })

      try {
        return await db.transaction().execute(async (trx) => {
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
              // Data civil de emissão no fuso de negócio (não o CURRENT_DATE do
              // banco, que segue o fuso da sessão): base da validade (tarefa 66).
              data_emissao: sql<Date>`${dataCivilNoFuso(new Date())}::date`,
              validade_dias: input.validadeDias ?? 30,
              desconto_global_tipo: input.descontoGlobalTipo ?? null,
              desconto_global_valor:
                input.descontoGlobalValor !== undefined ? String(input.descontoGlobalValor) : null,
              subtotal: String(subtotal),
              total: String(total),
              observacoes: input.observacoes ?? null,
              condicoes_pagamento: input.condicoesPagamentoTexto ?? null,
              prazo_entrega_dias: input.prazoEntregaDias ?? null,
              conteudo_hash: conteudoHash,
            })
            .returning(COLUNAS_ORCAMENTO)
            .executeTakeFirstOrThrow()

          const orcamentoId = (orcamentoRow as OrcamentoRow).id
          const itens = await inserirItens(trx, orcamentoId, input.itens)
          const condicoes = await inserirCondicoes(trx, orcamentoId, input.condicoesPagamento ?? [])

          return mapRowOrcamento(orcamentoRow as OrcamentoRow, itens, condicoes)
        })
      } catch (erro) {
        if (ehConteudoDuplicado(erro)) throw erroConteudoDuplicado()
        throw erro
      }
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

      try {
        return await db.transaction().execute(async (trx) => {
          const set: Record<string, unknown> = {
            atualizado_em: new Date(),
            subtotal: String(subtotal),
            total: String(total),
          }

          if (dados.clienteId !== undefined) set['cliente_id'] = dados.clienteId
          if (dados.empresaClienteId !== undefined)
            set['empresa_cliente_id'] = dados.empresaClienteId
          if (dados.titulo !== undefined) set['titulo'] = dados.titulo
          if (dados.descricao !== undefined) set['descricao'] = dados.descricao
          if (dados.validadeDias !== undefined) set['validade_dias'] = dados.validadeDias
          if (dados.prazoEntregaDias !== undefined)
            set['prazo_entrega_dias'] = dados.prazoEntregaDias
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
      } catch (erro) {
        if (ehConteudoDuplicado(erro)) throw erroConteudoDuplicado()
        throw erro
      }
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

    async deletar(tenantId: string, id: string): Promise<ResultadoDeletar> {
      return db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom('orcamentos')
          .select(['status', 'status_reaberto_de'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst()

        if (!row) {
          throw new AppError(404, 'Orçamento não encontrado')
        }
        if (row.status !== 'rascunho') {
          throw new AppError(409, 'Só é possível excluir orçamentos em rascunho')
        }

        // Rascunho nunca enviado: exclusão real (itens saem em cascata).
        if (row.status_reaberto_de === null) {
          await trx
            .deleteFrom('orcamentos')
            .where('tenant_id', '=', tenantId)
            .where('id', '=', id)
            .execute()
          return { resultado: 'removido' }
        }

        // Rascunho reaberto: o histórico é preservado e o orçamento volta ao
        // status de origem, com o conteúdo da última versão enviada.
        await restaurarUltimaVersao(trx, tenantId, id, row.status_reaberto_de)
        return { resultado: 'restaurado', statusRestaurado: row.status_reaberto_de }
      })
    },

    async reabrir(tenantId: string, id: string): Promise<{ statusAnterior: StatusReabrivel }> {
      return db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom('orcamentos')
          .select(['status'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst()

        if (!row) {
          throw new AppError(404, 'Orçamento não encontrado')
        }

        const statusAnterior = row.status
        if (!ehStatusReabrivel(statusAnterior)) {
          throw new AppError(
            409,
            'Só é possível reabrir orçamentos reprovados, cancelados ou expirados',
          )
        }

        await trx
          .updateTable('orcamentos')
          .set({
            status: 'rascunho',
            status_reaberto_de: statusAnterior,
            // A validade conta a partir da reabertura; sem isso um `expirado`
            // voltaria a rascunho com a validade vencida e não poderia ser reenviado.
            data_emissao: sql<Date>`${dataCivilNoFuso(new Date())}::date`,
            atualizado_em: new Date(),
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .execute()

        return { statusAnterior }
      })
    },

    async cancelar(tenantId: string, id: string): Promise<{ statusAnterior: OrcamentoStatus }> {
      return db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom('orcamentos')
          .select(['status'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst()

        if (!row) {
          throw new AppError(404, 'Orçamento não encontrado')
        }

        const statusAnterior = (row as { status: OrcamentoStatus }).status
        if (statusAnterior !== 'enviado' && statusAnterior !== 'aprovado') {
          throw new AppError(409, 'Só é possível cancelar orçamentos enviados ou aprovados')
        }

        await trx
          .updateTable('orcamentos')
          .set({ status: 'cancelado', atualizado_em: new Date() })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .execute()

        return { statusAnterior }
      })
    },
  }
}
