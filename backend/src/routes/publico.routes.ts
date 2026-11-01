import { Router } from 'express'
import type { Request, Response } from 'express'
import {
  aceiteParaResposta,
  type AceiteRegistrado,
  type AceiteResposta,
  type AceiteService,
} from '../services/aceite.service.js'
import { reprovarPublicoSchema, type ReprovarPublicoPayload } from '../schemas/publico.schema.js'
import { validate } from '../middlewares/validate.js'
import { criarPublicoRateLimit } from '../middlewares/rate-limit.js'

// -----------------------------------------------------------------------------
// Rotas públicas do orçamento (RF-019). Acessadas pelo CLIENTE FINAL via o link
// com token público (uuid.hmac), portanto SEM autenticação e SEM middleware de
// tenant — o token é a credencial e já escopa o acesso a uma única versão. O
// isolamento por tenant é garantido no repositório (que resolve o tenant a
// partir da versão) e, após a Fase 13, pelo RLS. Rate limiting é aplicado a
// todo o router para conter abuso/força bruta de token.
//
//  - GET    /orcamento/:token          → snapshot + integridade + URL do PDF.
//  - POST   /orcamento/:token/aprovar  → registra o aceite (gera comprovante).
//  - POST   /orcamento/:token/reprovar → registra a reprovação (sem comprovante).
//
// Status de token (decisão da tarefa 42): inválido/desconhecido → 404,
// expirado → 410. Esses códigos vêm do serviço de aceite.
// -----------------------------------------------------------------------------

export function criarPublicoRouter(aceiteService: AceiteService): Router {
  const router = Router()

  // Rate limiting em todas as rotas públicas (sem auth).
  router.use(criarPublicoRateLimit())

  // Evidências do cliente final capturadas da requisição (RF-019).
  function evidencias(req: Request): { ip?: string; userAgent?: string } {
    return {
      ip: req.ip ?? undefined,
      userAgent: req.headers['user-agent'] ?? undefined,
    }
  }

  // Envia bytes de PDF inline (para o <iframe> da página de aceite). `no-store`:
  // o documento é credencial-dependente (token) e não deve ficar em cache
  // compartilhado. O nome do arquivo é fixo; nada do disco vaza no cabeçalho.
  function enviarPdf(res: Response, pdf: Buffer, nome: string): void {
    res
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${nome}.pdf"`,
        'Cache-Control': 'private, no-store',
      })
      .send(pdf)
  }

  // Resposta pública do aceite: sem o caminho de disco do comprovante, com a URL
  // pública da rota GET /comprovante (null quando não há comprovante).
  function respostaPublica(
    aceite: AceiteRegistrado,
    token: string,
  ): AceiteResposta & { comprovanteUrl: string | null } {
    return {
      ...aceiteParaResposta(aceite),
      comprovanteUrl:
        aceite.comprovantePdfPath !== null ? `/api/publico/orcamento/${token}/comprovante` : null,
    }
  }

  // GET /api/publico/orcamento/:token — visualiza o orçamento (sem auth).
  router.get('/orcamento/:token', async (req, res, next) => {
    try {
      const token = req.params['token'] as string
      const visualizacao = await aceiteService.visualizarPorToken(token)
      res.json(visualizacao)
    } catch (err) {
      next(err)
    }
  })

  // GET /api/publico/orcamento/:token/pdf — PDF oficial da versão (sem auth).
  router.get('/orcamento/:token/pdf', async (req, res, next) => {
    try {
      const token = req.params['token'] as string
      enviarPdf(res, await aceiteService.obterPdfPorToken(token), 'orcamento')
    } catch (err) {
      next(err)
    }
  })

  // GET /api/publico/orcamento/:token/comprovante — comprovante de aceite (sem auth).
  router.get('/orcamento/:token/comprovante', async (req, res, next) => {
    try {
      const token = req.params['token'] as string
      enviarPdf(res, await aceiteService.obterComprovantePorToken(token), 'comprovante-aceite')
    } catch (err) {
      next(err)
    }
  })

  // POST /api/publico/orcamento/:token/aprovar — aprova (404/409/410 vêm do service).
  router.post('/orcamento/:token/aprovar', async (req, res, next) => {
    try {
      const token = req.params['token'] as string
      const aceite = await aceiteService.aprovarViaCliente({ token, ...evidencias(req) })
      res.status(201).json(respostaPublica(aceite, token))
    } catch (err) {
      next(err)
    }
  })

  // POST /api/publico/orcamento/:token/reprovar — reprova com justificativa opcional.
  router.post(
    '/orcamento/:token/reprovar',
    validate(reprovarPublicoSchema),
    async (req, res, next) => {
      try {
        const token = req.params['token'] as string
        const { justificativa } = req.body as ReprovarPublicoPayload
        const aceite = await aceiteService.reprovarViaCliente({
          token,
          justificativa,
          ...evidencias(req),
        })
        res.status(201).json(respostaPublica(aceite, token))
      } catch (err) {
        next(err)
      }
    },
  )

  return router
}
