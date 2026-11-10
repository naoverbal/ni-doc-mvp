import { Router } from 'express'
import type { Request } from 'express'
import type { ZodType } from 'zod'
import type { AuthService } from '../services/auth.service.js'
import type { DashboardService, DashboardContexto } from '../services/dashboard.service.js'
import { criadosQuerySchema, limiteQuerySchema } from '../schemas/dashboard.schema.js'
import { criarMiddlewareAuth } from '../middlewares/auth.js'
import { setTenant } from '../middlewares/tenant.js'
import { AppError } from '../errors/app-error.js'

// Valida `req.query` com Zod; 400 com os detalhes quando inválido.
function lerQuery<T>(schema: ZodType<T>, req: Request): T {
  const resultado = schema.safeParse(req.query)
  if (!resultado.success) {
    throw new AppError(400, 'Parâmetros de consulta inválidos', resultado.error.issues)
  }
  return resultado.data
}

export function criarDashboardRouter(
  dashboardService: DashboardService,
  authService: AuthService,
): Router {
  const router = Router()
  const autenticar = criarMiddlewareAuth(authService)

  // Somente leitura, escopo do tenant do usuário logado (RLS).
  router.use(autenticar)
  router.use(setTenant())

  function construirContexto(req: Request): DashboardContexto {
    return { tenantId: req.usuario.tenantId }
  }

  // GET /api/dashboard/resumo — contagem e soma por status, valores e conversão.
  router.get('/resumo', async (req, res, next) => {
    try {
      res.json(await dashboardService.resumo(construirContexto(req)))
    } catch (err) {
      next(err)
    }
  })

  // GET /api/dashboard/criados?granularidade=&de=&ate= — orçamentos criados por período.
  router.get('/criados', async (req, res, next) => {
    try {
      const filtro = lerQuery(criadosQuerySchema, req)
      res.json(await dashboardService.criadosPorPeriodo(construirContexto(req), filtro))
    } catch (err) {
      next(err)
    }
  })

  // GET /api/dashboard/recentes?limite= — últimos orçamentos criados.
  router.get('/recentes', async (req, res, next) => {
    try {
      const { limite } = lerQuery(limiteQuerySchema, req)
      res.json(await dashboardService.recentes(construirContexto(req), limite))
    } catch (err) {
      next(err)
    }
  })

  // GET /api/dashboard/pendentes?limite= — `enviado` aguardando há mais tempo.
  router.get('/pendentes', async (req, res, next) => {
    try {
      const { limite } = lerQuery(limiteQuerySchema, req)
      res.json(await dashboardService.pendentes(construirContexto(req), limite))
    } catch (err) {
      next(err)
    }
  })

  return router
}
