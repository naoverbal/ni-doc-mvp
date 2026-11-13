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

export const LIMITE_MAXIMO_AUDITORIA = 200

/**
 * Evento de auditoria gravado na MESMA transação da operação auditada. Recebe o
 * resultado da operação (ex.: o orçamento criado, o status anterior) e devolve o
 * evento. Se a gravação falhar, a transação inteira reverte: "tudo ou nada".
 */
export type AuditoriaNaTransacao<R = void> = (resultado: R) => CriarEventoInput

/**
 * Insere o evento usando o executor informado (uma `Transaction` ou o próprio
 * `db`). É o ponto único de escrita em `eventos_auditoria`.
 */
export async function inserirEventoAuditoria(
  executor: Kysely<Database>,
  input: CriarEventoInput,
): Promise<{ id: string }> {
  const row = await executor
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
}

/**
 * Executa `operacao` e grava a auditoria na MESMA transação. Sem `auditoria`,
 * roda direto no `db` (sem abrir transação). Se `operacao` devolver `null`
 * ("nada afetado"), nenhum evento é gravado. Qualquer falha reverte tudo.
 */
export async function executarComAuditoria<R>(
  db: Kysely<Database>,
  auditoria: AuditoriaNaTransacao<R extends null ? never : R> | undefined,
  operacao: (executor: Kysely<Database>) => Promise<R>,
): Promise<R> {
  if (!auditoria) {
    return operacao(db)
  }
  return db.transaction().execute(async (trx) => {
    const resultado = await operacao(trx)
    if (resultado !== null) {
      await inserirEventoAuditoria(trx, auditoria(resultado as R extends null ? never : R))
    }
    return resultado
  })
}

export interface AuditoriaRepository {
  criar(input: CriarEventoInput): Promise<{ id: string }>
  listar(filtro: FiltroAuditoria): Promise<EventoAuditoria[]>
}

export function criarAuditoriaRepository(db: Kysely<Database>): AuditoriaRepository {
  return {
    async criar(input: CriarEventoInput): Promise<{ id: string }> {
      return inserirEventoAuditoria(db, input)
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
      // Teto de linhas por consulta (a listagem não tinha limite máximo).
      const limite = Math.min(filtro.limite ?? 50, LIMITE_MAXIMO_AUDITORIA)
      query = query.limit(limite).offset((pagina - 1) * limite)

      return query.execute()
    },
  }
}
