import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
// pino-http é CJS: sob moduleResolution Node16 o default não é tipado como
// callable. Importa o namespace e usa o export nomeado `pinoHttp` (presente
// tanto nos tipos quanto no objeto exportado em runtime).
import * as pinoHttpModule from 'pino-http'
import { env } from './config/env.js'

const pinoHttp = pinoHttpModule.pinoHttp
import { errorHandler } from './middlewares/error-handler.js'
import { criarAuthRouter } from './routes/auth.routes.js'
import { criarClientesRouter } from './routes/clientes.routes.js'
import { criarEmpresasRouter } from './routes/empresas.routes.js'
import { criarResponsaveisRouter } from './routes/responsaveis.routes.js'
import { criarOrcamentosRouter } from './routes/orcamentos.routes.js'
import { criarTemplatesRouter } from './routes/templates.routes.js'
import { criarPublicoRouter } from './routes/publico.routes.js'
import { criarAuthService } from './services/auth.service.js'
import { criarClienteService } from './services/cliente.service.js'
import { criarEmpresaService } from './services/empresa.service.js'
import { criarResponsavelService } from './services/responsavel.service.js'
import { criarOrcamentoService } from './services/orcamento.service.js'
import { criarVersionamentoService } from './services/versionamento.service.js'
import { criarSnapshotService } from './services/snapshot.service.js'
import { criarTemplateService } from './services/template.service.js'
import { criarHtmlRendererService } from './services/html-renderer.service.js'
import { criarPdfService } from './services/pdf.service.js'
import { criarAceiteService } from './services/aceite.service.js'
import { criarOrcamentoAceiteRepository } from './repositories/orcamento-aceite.repository.js'
import { criarUsuarioRepository } from './repositories/usuario.repository.js'
import { criarSessaoRepository } from './repositories/sessao.repository.js'
import { criarClienteRepository } from './repositories/cliente.repository.js'
import { criarEmpresaRepository } from './repositories/empresa.repository.js'
import { criarResponsavelRepository } from './repositories/responsavel.repository.js'
import { criarOrcamentoRepository } from './repositories/orcamento.repository.js'
import { criarOrcamentoVersaoRepository } from './repositories/orcamento-versao.repository.js'
import { criarTemplateRepository } from './repositories/template.repository.js'
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

  // Empresa routes
  const empresaRepo = criarEmpresaRepository(db)
  const empresaService = criarEmpresaService({ empresaRepo, auditoriaService })
  app.use('/api/empresas', criarEmpresasRouter(empresaService, authService))

  // Responsável técnico routes
  const responsavelRepo = criarResponsavelRepository(db)
  const responsavelService = criarResponsavelService({ responsavelRepo, auditoriaService })
  app.use('/api/responsaveis', criarResponsaveisRouter(responsavelService, authService))

  // Template (repositório compartilhado com o versionamento, para renderizar o
  // PDF a partir do layout ativo do tenant).
  const templateRepo = criarTemplateRepository({ db })

  // Orçamento routes
  const orcamentoRepo = criarOrcamentoRepository({ db })
  const orcamentoService = criarOrcamentoService({ orcamentoRepo, auditoriaService })
  const orcamentoVersaoRepo = criarOrcamentoVersaoRepository({ db })
  const snapshotService = criarSnapshotService()
  const htmlRenderer = criarHtmlRendererService()
  const pdfService = criarPdfService({ pdfsDir: env.PDFS_DIR })
  const versionamentoService = criarVersionamentoService({
    orcamentoRepo,
    orcamentoVersaoRepo,
    clienteRepo,
    empresaRepo,
    responsavelRepo,
    snapshotService,
    auditoriaService,
    pdfService,
    htmlRenderer,
    templateRepo,
  })
  // Template routes
  const templateService = criarTemplateService({ templateRepo, auditoriaService })
  app.use('/api/templates', criarTemplatesRouter(templateService, authService))

  // Serviço de aceite (compartilhado entre a rota autenticada de aceite manual e
  // as rotas públicas de aprovação/reprovação via token).
  const aceiteRepo = criarOrcamentoAceiteRepository({ db })
  const aceiteService = criarAceiteService({
    orcamentoVersaoRepo,
    aceiteRepo,
    orcamentoRepo,
    auditoriaService,
    pdfService,
    htmlRenderer,
  })

  // Orçamento routes (dependem do aceiteService para o aceite manual).
  app.use(
    '/api/orcamentos',
    criarOrcamentosRouter(orcamentoService, versionamentoService, aceiteService, authService),
  )

  // Rotas públicas (sem auth): visualização e aceite via token público.
  app.use('/api/publico', criarPublicoRouter(aceiteService))

  // Error handler deve ser o último middleware
  app.use(errorHandler)

  return app
}
