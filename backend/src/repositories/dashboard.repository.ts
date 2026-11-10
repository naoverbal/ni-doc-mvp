import { sql, type Kysely, type RawBuilder } from 'kysely'
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

export interface FiltroVencendo {
  agora: Date
  ate: Date
  limite: number
}

// Intervalo opcional pela data do aceite (datas civis `AAAA-MM-DD` inclusivas).
export interface IntervaloDecisao {
  de?: string
  ate?: string
}

// `resultado` é null na linha de total geral (todas as decisões juntas).
export interface LinhaTempoDecisao {
  resultado: 'aprovado' | 'reprovado' | null
  quantidade: number
  mediaDias: number
  medianaDias: number
}

// Linha das séries por evento (envio / aprovação): período x status ATUAL.
// O orçamento fica no período do evento original; o status atual mostra, nesse
// mesmo período, o impacto de cancelamentos e expirações posteriores.
export interface LinhaSerieStatus {
  chave: string
  status: OrcamentoStatus
  quantidade: number
  valor: number
}

export interface DashboardRepository {
  resumoPorStatus(tenantId: string): Promise<LinhaStatus[]>
  criadosPorPeriodo(tenantId: string, filtro: FiltroCriados): Promise<PontoCriadosBruto[]>
  // Por `enviado_em` da versão vigente; status atuais: enviado, aprovado,
  // reprovado, expirado e cancelado (rascunho, inclusive reaberto, fica de fora).
  enviadosPorPeriodo(tenantId: string, filtro: FiltroCriados): Promise<LinhaSerieStatus[]>
  // Por data do aceite da versão vigente; status atuais: aprovado e cancelado
  // (só `enviado` e `aprovado` podem ser cancelados, e só decisões geram aceite,
  // então cancelado + aceite vigente = aprovado que foi cancelado depois).
  aprovadosPorPeriodo(tenantId: string, filtro: FiltroCriados): Promise<LinhaSerieStatus[]>
  recentes(tenantId: string, limite: number): Promise<OrcamentoDashboard[]>
  // `enviado` do envio mais antigo para o mais novo (aguardando há mais tempo).
  pendentes(tenantId: string, limite: number): Promise<OrcamentoDashboard[]>
  // `enviado` que ainda não venceu e vence entre `agora` e `ate`, do vencimento
  // mais próximo ao mais distante. `expiraEm` traz o vencimento efetivo.
  vencendo(tenantId: string, filtro: FiltroVencendo): Promise<OrcamentoDashboard[]>
  // Tempo entre o envio e o aceite da versão vigente, por resultado.
  tempoDecisao(tenantId: string, intervalo: IntervaloDecisao): Promise<LinhaTempoDecisao[]>
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

interface TempoDecisaoRow {
  resultado: 'aprovado' | 'reprovado' | null
  quantidade: string
  media_dias: string
  mediana_dias: string
}

interface SerieStatusRow {
  chave: string
  status: OrcamentoStatus
  quantidade: string
  valor: string
}

// Expressão da chave do período para uma coluna timestamptz, no fuso de São
// Paulo (mesma regra da expiração): sem isso, um orçamento criado às 22h do
// último dia do mês cairia no mês seguinte (UTC).
function expressaoChave(coluna: string, granularidade: Granularidade): RawBuilder<string> {
  return sql<string>`to_char(
    date_trunc(${TRUNC[granularidade]}, ${sql.ref(coluna)} AT TIME ZONE ${FUSO}),
    ${FORMATO[granularidade]}
  )`
}

// Filtro opcional de intervalo (datas civis inclusivas, fuso de São Paulo).
function clausulaIntervalo(coluna: string, filtro: IntervaloDecisao): RawBuilder<unknown> {
  const de = filtro.de ?? null
  const ate = filtro.ate ?? null
  const ref = sql.ref(coluna)
  return sql`(${de}::date IS NULL
              OR ${ref} >= (${de}::date)::timestamp AT TIME ZONE ${FUSO})
         AND (${ate}::date IS NULL
              OR ${ref} < ((${ate}::date + 1)::timestamp AT TIME ZONE ${FUSO}))`
}

function mapRowSerieStatus(row: SerieStatusRow): LinhaSerieStatus {
  return {
    chave: row.chave,
    status: row.status,
    quantidade: Number(row.quantidade),
    valor: Number(row.valor),
  }
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
      // `GROUP BY 1` evita casar expressões parametrizadas entre SELECT e GROUP.
      const resultado = await sql<CriadosRow>`
        SELECT ${expressaoChave('criado_em', filtro.granularidade)} AS chave,
               COUNT(*)::text AS quantidade
        FROM orcamentos
        WHERE tenant_id = ${tenantId}
          AND ${clausulaIntervalo('criado_em', filtro)}
        GROUP BY 1
        ORDER BY 1
      `.execute(db)

      return resultado.rows.map((row) => ({
        chave: row.chave,
        quantidade: Number(row.quantidade),
      }))
    },

