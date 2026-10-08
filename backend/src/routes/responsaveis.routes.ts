import { Router } from 'express'
import type { Request } from 'express'
import type { AuthService } from '../services/auth.service.js'
import type {
  ResponsavelService,
  ResponsavelContexto,
  CriarResponsavelDados,
} from '../services/responsavel.service.js'
import type { AtualizarResponsavelInput } from '../repositories/responsavel.repository.js'
import {
  criarResponsavelSchema,
  atualizarResponsavelSchema,
  type CriarResponsavelPayload,
  type AtualizarResponsavelPayload,
} from '../schemas/responsavel.schema.js'
import { validate } from '../middlewares/validate.js'
import { criarMiddlewareAuth } from '../middlewares/auth.js'

export function criarResponsaveisRouter(
  responsavelService: ResponsavelService,
  authService: AuthService,
): Router {
  const router = Router()
  const autenticar = criarMiddlewareAuth(authService)

  // Todas as rotas de responsável técnico exigem autenticação.
  router.use(autenticar)

  function construirContexto(req: Request): ResponsavelContexto {
    return {
      tenantId: req.usuario.tenantId,
      usuarioId: req.usuario.id,
      ip: req.ip ?? undefined,
      userAgent: req.headers['user-agent'] ?? undefined,
    }
  }

  // GET /api/responsaveis?q=<termo> — autocomplete/busca por nome (ILIKE).
  router.get('/', async (req, res, next) => {
    try {
      const q = req.query['q']
      // Quando q está ausente/vazio, retornamos lista vazia sem chamar o service
      // (evita chamar buscar com termo undefined).
      if (typeof q !== 'string' || q.length === 0) {
        res.json([])
        return
      }

      const ctx = construirContexto(req)
      const responsaveis = await responsavelService.buscar(ctx, q)
      res.json(responsaveis)
    } catch (err) {
      next(err)
    }
  })

  // POST /api/responsaveis — cria responsável técnico.
  router.post('/', validate(criarResponsavelSchema), async (req, res, next) => {
    try {
      const dados = req.body as CriarResponsavelPayload
      const ctx = construirContexto(req)
      const responsavel = await responsavelService.criar(ctx, dados as CriarResponsavelDados)
      res.status(201).json(responsavel)
    } catch (err) {
      next(err)
    }
  })

  // PUT /api/responsaveis/:id — edita responsável técnico.
  router.put('/:id', validate(atualizarResponsavelSchema), async (req, res, next) => {
    try {
      const dados = req.body as AtualizarResponsavelPayload
      const ctx = construirContexto(req)
      const id = req.params['id'] as string
      const responsavel = await responsavelService.atualizar(
        ctx,
        id,
        dados as AtualizarResponsavelInput,
      )
      res.json(responsavel)
    } catch (err) {
      next(err)
    }
  })

  // GET /api/responsaveis/:id — busca por id.
  router.get('/:id', async (req, res, next) => {
    try {
      const ctx = construirContexto(req)
      const id = req.params['id'] as string
      const responsavel = await responsavelService.buscarPorId(ctx, id)
      res.json(responsavel)
    } catch (err) {
      next(err)
    }
  })

  return router
}
