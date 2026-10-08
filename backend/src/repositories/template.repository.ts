import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'
import type { Database } from '../types/database.js'

// -----------------------------------------------------------------------------
// Layout do template. O schema real do JSON é definido pelo editor visual
// (tarefa 49) e validado por Zod nas rotas (tarefa 35); aqui o layout trafega
// como objeto genérico (JSONB) sem shape rígido.
// -----------------------------------------------------------------------------
export type LayoutTemplate = Record<string, unknown>

// Layout padrão aplicado na versão 1 criada no bootstrap do tenant. Espelha o
// shape do seed `003_seed_dev.sql` (A4, retrato, margens, seções).
export const LAYOUT_PADRAO: LayoutTemplate = {
  formato: 'A4',
  orientacao: 'retrato',
  margens: { topo: 20, direita: 20, baixo: 20, esquerda: 20 },
  secoes: [
    { tipo: 'cabecalho', altura: 80 },
    { tipo: 'dados_cliente', altura: 60 },
    { tipo: 'itens', altura_linha: 30 },
    { tipo: 'totais', altura: 80 },
    { tipo: 'rodape', altura: 40 },
  ],
}

// -----------------------------------------------------------------------------
// Inputs / Outputs
// -----------------------------------------------------------------------------
export interface SalvarTemplateInput {
  tenantId: string
  layoutJson: LayoutTemplate
}

export interface TemplatePublico {
  id: string
  tenantId: string
  versao: number
  layoutJson: LayoutTemplate
  criadoEm: Date
}

export interface TemplateRepository {
  // Cria a versão 1 (layout padrão) e a ativa; usado no bootstrap do tenant.
  criarTemplatePadrao(tenantId: string): Promise<TemplatePublico>
  // Cria uma NOVA versão (max + 1) e atualiza o ponteiro ativo; append-only.
  salvar(input: SalvarTemplateInput): Promise<TemplatePublico>
  // Versão atualmente ativa (join via tenants_template_ativo).
  buscarAtivo(tenantId: string): Promise<TemplatePublico | null>
  // Versão específica (filtrada por tenant_id — defesa em profundidade).
  buscarPorId(tenantId: string, id: string): Promise<TemplatePublico | null>
}

// -----------------------------------------------------------------------------
// Linha do banco (snake_case). `layout_json` chega como objeto JS (JSONB).
// -----------------------------------------------------------------------------
interface TemplateRow {
  id: string
  tenant_id: string
  versao: number
  layout_json: unknown
  criado_em: Date
}

const COLUNAS_TEMPLATE = ['id', 'tenant_id', 'versao', 'layout_json', 'criado_em'] as const

function mapRowTemplate(row: TemplateRow): TemplatePublico {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    versao: row.versao,
    layoutJson: row.layout_json as LayoutTemplate,
    criadoEm: row.criado_em,
  }
}

/**
 * Factory do repositório de templates.
 *
 * Assinatura com objeto de dependências (`criarTemplateRepository({ db })`),
 * espelhando o vizinho funcional desta fase (`criarOrcamentoRepository({ db })`).
 */
export function criarTemplateRepository(deps: { db: Kysely<Database> }): TemplateRepository {
  const { db } = deps

  // Insere uma nova versão (append-only) e atualiza o ponteiro ativo, tudo em
  // uma transação única. A geração de versão é serializada por tenant via
  // advisory lock transacional (sem race), espelhando `gerarNumero` do
  // orcamento.repository: advisory lock → MAX(versao) → +1.
  async function inserirVersao(
    tenantId: string,
    layoutJson: LayoutTemplate,
  ): Promise<TemplatePublico> {
    return db.transaction().execute(async (trx: Transaction<Database>) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`.execute(trx)

      const resultado = await sql<{ max: number | null }>`
        SELECT MAX(versao) AS max FROM templates WHERE tenant_id = ${tenantId}
      `.execute(trx)

      const max = resultado.rows[0]?.max ?? null
      const versao = (max ?? 0) + 1

      const row = await trx
        .insertInto('templates')
        .values({
          tenant_id: tenantId,
          versao,
          layout_json: JSON.stringify(layoutJson),
        })
        .returning(COLUNAS_TEMPLATE)
        .executeTakeFirstOrThrow()

      const templateId = (row as TemplateRow).id

      await trx
        .insertInto('tenants_template_ativo')
        .values({ tenant_id: tenantId, template_id: templateId })
        .onConflict((oc) => oc.column('tenant_id').doUpdateSet({ template_id: templateId }))
        .execute()

      return mapRowTemplate(row as TemplateRow)
    })
  }

  return {
    async criarTemplatePadrao(tenantId: string): Promise<TemplatePublico> {
      return inserirVersao(tenantId, LAYOUT_PADRAO)
    },

    async salvar(input: SalvarTemplateInput): Promise<TemplatePublico> {
      return inserirVersao(input.tenantId, input.layoutJson)
    },

    async buscarAtivo(tenantId: string): Promise<TemplatePublico | null> {
      const row = await db
        .selectFrom('tenants_template_ativo')
        .innerJoin('templates', 'templates.id', 'tenants_template_ativo.template_id')
        .select([
          'templates.id as id',
          'templates.tenant_id as tenant_id',
          'templates.versao as versao',
          'templates.layout_json as layout_json',
          'templates.criado_em as criado_em',
        ])
        .where('tenants_template_ativo.tenant_id', '=', tenantId)
        .executeTakeFirst()

      if (!row) return null
      return mapRowTemplate(row as TemplateRow)
    },

    async buscarPorId(tenantId: string, id: string): Promise<TemplatePublico | null> {
      const row = await db
        .selectFrom('templates')
        .select(COLUNAS_TEMPLATE)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst()

      if (!row) return null
      return mapRowTemplate(row as TemplateRow)
    },
  }
}
