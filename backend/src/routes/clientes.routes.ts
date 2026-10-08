import { Router } from 'express'
import type { Request } from 'express'
import type { AuthService } from '../services/auth.service.js'
import type {
  ClienteService,
  ClienteContexto,
  CriarClienteDados,
} from '../services/cliente.service.js'
import type { AtualizarClienteInput } from '../repositories/cliente.repository.js'
import {
  criarClienteSchema,
  atualizarClienteSchema,
  type CriarClientePayload,
  type AtualizarClientePayload,
} from '../schemas/cliente.schema.js'
import { validate } from '../middlewares/validate.js'
import { criarMiddlewareAuth } from '../middlewares/auth.js'

export function criarClientesRouter(
  clienteService: ClienteService,
  authService: AuthService,
): Router {
  const router = Router()
  const autenticar = criarMiddlewareAuth(authService)

  // Todas as rotas de cliente exigem autenticação.
  router.use(autenticar)

  function construirContexto(req: Request): ClienteContexto {
    return {
      tenantId: req.usuario.tenantId,
      usuarioId: req.usuario.id,
      ip: req.ip ?? undefined,
      userAgent: req.headers['user-agent'] ?? undefined,
    }
  }

  // GET /api/clientes?q=<termo> — autocomplete/busca por nome (ILIKE).
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
      const clientes = await clienteService.buscar(ctx, q)
      res.json(clientes)
    } catch (err) {
      next(err)
    }
  })

  // POST /api/clientes — cria cliente.
  router.post('/', validate(criarClienteSchema), async (req, res, next) => {
    try {
      const dados = req.body as CriarClientePayload
      const ctx = construirContexto(req)
      const cliente = await clienteService.criar(ctx, dados as CriarClienteDados)
      res.status(201).json(cliente)
    } catch (err) {
      next(err)
    }
  })

  // PUT /api/clientes/:id — edita cliente.
  router.put('/:id', validate(atualizarClienteSchema), async (req, res, next) => {
    try {
      const dados = req.body as AtualizarClientePayload
      const ctx = construirContexto(req)
      const id = req.params['id'] as string
      const cliente = await clienteService.atualizar(ctx, id, dados as AtualizarClienteInput)
      res.json(cliente)
    } catch (err) {
      next(err)
    }
  })

  // GET /api/clientes/:id — busca por id.
  router.get('/:id', async (req, res, next) => {
    try {
      const ctx = construirContexto(req)
      const id = req.params['id'] as string
      const cliente = await clienteService.buscarPorId(ctx, id)
      res.json(cliente)
    } catch (err) {
      next(err)
    }
  })

  return router
}
