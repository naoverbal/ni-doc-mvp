import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import cookieParser from 'cookie-parser'
import { criarEmpresasRouter } from '../empresas.routes.js'
import { errorHandler } from '../../middlewares/error-handler.js'
import { AppError } from '../../errors/app-error.js'
import type { AuthService } from '../../services/auth.service.js'
import type { EmpresaService } from '../../services/empresa.service.js'
import type { EmpresaPublica } from '../../repositories/empresa.repository.js'
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

const empresaPublicaMock: EmpresaPublica = {
  id: 'empresa-1',
  tenantId: 'tenant-1',
  tipo: 'cliente_pj',
  razaoSocial: 'Acme Ltda',
  nomeFantasia: 'Acme',
  cnpj: '11222333000181',
  email: 'contato@acme.com',
  telefone: null,
  endereco: null,
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

function makeEmpresaService(overrides?: Partial<EmpresaService>): EmpresaService {
  return {
    criar: vi.fn().mockResolvedValue(empresaPublicaMock),
    buscar: vi.fn().mockResolvedValue([empresaPublicaMock]),
    buscarPorId: vi.fn().mockResolvedValue(empresaPublicaMock),
    atualizar: vi.fn().mockResolvedValue(empresaPublicaMock),
    desativar: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makeApp(empresaService: EmpresaService, authService: AuthService) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/empresas', criarEmpresasRouter(empresaService, authService))
  app.use(errorHandler)
  return app
}

describe('GET /api/empresas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e o array de buscar com q e tipo presentes', async () => {
    const empresaService = makeEmpresaService()
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app)
      .get('/api/empresas')
      .query({ q: 'acme', tipo: 'cliente_pj' })
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('empresa-1')
    expect(empresaService.buscar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      'acme',
      'cliente_pj',
    )
  })

  it('usa tipo cliente_pj por padrão quando ausente', async () => {
    const empresaService = makeEmpresaService()
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app)
      .get('/api/empresas')
      .query({ q: 'acme' })
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(empresaService.buscar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      'acme',
      'cliente_pj',
    )
  })

  it('retorna 400 quando tipo é inválido', async () => {
    const empresaService = makeEmpresaService()
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app)
      .get('/api/empresas')
      .query({ q: 'acme', tipo: 'xpto' })
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(400)
    expect(empresaService.buscar).not.toHaveBeenCalled()
  })

  it('retorna 200 e lista vazia quando q está ausente (buscar não é chamado)', async () => {
    const empresaService = makeEmpresaService()
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app).get('/api/empresas').set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    expect(empresaService.buscar).not.toHaveBeenCalled()
  })

  it('retorna 401 sem cookie session', async () => {
    const empresaService = makeEmpresaService()
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app).get('/api/empresas').query({ q: 'acme' })

    expect(res.status).toBe(401)
  })
})

