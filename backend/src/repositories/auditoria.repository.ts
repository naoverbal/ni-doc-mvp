import type { Kysely } from 'kysely'
import type { Database, EventoAuditoriaTable } from '../types/database.js'
import type { Selectable } from 'kysely'

export type EventoAuditoria = Selectable<EventoAuditoriaTable>

export interface CriarEventoInput {
  tenantId: string
  usuarioId?: string
  acao: string
  entidade: string
  entidadeId?: string
  estadoAnterior?: unknown
  estadoNovo?: unknown
  ip?: string
  userAgent?: string
}

export interface FiltroAuditoria {
  tenantId: string
  entidade?: string
  entidadeId?: string
  usuarioId?: string
  de?: Date
  ate?: Date
  pagina?: number
  limite?: number
}

export interface AuditoriaRepository {
  criar(input: CriarEventoInput): Promise<{ id: string }>
  listar(filtro: FiltroAuditoria): Promise<EventoAuditoria[]>
}

export function criarAuditoriaRepository(db: Kysely<Database>): AuditoriaRepository {
  return {
    async criar(input: CriarEventoInput): Promise<{ id: string }> {
      const row = await db
        .insertInto('eventos_auditoria')
        .values({
          tenant_id: input.tenantId,
          usuario_id: input.usuarioId ?? null,
          acao: input.acao,
          entidade: input.entidade,
          entidade_id: input.entidadeId ?? null,
          estado_anterior:
            input.estadoAnterior !== undefined ? JSON.stringify(input.estadoAnterior) : null,
          estado_novo: input.estadoNovo !== undefined ? JSON.stringify(input.estadoNovo) : null,
          ip: input.ip ?? null,
          user_agent: input.userAgent ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      return { id: row.id }
    },

    async listar(filtro: FiltroAuditoria): Promise<EventoAuditoria[]> {
      let query = db
        .selectFrom('eventos_auditoria')
        .selectAll()
        .where('tenant_id', '=', filtro.tenantId)
        .orderBy('criado_em', 'desc')

      if (filtro.entidade !== undefined) {
        query = query.where('entidade', '=', filtro.entidade)
      }
      if (filtro.entidadeId !== undefined) {
        query = query.where('entidade_id', '=', filtro.entidadeId)
      }
      if (filtro.usuarioId !== undefined) {
        query = query.where('usuario_id', '=', filtro.usuarioId)
      }
      if (filtro.de !== undefined) {
        query = query.where('criado_em', '>=', filtro.de)
      }
      if (filtro.ate !== undefined) {
        query = query.where('criado_em', '<=', filtro.ate)
      }

      const pagina = filtro.pagina ?? 1
      const limite = filtro.limite ?? 50
      query = query.limit(limite).offset((pagina - 1) * limite)

      return query.execute()
    },
  }
}
