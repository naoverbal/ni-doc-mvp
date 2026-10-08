import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import cookieParser from 'cookie-parser'
import { criarResponsaveisRouter } from '../responsaveis.routes.js'
import { errorHandler } from '../../middlewares/error-handler.js'
import { AppError } from '../../errors/app-error.js'
import type { AuthService } from '../../services/auth.service.js'
import type { ResponsavelService } from '../../services/responsavel.service.js'
import type { ResponsavelPublico } from '../../repositories/responsavel.repository.js'
import type { UsuarioPublico } from '../../repositories/usuario.repository.js'
import type { SessaoAtiva } from '../../repositories/sessao.repository.js'

const usuarioPublicoMock: UsuarioPublico = {
  id: 'user-1',
  tenantId: 'tenant-1',
  nome: 'Ana Costa',
  email: 'ana@exemplo.com',
  papel: 'admin',
  ativo: true,
  criadoEm: new Date('2024-01-01'),
}

const sessaoMock: SessaoAtiva = {
  id: 'sessao-id-1',
  usuarioId: 'user-1',
  expiraEm: new Date(Date.now() + 8 * 60 * 60 * 1000),
  ultimaAtividade: new Date(),
}

const responsavelPublicoMock: ResponsavelPublico = {
  id: 'responsavel-1',
  tenantId: 'tenant-1',
  nome: 'Ana Engenheira',
  registroProfissional: 'CREA-123456',
  email: 'ana.eng@exemplo.com',
  telefone: null,
  ativo: true,
  criadoEm: new Date('2024-01-01'),
}

function makeAuthService(overrides?: Partial<AuthService>): AuthService {
  return {
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    validarSessao: vi.fn().mockResolvedValue({ usuario: usuarioPublicoMock, sessao: sessaoMock }),
    ...overrides,
  }
}

function makeResponsavelService(overrides?: Partial<ResponsavelService>): ResponsavelService {
  return {
    criar: vi.fn().mockResolvedValue(responsavelPublicoMock),
    buscar: vi.fn().mockResolvedValue([responsavelPublicoMock]),
    buscarPorId: vi.fn().mockResolvedValue(responsavelPublicoMock),
    atualizar: vi.fn().mockResolvedValue(responsavelPublicoMock),
    desativar: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makeApp(responsavelService: ResponsavelService, authService: AuthService) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/responsaveis', criarResponsaveisRouter(responsavelService, authService))
  app.use(errorHandler)
  return app
}

describe('GET /api/responsaveis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e o array de buscar quando q está presente', async () => {
    const responsavelService = makeResponsavelService()
    const authService = makeAuthService()
    const app = makeApp(responsavelService, authService)

    const res = await request(app)
      .get('/api/responsaveis')
      .query({ q: 'ana' })
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('responsavel-1')
    expect(responsavelService.buscar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      'ana',
    )
  })

  it('retorna 200 e lista vazia quando q está ausente (buscar não é chamado)', async () => {
    const responsavelService = makeResponsavelService()
    const authService = makeAuthService()
    const app = makeApp(responsavelService, authService)

    const res = await request(app).get('/api/responsaveis').set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    expect(responsavelService.buscar).not.toHaveBeenCalled()
  })

  it('retorna 401 sem cookie session', async () => {
    const responsavelService = makeResponsavelService()
    const authService = makeAuthService()
    const app = makeApp(responsavelService, authService)

    const res = await request(app).get('/api/responsaveis').query({ q: 'ana' })

    expect(res.status).toBe(401)
  })
})

