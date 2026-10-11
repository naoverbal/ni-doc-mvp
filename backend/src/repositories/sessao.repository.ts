import type { Kysely } from 'kysely'
import { sql } from 'kysely'
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

// O ciclo de vida da sessão é um fluxo de BOOTSTRAP: ocorre nas rotas
// `/api/auth/*` (sem `setTenant`) e na validação de sessão (antes do tenant ser
// definido). Como `sessoes` tem RLS forçado, essas operações seriam barradas
// para o papel não-privilegiado sem `app.current_tenant`. Por isso cada
// operação delega a uma função SECURITY DEFINER (migration 004), que executa a
// busca/escrita estrita por chave contornando o RLS apenas nesses pontos.
export function criarSessaoRepository(db: Kysely<Database>): SessaoRepository {
  return {
    async criar(input: CriarSessaoInput): Promise<{ id: string; expiraEm: Date }> {
      const resultado = await sql<{ id: string; expira_em: Date }>`
        SELECT * FROM rls_criar_sessao(
          ${input.usuarioId},
          ${input.ip ?? null},
          ${input.userAgent ?? null},
          ${input.expiraEm}
        )
      `.execute(db)

      const row = resultado.rows[0]
      if (!row) throw new Error('Falha ao criar sessão')
      return { id: row.id, expiraEm: row.expira_em }
    },

    async buscarPorId(id: string): Promise<SessaoAtiva | null> {
      const resultado = await sql<{
        id: string
        usuario_id: string
        expira_em: Date
        ultima_atividade: Date
      }>`SELECT * FROM rls_sessao_por_id(${id})`.execute(db)

      const row = resultado.rows[0]
      if (!row) return null

      return {
        id: row.id,
        usuarioId: row.usuario_id,
        expiraEm: row.expira_em,
        ultimaAtividade: row.ultima_atividade,
      }
    },

    async invalidar(id: string): Promise<void> {
      await sql`SELECT rls_invalidar_sessao(${id})`.execute(db)
    },

    async atualizarAtividade(id: string): Promise<void> {
      await sql`SELECT rls_tocar_sessao(${id})`.execute(db)
    },
  }
}
