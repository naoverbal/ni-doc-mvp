import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { Database } from '../types/database.js'

/**
 * Middleware de isolamento de tenant (multi-tenancy via RLS).
 *
 * Propagação do tenant (design §4.3 / Correctness Property #1):
 * cada requisição autenticada define `app.current_tenant` com o `tenantId`
 * do usuário logado. As policies de RLS do PostgreSQL (migration 002) leem
 * essa configuração via `current_setting('app.current_tenant')` para filtrar
 * automaticamente todas as linhas por tenant, sem necessidade de `WHERE
 * tenant_id` explícito nas queries do Kysely.
 *
 * Observação sobre o escopo da configuração:
 * `set_config(..., true)` aplica o valor como *transaction-local* (equivalente
 * a `SET LOCAL`). A verificação ponta-a-ponta com Postgres real (garantir que
 * a conexão/transação do request carrega o setting até os repositories) fica
 * para os testes de integração. Aqui a responsabilidade do middleware é
 * executar o `set_config` com o tenant correto antes de seguir o pipeline.
 *
 * Deve ser registrado SEMPRE após o middleware de autenticação, pois depende
 * de `req.usuario.tenantId`.
 */
export function criarMiddlewareTenant(db: Kysely<Database>): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const tenantId = req.usuario.tenantId

    await db.executeQuery(
      sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`.compile(db),
    )

    next()
  }
}

// Alias semântico usado no design/tasks ("setTenant").
export const setTenant = criarMiddlewareTenant
