import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { AppError } from '../errors/app-error.js'

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      erro: err.message,
      ...(err.detalhes !== undefined ? { detalhes: err.detalhes } : {}),
    })
    return
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      erro: 'Dados inválidos',
      detalhes: err.errors,
    })
    return
  }

  const isDev = process.env['NODE_ENV'] !== 'production'
  const message =
    err instanceof Error
      ? isDev
        ? err.message
        : 'Erro interno do servidor'
      : 'Erro interno do servidor'

  res.status(500).json({ erro: message })
}
