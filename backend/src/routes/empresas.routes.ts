import { Router } from 'express'
import type { Request } from 'express'
import type { AuthService } from '../services/auth.service.js'
import type {
  EmpresaService,
  EmpresaContexto,
  CriarEmpresaDados,
} from '../services/empresa.service.js'
import type { AtualizarEmpresaInput } from '../repositories/empresa.repository.js'
import {
  criarEmpresaSchema,
  atualizarEmpresaSchema,
  type CriarEmpresaPayload,
  type AtualizarEmpresaPayload,
} from '../schemas/empresa.schema.js'
import { validate } from '../middlewares/validate.js'
import { criarMiddlewareAuth } from '../middlewares/auth.js'
import { AppError } from '../errors/app-error.js'

const TIPOS_EMPRESA = ['tenant', 'cliente_pj'] as const
type TipoEmpresa = (typeof TIPOS_EMPRESA)[number]

export function criarEmpresasRouter(
  empresaService: EmpresaService,
  authService: AuthService,
): Router {
  const router = Router()
  const autenticar = criarMiddlewareAuth(authService)

  // Todas as rotas de empresa exigem autenticação.
  router.use(autenticar)

  function construirContexto(req: Request): EmpresaContexto {
    return {
      tenantId: req.usuario.tenantId,
      usuarioId: req.usuario.id,
      ip: req.ip ?? undefined,
      userAgent: req.headers['user-agent'] ?? undefined,
    }
  }

  // GET /api/empresas?q=<termo>&tipo=<tipo> — autocomplete/busca por razão social (ILIKE),
  // filtrado por tipo. tipo assume 'cliente_pj' por padrão (RF-011.2).
  router.get('/', async (req, res, next) => {
    try {
      const q = req.query['q']
      // Quando q está ausente/vazio, retornamos lista vazia sem chamar o service.
      if (typeof q !== 'string' || q.length === 0) {
        res.json([])
        return
      }

      const tipoParam = req.query['tipo']
      let tipo: TipoEmpresa = 'cliente_pj'
      if (tipoParam !== undefined) {
        if (!TIPOS_EMPRESA.includes(tipoParam as TipoEmpresa)) {
          next(new AppError(400, 'tipo inválido'))
          return
        }
        tipo = tipoParam as TipoEmpresa
      }

      const ctx = construirContexto(req)
      const empresas = await empresaService.buscar(ctx, q, tipo)
      res.json(empresas)
    } catch (err) {
      next(err)
    }
  })

  // POST /api/empresas — cria empresa.
  router.post('/', validate(criarEmpresaSchema), async (req, res, next) => {
    try {
      const dados = req.body as CriarEmpresaPayload
      const ctx = construirContexto(req)
      const empresa = await empresaService.criar(ctx, dados as CriarEmpresaDados)
      res.status(201).json(empresa)
    } catch (err) {
      next(err)
    }
  })

  // PUT /api/empresas/:id — edita empresa.
  router.put('/:id', validate(atualizarEmpresaSchema), async (req, res, next) => {
    try {
      const dados = req.body as AtualizarEmpresaPayload
      const ctx = construirContexto(req)
      const id = req.params['id'] as string
      const empresa = await empresaService.atualizar(ctx, id, dados as AtualizarEmpresaInput)
      res.json(empresa)
    } catch (err) {
      next(err)
    }
  })

  // GET /api/empresas/:id — busca por id.
  router.get('/:id', async (req, res, next) => {
    try {
      const ctx = construirContexto(req)
      const id = req.params['id'] as string
      const empresa = await empresaService.buscarPorId(ctx, id)
      res.json(empresa)
    } catch (err) {
      next(err)
    }
  })

  return router
}
