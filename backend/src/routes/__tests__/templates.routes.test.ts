import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import cookieParser from 'cookie-parser'
import { criarTemplatesRouter } from '../templates.routes.js'
import { errorHandler } from '../../middlewares/error-handler.js'
import { AppError } from '../../errors/app-error.js'
import type { AuthService } from '../../services/auth.service.js'
import type { TemplateService } from '../../services/template.service.js'
import type { TemplatePublico } from '../../repositories/template.repository.js'
import type { UsuarioPublico } from '../../repositories/usuario.repository.js'
import type { SessaoAtiva } from '../../repositories/sessao.repository.js'

const usuarioAdminMock: UsuarioPublico = {
  id: 'user-1',
  tenantId: 'tenant-1',
  nome: 'Ana Costa',
  email: 'ana@exemplo.com',
  papel: 'admin',
  ativo: true,
  criadoEm: new Date('2024-01-01'),
}

const usuarioOperadorMock: UsuarioPublico = {
  id: 'user-2',
  tenantId: 'tenant-1',
  nome: 'Beto Lima',
  email: 'beto@exemplo.com',
  papel: 'operador',
  ativo: true,
  criadoEm: new Date('2024-01-01'),
}

const sessaoMock: SessaoAtiva = {
  id: 'sessao-id-1',
  usuarioId: 'user-1',
  expiraEm: new Date(Date.now() + 8 * 60 * 60 * 1000),
  ultimaAtividade: new Date(),
}

const templatePublicoMock: TemplatePublico = {
  id: 'template-1',
  tenantId: 'tenant-1',
  versao: 1,
  layoutJson: { formato: 'A4' },
  criadoEm: new Date('2024-01-01'),
}

function makeAuthService(usuario: UsuarioPublico = usuarioAdminMock): AuthService {
  return {
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    validarSessao: vi.fn().mockResolvedValue({ usuario, sessao: sessaoMock }),
  }
}

function makeTemplateService(overrides?: Partial<TemplateService>): TemplateService {
  return {
    criarTemplatePadrao: vi.fn().mockResolvedValue(templatePublicoMock),
    salvar: vi.fn().mockResolvedValue({ ...templatePublicoMock, versao: 2 }),
    buscarAtivo: vi.fn().mockResolvedValue(templatePublicoMock),
    buscarPorId: vi.fn().mockResolvedValue(templatePublicoMock),
    ...overrides,
  }
}

function makeApp(templateService: TemplateService, authService: AuthService) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/templates', criarTemplatesRouter(templateService, authService))
  app.use(errorHandler)
  return app
}

describe('GET /api/templates/atual', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e o template ativo do tenant', async () => {
    const templateService = makeTemplateService()
    const authService = makeAuthService()
    const app = makeApp(templateService, authService)

    const res = await request(app)
      .get('/api/templates/atual')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('template-1')
    expect(templateService.buscarAtivo).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
    )
  })

  it('propaga AppError 404 do service (sem template)', async () => {
    const templateService = makeTemplateService({
      buscarAtivo: vi.fn().mockRejectedValue(new AppError(404, 'Template não encontrado')),
    })
    const authService = makeAuthService()
    const app = makeApp(templateService, authService)

    const res = await request(app)
      .get('/api/templates/atual')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(404)
  })

  it('retorna 401 sem cookie session', async () => {
    const templateService = makeTemplateService()
    const authService = makeAuthService()
    const app = makeApp(templateService, authService)

    const res = await request(app).get('/api/templates/atual')

    expect(res.status).toBe(401)
  })
})

describe('PUT /api/templates/atual', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e a nova versão quando admin envia body válido', async () => {
    const templateService = makeTemplateService()
    const authService = makeAuthService(usuarioAdminMock)
    const app = makeApp(templateService, authService)

    const res = await request(app)
      .put('/api/templates/atual')
      .set('Cookie', 'session=sessao-id-1')
      .send({ layoutJson: { formato: 'A4', orientacao: 'retrato' } })

    expect(res.status).toBe(200)
    expect(res.body.versao).toBe(2)
    expect(templateService.salvar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      { formato: 'A4', orientacao: 'retrato' },
    )
  })

  it('retorna 403 quando operador tenta atualizar (salvar não é chamado)', async () => {
    const templateService = makeTemplateService()
    const authService = makeAuthService(usuarioOperadorMock)
    const app = makeApp(templateService, authService)

    const res = await request(app)
      .put('/api/templates/atual')
      .set('Cookie', 'session=sessao-id-1')
      .send({ layoutJson: { formato: 'A4' } })

    expect(res.status).toBe(403)
    expect(templateService.salvar).not.toHaveBeenCalled()
  })

  it('retorna 400 com body inválido (layoutJson ausente)', async () => {
    const templateService = makeTemplateService()
    const authService = makeAuthService(usuarioAdminMock)
    const app = makeApp(templateService, authService)

    const res = await request(app)
      .put('/api/templates/atual')
      .set('Cookie', 'session=sessao-id-1')
      .send({})

    expect(res.status).toBe(400)
    expect(templateService.salvar).not.toHaveBeenCalled()
  })

  it('retorna 401 sem cookie session', async () => {
    const templateService = makeTemplateService()
    const authService = makeAuthService()
    const app = makeApp(templateService, authService)

    const res = await request(app)
      .put('/api/templates/atual')
      .send({ layoutJson: { formato: 'A4' } })

    expect(res.status).toBe(401)
  })
})
