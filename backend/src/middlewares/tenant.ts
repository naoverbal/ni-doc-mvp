import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { executarComTenant } from '../config/database.js'

/**
 * Middleware de isolamento de tenant (multi-tenancy via RLS — RF-002).
 *
 * Propagação do tenant (design §4.3 / Correctness Property #1):
 * cada requisição autenticada fixa uma conexão dedicada e define
 * `app.current_tenant` com o `tenantId` do usuário logado. As policies de RLS
 * do PostgreSQL (migration 002) leem essa configuração via
 * `current_setting('app.current_tenant')` para filtrar automaticamente todas as
 * linhas por tenant — no banco, não só no filtro aplicacional.
 *
 * Mecânica (ver `config/database.ts`):
 * `executarComTenant` abre um escopo (`AsyncLocalStorage`) com uma conexão
 * fixada, roda `set_config('app.current_tenant', <uuid>)` nela e a mantém presa
 * por toda a vida do request. O driver customizado do Kysely roteia TODAS as
 * queries dos repositórios para essa conexão, de modo que o GUC permanece ativo
 * de ponta a ponta. O escopo é fechado (conexão devolvida ao pool, GUC
 * resetado) quando a resposta termina.
 *
 * Deve ser registrado SEMPRE após o middleware de autenticação, pois depende de
 * `req.usuario.tenantId`.
 */
export function criarMiddlewareTenant(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const tenantId = req.usuario.tenantId

    // Mantém o escopo (e a conexão fixada) aberto até a resposta terminar.
    // `executarComTenant` só resolve quando a Promise interna resolve, o que
    // acontece no evento `finish`/`close` da resposta — garantindo que a
    // conexão não seja devolvida ao pool enquanto handlers ainda a usam.
    void executarComTenant(tenantId, () => {
      return new Promise<void>((resolve) => {
        res.on('finish', resolve)
        res.on('close', resolve)
        next()
      })
    }).catch(next)
  }
}

// Alias semântico usado no design/tasks ("setTenant").
export const setTenant = criarMiddlewareTenant
