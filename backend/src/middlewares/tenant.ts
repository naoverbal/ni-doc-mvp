import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { Kysely } from 'kysely'
import type { Database } from '../types/database.js'
import { sql } from 'kysely'

export function criarMiddlewareTenant(db: Kysely<Database>): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const tenantId = req.usuario.tenantId
    await db.executeQuery(
      sql`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`.compile(db),
    )
    next()
  }
}