describe('POST /api/responsaveis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 201 e o responsável criado com body válido', async () => {
    const responsavelService = makeResponsavelService()
    const authService = makeAuthService()
    const app = makeApp(responsavelService, authService)

    const res = await request(app)
      .post('/api/responsaveis')
      .set('Cookie', 'session=sessao-id-1')
      .send({
        nome: 'Ana Engenheira',
        registroProfissional: 'CREA-123456',
        email: 'ana.eng@exemplo.com',
      })

    expect(res.status).toBe(201)
    expect(res.body.id).toBe('responsavel-1')
    expect(responsavelService.criar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      {
        nome: 'Ana Engenheira',
        registroProfissional: 'CREA-123456',
        email: 'ana.eng@exemplo.com',
      },
    )
  })

  it('retorna 400 com body inválido (sem nome)', async () => {
    const responsavelService = makeResponsavelService()
    const authService = makeAuthService()
    const app = makeApp(responsavelService, authService)

    const res = await request(app)
      .post('/api/responsaveis')
      .set('Cookie', 'session=sessao-id-1')
      .send({ registroProfissional: 'CREA-123456' })

    expect(res.status).toBe(400)
    expect(responsavelService.criar).not.toHaveBeenCalled()
  })

  it('retorna 400 com email inválido', async () => {
    const responsavelService = makeResponsavelService()
    const authService = makeAuthService()
    const app = makeApp(responsavelService, authService)

    const res = await request(app)
      .post('/api/responsaveis')
      .set('Cookie', 'session=sessao-id-1')
      .send({ nome: 'Ana Engenheira', email: 'nao-e-email' })

    expect(res.status).toBe(400)
  })

  it('retorna 401 sem cookie session', async () => {
    const responsavelService = makeResponsavelService()
    const authService = makeAuthService()
    const app = makeApp(responsavelService, authService)

    const res = await request(app).post('/api/responsaveis').send({ nome: 'Ana Engenheira' })

    expect(res.status).toBe(401)
  })
})

describe('PUT /api/responsaveis/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e o responsável atualizado com body parcial válido', async () => {
    const responsavelService = makeResponsavelService()
    const authService = makeAuthService()
    const app = makeApp(responsavelService, authService)

    const res = await request(app)
      .put('/api/responsaveis/responsavel-1')
      .set('Cookie', 'session=sessao-id-1')
      .send({ nome: 'Ana Atualizada' })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('responsavel-1')
    expect(responsavelService.atualizar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      'responsavel-1',
      { nome: 'Ana Atualizada' },
    )
  })

  it('propaga AppError 404 do service', async () => {
    const responsavelService = makeResponsavelService({
      atualizar: vi.fn().mockRejectedValue(new AppError(404, 'Responsável não encontrado')),
    })
    const authService = makeAuthService()
    const app = makeApp(responsavelService, authService)

    const res = await request(app)
      .put('/api/responsaveis/inexistente')
      .set('Cookie', 'session=sessao-id-1')
      .send({ nome: 'Ana' })

    expect(res.status).toBe(404)
  })

  it('retorna 401 sem cookie session', async () => {
    const responsavelService = makeResponsavelService()
    const authService = makeAuthService()
    const app = makeApp(responsavelService, authService)

    const res = await request(app).put('/api/responsaveis/responsavel-1').send({ nome: 'Ana' })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/responsaveis/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e o responsável', async () => {
    const responsavelService = makeResponsavelService()
    const authService = makeAuthService()
    const app = makeApp(responsavelService, authService)

    const res = await request(app)
      .get('/api/responsaveis/responsavel-1')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('responsavel-1')
    expect(responsavelService.buscarPorId).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      'responsavel-1',
    )
  })

  it('propaga AppError 404 do service', async () => {
    const responsavelService = makeResponsavelService({
      buscarPorId: vi.fn().mockRejectedValue(new AppError(404, 'Responsável não encontrado')),
    })
    const authService = makeAuthService()
    const app = makeApp(responsavelService, authService)

    const res = await request(app)
      .get('/api/responsaveis/inexistente')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(404)
  })

  it('retorna 401 sem cookie session', async () => {
    const responsavelService = makeResponsavelService()
    const authService = makeAuthService()
    const app = makeApp(responsavelService, authService)

    const res = await request(app).get('/api/responsaveis/responsavel-1')

    expect(res.status).toBe(401)
  })
})
