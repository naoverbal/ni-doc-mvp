import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { AppError } from '../errors/app-error.js'

const uuidSchema = z.string().uuid()

/**
 * Handler para `router.param('id', validarIdParam)`: recusa com 400 um parâmetro
 * de rota que não seja UUID, antes de a query chegar ao Postgres (que responderia
 * com erro cru de sintaxe de uuid, virando 500).
 */
export function validarIdParam(
  _req: Request,
  _res: Response,
  next: NextFunction,
  valor: unknown,
): void {
  if (!uuidSchema.safeParse(valor).success) {
    next(new AppError(400, 'Identificador inválido'))
    return
  }
  next()
}
