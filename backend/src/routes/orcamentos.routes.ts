import { Router } from 'express'
import type { Request } from 'express'
import type { AuthService } from '../services/auth.service.js'
import type {
  OrcamentoService,
  OrcamentoContexto,
  CriarOrcamentoDados,
} from '../services/orcamento.service.js'
import type { VersionamentoService } from '../services/versionamento.service.js'
import { aceiteParaResposta, type AceiteService } from '../services/aceite.service.js'
import type { CancelamentoService } from '../services/cancelamento.service.js'
import type { ReaberturaService } from '../services/reabertura.service.js'
import {
  STATUS_ORCAMENTO,
  type AtualizarOrcamentoInput,
  type ListarOrcamentosFiltro,
  type OrcamentoStatus,
} from '../repositories/orcamento.repository.js'
import {
  criarOrcamentoSchema,
  atualizarOrcamentoSchema,
  aceiteManualSchema,
  cancelarOrcamentoSchema,
  reabrirOrcamentoSchema,
  type CancelarOrcamentoPayload,
  type ReabrirOrcamentoPayload,
  type CriarOrcamentoPayload,
  type AtualizarOrcamentoPayload,
  type AceiteManualPayload,
} from '../schemas/orcamento.schema.js'
import { validate } from '../middlewares/validate.js'
import { criarMiddlewareAuth } from '../middlewares/auth.js'
import { setTenant } from '../middlewares/tenant.js'
import { validarIdParam } from '../middlewares/validar-id.js'
import { criarConfirmacaoSenhaRateLimit } from '../middlewares/rate-limit.js'
import { AppError } from '../errors/app-error.js'

export function criarOrcamentosRouter(
  orcamentoService: OrcamentoService,
  versionamentoService: VersionamentoService,
  aceiteService: AceiteService,
  authService: AuthService,
  cancelamentoService: CancelamentoService,
  reaberturaService: ReaberturaService,
): Router {
  const router = Router()
  // Limite de tentativas de senha por usuário, COMPARTILHADO por cancelar e
  // reabrir (as duas reconfirmam a senha; separar dobraria a cota de tentativas).
  const limiteConfirmacaoSenha = criarConfirmacaoSenhaRateLimit()
  const autenticar = criarMiddlewareAuth(authService)

  // Todas as rotas de orçamento exigem autenticação e isolamento por tenant (RLS).
  router.use(autenticar)
  router.use(setTenant())
  // Rotas /:id só aceitam UUID (400 em vez de erro cru do Postgres).
  router.param('id', validarIdParam)

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

  // DELETE /api/orcamentos/:id — exclui o rascunho (409 de não-rascunho vem do service).
  // 204 se nunca foi enviado; 200 com o orçamento restaurado se era um rascunho reaberto.
  router.delete('/:id', async (req, res, next) => {
    try {
      const ctx = construirContexto(req)
      const id = req.params['id'] as string
      const restaurado = await orcamentoService.deletar(ctx, id)
      if (restaurado === null) {
        res.status(204).end()
        return
      }
      // Rascunho reaberto: o orçamento continua existindo (voltou ao último status).
      res.json(restaurado)
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

  // POST /api/orcamentos/:id/aceite-manual — registra aceite manual pelo operador
  // (RF-020). Exige justificativa (Zod), registra o operador (req.usuario) como
  // responsável e muda o status para `aprovado`. 400/404/409 vêm do service.
  router.post('/:id/aceite-manual', validate(aceiteManualSchema), async (req, res, next) => {
    try {
      const { justificativa } = req.body as AceiteManualPayload
      const id = req.params['id'] as string
      const aceite = await aceiteService.aceiteManual({
        tenantId: req.usuario.tenantId,
        orcamentoId: id,
        usuarioId: req.usuario.id,
        justificativa,
        ip: req.ip ?? undefined,
        userAgent: req.headers['user-agent'] ?? undefined,
      })
      res.status(201).json(aceiteParaResposta(aceite))
    } catch (err) {
      next(err)
    }
  })

  // POST /api/orcamentos/:id/cancelar — cancela um orçamento enviado/aprovado.
  // Exige senha do usuário logado (403 se errada; rate limit por usuário) e
  // justificativa. 400/404/409 vêm do service/repositório.
  router.post(
    '/:id/cancelar',
    validate(cancelarOrcamentoSchema),
    limiteConfirmacaoSenha,
    async (req, res, next) => {
      try {
        const { senha, justificativa } = req.body as CancelarOrcamentoPayload
        const id = req.params['id'] as string
        const ctx = construirContexto(req)
        const orcamento = await cancelamentoService.cancelar(ctx, id, { senha, justificativa })
        res.json(orcamento)
      } catch (err) {
        next(err)
      }
    },
  )

  // POST /api/orcamentos/:id/reabrir — reabre um orçamento reprovado/cancelado/
  // expirado como rascunho (a versão N+1 nasce no próximo /enviar). Exige senha do
  // usuário logado (403 se errada; mesmo rate limit do cancelamento) e justificativa.
  router.post(
    '/:id/reabrir',
    validate(reabrirOrcamentoSchema),
    limiteConfirmacaoSenha,
    async (req, res, next) => {
      try {
        const { senha, justificativa } = req.body as ReabrirOrcamentoPayload
        const id = req.params['id'] as string
        const ctx = construirContexto(req)
        const orcamento = await reaberturaService.reabrir(ctx, id, { senha, justificativa })
        res.json(orcamento)
      } catch (err) {
        next(err)
      }
    },
  )

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
