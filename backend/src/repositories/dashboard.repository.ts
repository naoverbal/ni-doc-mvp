import { sql, type Kysely } from 'kysely'
import type { Database } from '../types/database.js'
import type { OrcamentoStatus } from './orcamento.repository.js'
import type { Granularidade } from '../schemas/dashboard.schema.js'

// -----------------------------------------------------------------------------
// Repositório de leitura do dashboard: agregações por tenant. Só consultas
// (nenhuma escrita). O isolamento é duplo, como nos demais repositórios: o RLS
// (via middleware `tenant`) e o filtro explícito por `tenant_id`.
// -----------------------------------------------------------------------------

const FUSO = 'America/Sao_Paulo'

export interface LinhaStatus {
  status: OrcamentoStatus
  quantidade: number
  // Soma de `total` (NUMERIC → number).
  valor: number
}

export interface PontoCriadosBruto {
  // Chave canônica ordenável: 'AAAA-MM' (mês), 'AAAA-Www' (semana ISO) ou 'AAAA'.
  chave: string
  quantidade: number
}

export interface FiltroCriados {
  granularidade: Granularidade
  // Datas civis `AAAA-MM-DD` (inclusivas), interpretadas no fuso America/Sao_Paulo.
  de?: string
  ate?: string
}

// Orçamento enriquecido para as listas do dashboard.
export interface OrcamentoDashboard {
  id: string
  numero: string
  titulo: string
  status: OrcamentoStatus
  clienteId: string
  clienteNome: string
  total: number
  criadoEm: Date
  // Da versão vigente (`versao = versao_atual`); null enquanto for rascunho.
  enviadoEm: Date | null
  expiraEm: Date | null
}

export interface DashboardRepository {
  resumoPorStatus(tenantId: string): Promise<LinhaStatus[]>
  criadosPorPeriodo(tenantId: string, filtro: FiltroCriados): Promise<PontoCriadosBruto[]>
  recentes(tenantId: string, limite: number): Promise<OrcamentoDashboard[]>
  // `enviado` do envio mais antigo para o mais novo (aguardando há mais tempo).
  pendentes(tenantId: string, limite: number): Promise<OrcamentoDashboard[]>
}

interface LinhaStatusRow {
  status: OrcamentoStatus
  quantidade: string
  valor: string | null
}

interface CriadosRow {
  chave: string
  quantidade: string
}

interface OrcamentoDashboardRow {
  id: string
  numero: string
  titulo: string
  status: OrcamentoStatus
  cliente_id: string
  cliente_nome: string
  total: string
  criado_em: Date
  enviado_em: Date | null
  expira_em: Date | null
}

function mapRowDashboard(row: OrcamentoDashboardRow): OrcamentoDashboard {
  return {
    id: row.id,
    numero: row.numero,
    titulo: row.titulo,
    status: row.status,
    clienteId: row.cliente_id,
    clienteNome: row.cliente_nome,
    total: Number(row.total),
    criadoEm: row.criado_em,
    enviadoEm: row.enviado_em,
    expiraEm: row.expira_em,
  }
}

// Parâmetros de date_trunc / to_char por granularidade. A semana segue a ISO
// 8601 (segunda a domingo; `IYYY`/`IW`), igual à série que o front exibia.
const TRUNC: Record<Granularidade, string> = { semana: 'week', mes: 'month', ano: 'year' }
const FORMATO: Record<Granularidade, string> = {
  semana: 'IYYY-"W"IW',
  mes: 'YYYY-MM',
  ano: 'YYYY',
}

export interface DashboardRepositoryDeps {
  db: Kysely<Database>
}

export function criarDashboardRepository({ db }: DashboardRepositoryDeps): DashboardRepository {
  // Base das listas: orçamento + nome do cliente + versão vigente (se houver).
  function baseLista(tenantId: string) {
    return db
      .selectFrom('orcamentos as o')
      .innerJoin('clientes as c', 'c.id', 'o.cliente_id')
      .leftJoin('orcamento_versoes as v', (join) =>
        join.onRef('v.orcamento_id', '=', 'o.id').onRef('v.versao', '=', 'o.versao_atual'),
      )
      .select([
        'o.id as id',
        'o.numero as numero',
        'o.titulo as titulo',
        'o.status as status',
        'o.cliente_id as cliente_id',
        'c.nome as cliente_nome',
        'o.total as total',
        'o.criado_em as criado_em',
        'v.enviado_em as enviado_em',
        'v.expira_em as expira_em',
      ])
      .where('o.tenant_id', '=', tenantId)
  }

  return {
    async resumoPorStatus(tenantId: string): Promise<LinhaStatus[]> {
      const rows = (await db
        .selectFrom('orcamentos')
        .select((eb) => [
          'status',
          eb.fn.countAll<string>().as('quantidade'),
          eb.fn.sum<string>('total').as('valor'),
        ])
        .where('tenant_id', '=', tenantId)
        .groupBy('status')
        .execute()) as unknown as LinhaStatusRow[]

      return rows.map((row) => ({
        status: row.status,
        quantidade: Number(row.quantidade),
        valor: Number(row.valor ?? 0),
      }))
    },

    async criadosPorPeriodo(
      tenantId: string,
      filtro: FiltroCriados,
    ): Promise<PontoCriadosBruto[]> {
      const de = filtro.de ?? null
      const ate = filtro.ate ?? null

      // A data é truncada no fuso de São Paulo (mesma regra da expiração): sem
      // isso, um orçamento criado às 22h do último dia do mês cairia no mês
      // seguinte (UTC). `GROUP BY 1` evita casar expressões parametrizadas.
      const resultado = await sql<CriadosRow>`
        SELECT to_char(
                 date_trunc(${TRUNC[filtro.granularidade]}, criado_em AT TIME ZONE ${FUSO}),
                 ${FORMATO[filtro.granularidade]}
               ) AS chave,
               COUNT(*)::text AS quantidade
        FROM orcamentos
        WHERE tenant_id = ${tenantId}
          AND (${de}::date IS NULL
               OR criado_em >= (${de}::date)::timestamp AT TIME ZONE ${FUSO})
          AND (${ate}::date IS NULL
               OR criado_em < ((${ate}::date + 1)::timestamp AT TIME ZONE ${FUSO}))
        GROUP BY 1
        ORDER BY 1
      `.execute(db)

      return resultado.rows.map((row) => ({
        chave: row.chave,
        quantidade: Number(row.quantidade),
      }))
    },

    async recentes(tenantId: string, limite: number): Promise<OrcamentoDashboard[]> {
      const rows = (await baseLista(tenantId)
        .orderBy('o.criado_em', 'desc')
        .limit(limite)
        .execute()) as unknown as OrcamentoDashboardRow[]
      return rows.map(mapRowDashboard)
    },

    async pendentes(tenantId: string, limite: number): Promise<OrcamentoDashboard[]> {
      const rows = (await baseLista(tenantId)
        .where('o.status', '=', 'enviado')
        // Sem versão vigente (não deveria ocorrer em `enviado`), cai no fim.
        .orderBy('v.enviado_em', 'asc')
        .limit(limite)
        .execute()) as unknown as OrcamentoDashboardRow[]
      return rows.map(mapRowDashboard)
    },
  }
}
