import { Router } from 'express'
import type { Request } from 'express'
import type { AuthService } from '../services/auth.service.js'
import type { TemplateService, TemplateContexto } from '../services/template.service.js'
import type { LayoutTemplate } from '../repositories/template.repository.js'
import {
  atualizarTemplateSchema,
  type AtualizarTemplatePayload,
} from '../schemas/template.schema.js'
import { validate } from '../middlewares/validate.js'
import { criarMiddlewareAuth, criarMiddlewareExigirPapel } from '../middlewares/auth.js'

export function criarTemplatesRouter(
  templateService: TemplateService,
  authService: AuthService,
): Router {
  const router = Router()
  const autenticar = criarMiddlewareAuth(authService)
  const exigirAdmin = criarMiddlewareExigirPapel('admin')

  // Todas as rotas de template exigem autenticação.
  router.use(autenticar)

  function construirContexto(req: Request): TemplateContexto {
    return {
      tenantId: req.usuario.tenantId,
      usuarioId: req.usuario.id,
      ip: req.ip ?? undefined,
      userAgent: req.headers['user-agent'] ?? undefined,
    }
  }

  // GET /api/templates/atual — retorna a versão ativa do tenant.
  router.get('/atual', async (req, res, next) => {
    try {
      const ctx = construirContexto(req)
      const template = await templateService.buscarAtivo(ctx)
      res.json(template)
    } catch (err) {
      next(err)
    }
  })

  // PUT /api/templates/atual — cria uma nova versão do template (apenas admin).
  // O middleware de papel vem antes de validate para barrar o operador sem
  // sequer inspecionar o body.
  router.put('/atual', exigirAdmin, validate(atualizarTemplateSchema), async (req, res, next) => {
    try {
      const dados = req.body as AtualizarTemplatePayload
      const ctx = construirContexto(req)
      const template = await templateService.salvar(ctx, dados.layoutJson as LayoutTemplate)
      res.json(template)
    } catch (err) {
      next(err)
    }
  })

  return router
}
