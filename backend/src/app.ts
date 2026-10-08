import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
// pino-http has CJS/ESM interop issues with Node16 module resolution — use require-style cast
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pinoHttp = require('pino-http') as typeof import('pino-http').default
import { env } from './config/env.js'
import { errorHandler } from './middlewares/error-handler.js'
import { criarAuthRouter } from './routes/auth.routes.js'
import { criarClientesRouter } from './routes/clientes.routes.js'
import { criarAuthService } from './services/auth.service.js'
import { criarClienteService } from './services/cliente.service.js'
import { criarUsuarioRepository } from './repositories/usuario.repository.js'
import { criarSessaoRepository } from './repositories/sessao.repository.js'
import { criarClienteRepository } from './repositories/cliente.repository.js'
import { criarAuditoriaRepository } from './repositories/auditoria.repository.js'
import { criarAuditoriaService } from './services/auditoria.service.js'
import { db } from './config/database.js'

export function criarApp(): express.Express {
  const app = express()

  app.use(helmet())
  app.use(
    cors({
      origin: env.NODE_ENV === 'development' ? true : false,
      credentials: true,
    }),
  )
  app.use(cookieParser())
  app.use(express.json())
  app.use(
    pinoHttp({
      enabled: env.NODE_ENV !== 'test',
    }),
  )

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', env: env.NODE_ENV })
  })

  // Auth routes
  const auditoriaRepo = criarAuditoriaRepository(db)
  const auditoriaService = criarAuditoriaService(auditoriaRepo)
  const usuarioRepo = criarUsuarioRepository(db)
  const sessaoRepo = criarSessaoRepository(db)
  const authService = criarAuthService({ usuarioRepo, sessaoRepo, auditoriaService })
  app.use('/api/auth', criarAuthRouter(authService))

  // Cliente routes
  const clienteRepo = criarClienteRepository(db)
  const clienteService = criarClienteService({ clienteRepo, auditoriaService })
  app.use('/api/clientes', criarClientesRouter(clienteService, authService))

  // Error handler deve ser o último middleware
  app.use(errorHandler)

  return app
}