    async enviadosPorPeriodo(
      tenantId: string,
      filtro: FiltroCriados,
    ): Promise<LinhaSerieStatus[]> {
      // Versão vigente apenas: um orçamento reaberto e reenviado conta no novo
      // envio, não duas vezes.
      const resultado = await sql<SerieStatusRow>`
        SELECT ${expressaoChave('v.enviado_em', filtro.granularidade)} AS chave,
               o.status AS status,
               COUNT(*)::text AS quantidade,
               COALESCE(SUM(o.total), 0)::text AS valor
        FROM orcamentos o
        JOIN orcamento_versoes v
          ON v.orcamento_id = o.id AND v.versao = o.versao_atual
        WHERE o.tenant_id = ${tenantId}
          AND o.status IN ('enviado', 'aprovado', 'reprovado', 'expirado', 'cancelado')
          AND ${clausulaIntervalo('v.enviado_em', filtro)}
        GROUP BY 1, 2
        ORDER BY 1, 2
      `.execute(db)

      return resultado.rows.map(mapRowSerieStatus)
    },

    async aprovadosPorPeriodo(
      tenantId: string,
      filtro: FiltroCriados,
    ): Promise<LinhaSerieStatus[]> {
      // Aceite da versão vigente (UNIQUE por versão). Um orçamento reprovado na
      // v1 e aprovado na v2 conta uma única vez, no aceite da v2.
      const resultado = await sql<SerieStatusRow>`
        SELECT ${expressaoChave('a.criado_em', filtro.granularidade)} AS chave,
               o.status AS status,
               COUNT(*)::text AS quantidade,
               COALESCE(SUM(o.total), 0)::text AS valor
        FROM orcamentos o
        JOIN orcamento_versoes v
          ON v.orcamento_id = o.id AND v.versao = o.versao_atual
        JOIN orcamento_aceites a ON a.versao_id = v.id
        WHERE o.tenant_id = ${tenantId}
          AND o.status IN ('aprovado', 'cancelado')
          AND ${clausulaIntervalo('a.criado_em', filtro)}
        GROUP BY 1, 2
        ORDER BY 1, 2
      `.execute(db)

      return resultado.rows.map(mapRowSerieStatus)
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

    async vencendo(tenantId: string, filtro: FiltroVencendo): Promise<OrcamentoDashboard[]> {
      // Vencimento efetivo = o menor entre o `expira_em` da versão vigente e a
      // regra do job de expiração (migration 008): vale o dia inteiro de
      // `data_emissao + validade_dias` e vence às 00:00 do dia seguinte em São
      // Paulo. LEAST ignora NULL, então versão sem `expira_em` usa só a regra.
      const resultado = await sql<OrcamentoDashboardRow>`
        WITH base AS (
          SELECT o.id, o.numero, o.titulo, o.status, o.cliente_id,
                 c.nome AS cliente_nome, o.total, o.criado_em, v.enviado_em,
                 LEAST(
                   v.expira_em,
                   ((o.data_emissao + o.validade_dias + 1)::timestamp AT TIME ZONE ${FUSO})
                 ) AS expira_em
          FROM orcamentos o
          JOIN clientes c ON c.id = o.cliente_id
          JOIN orcamento_versoes v
            ON v.orcamento_id = o.id AND v.versao = o.versao_atual
          WHERE o.tenant_id = ${tenantId}
            AND o.status = 'enviado'
        )
        SELECT * FROM base
        WHERE expira_em > ${filtro.agora} AND expira_em <= ${filtro.ate}
        ORDER BY expira_em ASC
        LIMIT ${filtro.limite}
      `.execute(db)

      return resultado.rows.map(mapRowDashboard)
    },

    async tempoDecisao(
      tenantId: string,
      intervalo: IntervaloDecisao,
    ): Promise<LinhaTempoDecisao[]> {
      // Aceite da versão vigente. `cancelado` com aceite vigente foi aprovado
      // antes (só enviado/aprovado cancelam e só decisões geram aceite), então
      // conta como aprovado, igual às séries por período. GROUPING SETS devolve
      // o total geral (resultado NULL) junto, já que medianas não se combinam.
      const resultado = await sql<TempoDecisaoRow>`
        WITH decisoes AS (
          SELECT CASE WHEN o.status = 'reprovado' THEN 'reprovado' ELSE 'aprovado' END AS resultado,
                 GREATEST(EXTRACT(EPOCH FROM (a.criado_em - v.enviado_em)) / 86400.0, 0) AS dias
          FROM orcamentos o
          JOIN orcamento_versoes v
            ON v.orcamento_id = o.id AND v.versao = o.versao_atual
          JOIN orcamento_aceites a ON a.versao_id = v.id
          WHERE o.tenant_id = ${tenantId}
            AND o.status IN ('aprovado', 'cancelado', 'reprovado')
            AND ${clausulaIntervalo('a.criado_em', intervalo)}
        )
        SELECT resultado,
               COUNT(*)::text AS quantidade,
               AVG(dias)::text AS media_dias,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY dias))::text AS mediana_dias
        FROM decisoes
        GROUP BY GROUPING SETS ((resultado), ())
      `.execute(db)

      return resultado.rows
        .filter((row) => Number(row.quantidade) > 0)
        .map((row) => ({
          resultado: row.resultado,
          quantidade: Number(row.quantidade),
          mediaDias: Number(row.media_dias),
          medianaDias: Number(row.mediana_dias),
        }))
    },
  }
}
