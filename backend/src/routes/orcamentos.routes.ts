import { Router } from 'express'
import type { Request } from 'express'
import type { AuthService } from '../services/auth.service.js'
import type {
  OrcamentoService,
  OrcamentoContexto,
  CriarOrcamentoDados,
} from '../services/orcamento.service.js'
import type { VersionamentoService } from '../services/versionamento.service.js'
import {
  STATUS_ORCAMENTO,
  type AtualizarOrcamentoInput,
  type ListarOrcamentosFiltro,
  type OrcamentoStatus,
} from '../repositories/orcamento.repository.js'
import {
  criarOrcamentoSchema,
  atualizarOrcamentoSchema,
  type CriarOrcamentoPayload,
  type AtualizarOrcamentoPayload,
} from '../schemas/orcamento.schema.js'
import { validate } from '../middlewares/validate.js'
import { criarMiddlewareAuth } from '../middlewares/auth.js'
import { AppError } from '../errors/app-error.js'

export function criarOrcamentosRouter(
  orcamentoService: OrcamentoService,
  versionamentoService: VersionamentoService,
  authService: AuthService,
): Router {
  const router = Router()
  const autenticar = criarMiddlewareAuth(authService)

  // Todas as rotas de orçamento exigem autenticação.
  router.use(autenticar)

  function construirContexto(req: Request): OrcamentoContexto {
    return {
      tenantId: req.usuario.tenantId,
      usuarioId: req.usuario.id,
      ip: req.ip ?? undefined,
      userAgent: req.headers['user-agent'] ?? undefined,
    }
  }

  // POST /api/orcamentos — cria orçamento (rascunho).
  router.post('/', validate(criarOrcamentoSchema), async (req, res, next) => {
    try {
      const dados = req.body as CriarOrcamentoPayload
      const ctx = construirContexto(req)
      const orcamento = await orcamentoService.criar(ctx, dados as CriarOrcamentoDados)
      res.status(201).json(orcamento)
    } catch (err) {
      next(err)
    }
  })

  // GET /api/orcamentos — lista orçamentos do tenant (paginação + filtro por status).
  router.get('/', async (req, res, next) => {
    try {
      const filtro: ListarOrcamentosFiltro = {}

      const statusParam = req.query['status']
      if (statusParam !== undefined) {
        if (!STATUS_ORCAMENTO.includes(statusParam as OrcamentoStatus)) {
          next(new AppError(400, 'status inválido'))
          return
        }
        filtro.status = statusParam as OrcamentoStatus
      }

      const paginaParam = req.query['pagina']
      if (paginaParam !== undefined) {
        const pagina = Number(paginaParam)
        if (!Number.isInteger(pagina) || pagina < 1) {
          next(new AppError(400, 'pagina inválida'))
          return
        }
        filtro.pagina = pagina
      }

      const tamanhoPaginaParam = req.query['tamanhoPagina']
      if (tamanhoPaginaParam !== undefined) {
        const tamanhoPagina = Number(tamanhoPaginaParam)
        if (!Number.isInteger(tamanhoPagina) || tamanhoPagina < 1) {
          next(new AppError(400, 'tamanhoPagina inválido'))
          return
        }
        filtro.tamanhoPagina = tamanhoPagina
      }

      const ctx = construirContexto(req)
      const lista = await orcamentoService.listar(ctx, filtro)
      res.json(lista)
    } catch (err) {
      next(err)
    }
  })

  // PUT /api/orcamentos/:id — atualiza orçamento (409 de não-rascunho vem do service).
  router.put('/:id', validate(atualizarOrcamentoSchema), async (req, res, next) => {
    try {
      const dados = req.body as AtualizarOrcamentoPayload
      const ctx = construirContexto(req)
      const id = req.params['id'] as string
      const orcamento = await orcamentoService.atualizar(ctx, id, dados as AtualizarOrcamentoInput)
      res.json(orcamento)
    } catch (err) {
      next(err)
    }
  })

  // DELETE /api/orcamentos/:id — deleta orçamento (409 de não-rascunho vem do service).
  router.delete('/:id', async (req, res, next) => {
    try {
      const ctx = construirContexto(req)
      const id = req.params['id'] as string
      await orcamentoService.deletar(ctx, id)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  })

  // POST /api/orcamentos/:id/enviar — versiona e envia o rascunho (400/404/409 vêm do service).
  router.post('/:id/enviar', async (req, res, next) => {
    try {
      const ctx = construirContexto(req)
      const id = req.params['id'] as string
      const versao = await versionamentoService.enviar(ctx, id)
      res.status(201).json(versao)
    } catch (err) {
      next(err)
    }
  })

  // GET /api/orcamentos/:id — busca por id (com itens).
  router.get('/:id', async (req, res, next) => {
    try {
      const ctx = construirContexto(req)
      const id = req.params['id'] as string
      const orcamento = await orcamentoService.buscarPorId(ctx, id)
      res.json(orcamento)
    } catch (err) {
      next(err)
    }
  })

  return router
}
