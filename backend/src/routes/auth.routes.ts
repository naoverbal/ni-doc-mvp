import { Router } from 'express'
import type { AuthService } from '../services/auth.service.js'
import { loginSchema } from '../schemas/auth.schema.js'
import { validate } from '../middlewares/validate.js'
import { criarMiddlewareAuth } from '../middlewares/auth.js'
import { criarLoginRateLimit } from '../middlewares/rate-limit.js'
import { env } from '../config/env.js'

export function criarAuthRouter(authService: AuthService): Router {
  const router = Router()
  const autenticar = criarMiddlewareAuth(authService)

  // Rate limiter criado por instância do router para evitar vazamento de estado entre testes
  const loginRateLimit = criarLoginRateLimit()

  // POST /login
  router.post('/login', loginRateLimit, validate(loginSchema), async (req, res, next) => {
    try {
      const { email, senha } = req.body as { email: string; senha: string }
      const ip = req.ip ?? undefined
      const userAgent = req.headers['user-agent'] ?? undefined

      const result = await authService.login({ email, senha, ip, userAgent })

      const maxAge = result.expiraEm.getTime() - Date.now()
      res.cookie('session', result.sessaoId, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge,
      })

      res.json({
        usuario: {
          id: result.usuario.id,
          nome: result.usuario.nome,
          papel: result.usuario.papel,
        },
      })
    } catch (err) {
      next(err)
    }
  })

  // POST /logout
  router.post('/logout', async (req, res, next) => {
    try {
      const sessionId = req.cookies['session'] as string | undefined
      if (sessionId) {
        await authService.logout(sessionId)
      }
      res.clearCookie('session')
      res.status(200).json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // GET /me
  router.get('/me', autenticar, (req, res) => {
    res.json({ usuario: req.usuario })
  })

  return router
}
