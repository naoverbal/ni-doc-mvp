import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { ZodSchema } from 'zod'
import { AppError } from '../errors/app-error.js'

export function validate(schema: ZodSchema): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      next(new AppError(400, 'Dados inválidos', result.error.errors))
      return
    }
    req.body = result.data
    next()
  }
}
