import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'
import type { Database } from '../types/database.js'
import { AppError } from '../errors/app-error.js'

// -----------------------------------------------------------------------------
// Repositório dos aceites de orçamento (tabela orcamento_aceites). Dono do SQL
// do aceite: registra a evidência imutável (IP, user agent, hash do documento,
// método, operador responsável, justificativa) e, na MESMA transação, marca o
// orçamento como `aprovado` — garantindo atomicidade (sem aceite órfão nem
// status divergente). O UNIQUE (versao_id) do schema é a rede de segurança final
// contra aceite duplicado; aqui a corrida é serializada por advisory lock e a
// duplicidade é rejeitada antecipadamente com AppError(409). (RF-019, RF-020)
// -----------------------------------------------------------------------------

export interface RegistrarAceiteInput {
  tenantId: string
  versaoId: string
  metodo: 'cliente' | 'operador'
  usuarioId?: string
  ip?: string
  userAgent?: string
  hashDocumento: string
  justificativa?: string
}

export interface AceitePublico {
  id: string
  versaoId: string
  metodo: 'cliente' | 'operador'
  usuarioId: string | null
  ip: string | null
  userAgent: string | null
  hashDocumento: string
  justificativa: string | null
  criadoEm: Date
}

export interface OrcamentoAceiteRepository {
  // Transação atômica: serializa a corrida por advisory lock, relê o status do
  // orçamento ligado à versão, rejeita se o orçamento já estiver `aprovado`
  // (duplicado → 409) ou se a versão/orçamento não existir (409), insere o
  // aceite e marca `orcamentos.status = 'aprovado'` filtrando por tenant_id.
  aprovarAceite(input: RegistrarAceiteInput): Promise<AceitePublico>
  buscarPorVersao(versaoId: string): Promise<AceitePublico | null>
}

// -----------------------------------------------------------------------------
// Linha do banco (snake_case).
// -----------------------------------------------------------------------------
interface OrcamentoAceiteRow {
  id: string
  versao_id: string
  metodo: 'cliente' | 'operador'
  usuario_id: string | null
  ip: string | null
  user_agent: string | null
  hash_documento: string
  justificativa: string | null
  criado_em: Date
}

function mapRowAceite(row: OrcamentoAceiteRow): AceitePublico {
  return {
    id: row.id,
    versaoId: row.versao_id,
    metodo: row.metodo,
    usuarioId: row.usuario_id,
    ip: row.ip,
    userAgent: row.user_agent,
    hashDocumento: row.hash_documento,
    justificativa: row.justificativa,
    criadoEm: row.criado_em,
  }
}

const COLUNAS_ACEITE = [
  'id',
  'versao_id',
  'metodo',
  'usuario_id',
  'ip',
  'user_agent',
  'hash_documento',
  'justificativa',
  'criado_em',
] as const

// Serializa a aprovação por versão (mesmo padrão de `proximaVersaoSequencial`):
// advisory lock transacional por versao_id, liberado no commit/rollback. Em
// seguida relê o status do orçamento ligado à versão (filtrando por tenant_id,
// respeitando o isolamento), travando contra aceites concorrentes.
async function lerStatusOrcamento(
  trx: Transaction<Database>,
  tenantId: string,
  versaoId: string,
): Promise<string | null> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${versaoId}))`.execute(trx)

  const resultado = await sql<{ status: string }>`
      SELECT o.status AS status
      FROM orcamento_versoes v
      JOIN orcamentos o ON o.id = v.orcamento_id
      WHERE v.id = ${versaoId} AND o.tenant_id = ${tenantId}
    `.execute(trx)

  return resultado.rows[0]?.status ?? null
}

export function criarOrcamentoAceiteRepository(deps: {
  db: Kysely<Database>
}): OrcamentoAceiteRepository {
  const { db } = deps

  return {
    async aprovarAceite(input: RegistrarAceiteInput): Promise<AceitePublico> {
      return db.transaction().execute(async (trx) => {
        const status = await lerStatusOrcamento(trx, input.tenantId, input.versaoId)

        if (status === null) {
          throw new AppError(409, 'Versão do orçamento não encontrada para aceite')
        }
        // Duplicado: um orçamento já aprovado não aceita novo aceite (RF-019.6).
        if (status === 'aprovado') {
          throw new AppError(409, 'Orçamento já aprovado')
        }

        const row = await trx
          .insertInto('orcamento_aceites')
          .values({
            versao_id: input.versaoId,
            metodo: input.metodo,
            usuario_id: input.usuarioId ?? null,
            ip: input.ip ?? null,
            user_agent: input.userAgent ?? null,
            hash_documento: input.hashDocumento,
            justificativa: input.justificativa ?? null,
          })
          .returning(COLUNAS_ACEITE)
          .executeTakeFirstOrThrow()

        await trx
          .updateTable('orcamentos')
          .set({ status: 'aprovado', atualizado_em: new Date() })
          .where('tenant_id', '=', input.tenantId)
          .where('id', '=', (eb) =>
            eb
              .selectFrom('orcamento_versoes')
              .select('orcamento_id')
              .where('id', '=', input.versaoId),
          )
          .execute()

        return mapRowAceite(row as OrcamentoAceiteRow)
      })
    },

    async buscarPorVersao(versaoId: string): Promise<AceitePublico | null> {
      const row = await db
        .selectFrom('orcamento_aceites')
        .select(COLUNAS_ACEITE)
        .where('versao_id', '=', versaoId)
        .executeTakeFirst()

      if (!row) return null
      return mapRowAceite(row as OrcamentoAceiteRow)
    },
  }
}