describe('POST /api/empresas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 201 e a empresa criada com body válido', async () => {
    const empresaService = makeEmpresaService()
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app).post('/api/empresas').set('Cookie', 'session=sessao-id-1').send({
      tipo: 'cliente_pj',
      razaoSocial: 'Acme Ltda',
      nomeFantasia: 'Acme',
      cnpj: '11222333000181',
      email: 'contato@acme.com',
    })

    expect(res.status).toBe(201)
    expect(res.body.id).toBe('empresa-1')
    expect(empresaService.criar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      {
        tipo: 'cliente_pj',
        razaoSocial: 'Acme Ltda',
        nomeFantasia: 'Acme',
        cnpj: '11222333000181',
        email: 'contato@acme.com',
      },
    )
  })

  it('retorna 400 com body inválido (sem razaoSocial)', async () => {
    const empresaService = makeEmpresaService()
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app)
      .post('/api/empresas')
      .set('Cookie', 'session=sessao-id-1')
      .send({ tipo: 'cliente_pj' })

    expect(res.status).toBe(400)
    expect(empresaService.criar).not.toHaveBeenCalled()
  })

  it('retorna 400 com tipo fora do enum', async () => {
    const empresaService = makeEmpresaService()
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app)
      .post('/api/empresas')
      .set('Cookie', 'session=sessao-id-1')
      .send({ tipo: 'XX', razaoSocial: 'Acme Ltda' })

    expect(res.status).toBe(400)
  })

  it('retorna 400 com email inválido', async () => {
    const empresaService = makeEmpresaService()
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app)
      .post('/api/empresas')
      .set('Cookie', 'session=sessao-id-1')
      .send({ tipo: 'cliente_pj', razaoSocial: 'Acme Ltda', email: 'nao-e-email' })

    expect(res.status).toBe(400)
  })

  it('propaga AppError 409 do service (CNPJ duplicado)', async () => {
    const empresaService = makeEmpresaService({
      criar: vi.fn().mockRejectedValue(new AppError(409, 'CNPJ duplicado')),
    })
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app)
      .post('/api/empresas')
      .set('Cookie', 'session=sessao-id-1')
      .send({ tipo: 'cliente_pj', razaoSocial: 'Acme Ltda', cnpj: '11222333000181' })

    expect(res.status).toBe(409)
  })

  it('propaga AppError 400 do service (CNPJ inválido)', async () => {
    const empresaService = makeEmpresaService({
      criar: vi.fn().mockRejectedValue(new AppError(400, 'CNPJ inválido')),
    })
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app)
      .post('/api/empresas')
      .set('Cookie', 'session=sessao-id-1')
      .send({ tipo: 'cliente_pj', razaoSocial: 'Acme Ltda', cnpj: '123' })

    expect(res.status).toBe(400)
  })

  it('retorna 401 sem cookie session', async () => {
    const empresaService = makeEmpresaService()
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app)
      .post('/api/empresas')
      .send({ tipo: 'cliente_pj', razaoSocial: 'Acme Ltda' })

    expect(res.status).toBe(401)
  })
})

describe('PUT /api/empresas/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e a empresa atualizada com body parcial válido', async () => {
    const empresaService = makeEmpresaService()
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app)
      .put('/api/empresas/empresa-1')
      .set('Cookie', 'session=sessao-id-1')
      .send({ razaoSocial: 'Acme Atualizada' })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('empresa-1')
    expect(empresaService.atualizar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      'empresa-1',
      { razaoSocial: 'Acme Atualizada' },
    )
  })

  it('propaga AppError 404 do service', async () => {
    const empresaService = makeEmpresaService({
      atualizar: vi.fn().mockRejectedValue(new AppError(404, 'Empresa não encontrada')),
    })
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app)
      .put('/api/empresas/inexistente')
      .set('Cookie', 'session=sessao-id-1')
      .send({ razaoSocial: 'Acme' })

    expect(res.status).toBe(404)
  })

  it('retorna 401 sem cookie session', async () => {
    const empresaService = makeEmpresaService()
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app).put('/api/empresas/empresa-1').send({ razaoSocial: 'Acme' })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/empresas/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e a empresa', async () => {
    const empresaService = makeEmpresaService()
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app)
      .get('/api/empresas/empresa-1')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('empresa-1')
    expect(empresaService.buscarPorId).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      'empresa-1',
    )
  })

  it('propaga AppError 404 do service', async () => {
    const empresaService = makeEmpresaService({
      buscarPorId: vi.fn().mockRejectedValue(new AppError(404, 'Empresa não encontrada')),
    })
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app)
      .get('/api/empresas/inexistente')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(404)
  })

  it('retorna 401 sem cookie session', async () => {
    const empresaService = makeEmpresaService()
    const authService = makeAuthService()
    const app = makeApp(empresaService, authService)

    const res = await request(app).get('/api/empresas/empresa-1')

    expect(res.status).toBe(401)
  })
})
