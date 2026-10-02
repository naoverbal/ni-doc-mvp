import type { Kysely } from 'kysely'
import type { Database } from '../types/database.js'

export interface CriarSessaoInput {
  usuarioId: string
  ip?: string
  userAgent?: string
  expiraEm: Date
}

export interface SessaoAtiva {
  id: string
  usuarioId: string
  expiraEm: Date
  ultimaAtividade: Date
}

export interface SessaoRepository {
  criar(input: CriarSessaoInput): Promise<{ id: string; expiraEm: Date }>
  buscarPorId(id: string): Promise<SessaoAtiva | null>
  invalidar(id: string): Promise<void>
  atualizarAtividade(id: string): Promise<void>
}

export function criarSessaoRepository(db: Kysely<Database>): SessaoRepository {
  return {
    async criar(input: CriarSessaoInput): Promise<{ id: string; expiraEm: Date }> {
      const row = await db
        .insertInto('sessoes')
        .values({
          usuario_id: input.usuarioId,
          ip: input.ip ?? null,
          user_agent: input.userAgent ?? null,
          expira_em: input.expiraEm,
        })
        .returning(['id', 'expira_em'])
        .executeTakeFirstOrThrow()

      return { id: row.id, expiraEm: row.expira_em }
    },

    async buscarPorId(id: string): Promise<SessaoAtiva | null> {
      const row = await db
        .selectFrom('sessoes')
        .select(['id', 'usuario_id', 'expira_em', 'ultima_atividade'])
        .where('id', '=', id)
        .executeTakeFirst()

      if (!row) return null

      return {
        id: row.id,
        usuarioId: row.usuario_id,
        expiraEm: row.expira_em,
        ultimaAtividade: row.ultima_atividade,
      }
    },

    async invalidar(id: string): Promise<void> {
      await db.deleteFrom('sessoes').where('id', '=', id).execute()
    },

    async atualizarAtividade(id: string): Promise<void> {
      await db
        .updateTable('sessoes')
        .set({ ultima_atividade: new Date() })
        .where('id', '=', id)
        .execute()
    },
  }
}
