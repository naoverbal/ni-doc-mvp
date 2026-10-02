import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { AuthService } from '../services/auth.service.js'

export function criarMiddlewareAuth(authService: AuthService): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const sessionId = req.cookies['session'] as string | undefined

    if (!sessionId) {
      res.status(401).json({ erro: 'Não autenticado' })
      return
    }

    const resultado = await authService.validarSessao(sessionId)
    if (!resultado) {
      res.clearCookie('session')
      res.status(401).json({ erro: 'Sessão expirada' })
      return
    }

    req.usuario = resultado.usuario
    req.sessao = resultado.sessao
    next()
  }
}
