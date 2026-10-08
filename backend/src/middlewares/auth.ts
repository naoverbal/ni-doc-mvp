import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { AuthService } from '../services/auth.service.js'
import { AppError } from '../errors/app-error.js'

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

// Exige que o usuário autenticado tenha o papel informado; caso contrário,
// lança AppError(403), mapeado para HTTP 403 pelo errorHandler. Deve ser
// aplicado após `criarMiddlewareAuth` (depende de `req.usuario`).
export function criarMiddlewareExigirPapel(papel: 'admin' | 'operador'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.usuario.papel !== papel) {
      next(new AppError(403, 'Acesso negado'))
      return
    }
    next()
  }
}
