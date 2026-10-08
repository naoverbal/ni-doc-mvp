import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import cookieParser from 'cookie-parser'
import { criarClientesRouter } from '../clientes.routes.js'
import { errorHandler } from '../../middlewares/error-handler.js'
import { AppError } from '../../errors/app-error.js'
import type { AuthService } from '../../services/auth.service.js'
import type { ClienteService } from '../../services/cliente.service.js'
import type { ClientePublico } from '../../repositories/cliente.repository.js'
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

const clientePublicoMock: ClientePublico = {
  id: 'cliente-1',
  tenantId: 'tenant-1',
  tipoPessoa: 'PF',
  nome: 'João da Silva',
  documento: '52998224725',
  email: 'joao@exemplo.com',
  telefone: null,
  endereco: null,
  observacoes: null,
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

function makeClienteService(overrides?: Partial<ClienteService>): ClienteService {
  return {
    criar: vi.fn().mockResolvedValue(clientePublicoMock),
    buscar: vi.fn().mockResolvedValue([clientePublicoMock]),
    buscarPorId: vi.fn().mockResolvedValue(clientePublicoMock),
    atualizar: vi.fn().mockResolvedValue(clientePublicoMock),
    desativar: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makeApp(clienteService: ClienteService, authService: AuthService) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/clientes', criarClientesRouter(clienteService, authService))
  app.use(errorHandler)
  return app
}

describe('GET /api/clientes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e o array de buscar quando q está presente', async () => {
    const clienteService = makeClienteService()
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app)
      .get('/api/clientes')
      .query({ q: 'ana' })
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('cliente-1')
    expect(clienteService.buscar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      'ana',
    )
  })

  it('retorna 200 e lista vazia quando q está ausente (buscar não é chamado)', async () => {
    const clienteService = makeClienteService()
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app).get('/api/clientes').set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    expect(clienteService.buscar).not.toHaveBeenCalled()
  })

  it('retorna 401 sem cookie session', async () => {
    const clienteService = makeClienteService()
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app).get('/api/clientes').query({ q: 'ana' })

    expect(res.status).toBe(401)
  })
})

describe('POST /api/clientes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 201 e o cliente criado com body válido', async () => {
    const clienteService = makeClienteService()
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app).post('/api/clientes').set('Cookie', 'session=sessao-id-1').send({
      tipoPessoa: 'PF',
      nome: 'João da Silva',
      documento: '52998224725',
      email: 'joao@exemplo.com',
    })

    expect(res.status).toBe(201)
    expect(res.body.id).toBe('cliente-1')
    expect(clienteService.criar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      {
        tipoPessoa: 'PF',
        nome: 'João da Silva',
        documento: '52998224725',
        email: 'joao@exemplo.com',
      },
    )
  })

  it('retorna 400 com body inválido (sem nome)', async () => {
    const clienteService = makeClienteService()
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app)
      .post('/api/clientes')
      .set('Cookie', 'session=sessao-id-1')
      .send({ tipoPessoa: 'PF', documento: '52998224725' })

    expect(res.status).toBe(400)
    expect(clienteService.criar).not.toHaveBeenCalled()
  })

  it('retorna 400 com tipoPessoa fora do enum', async () => {
    const clienteService = makeClienteService()
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app)
      .post('/api/clientes')
      .set('Cookie', 'session=sessao-id-1')
      .send({ tipoPessoa: 'XX', nome: 'João', documento: '52998224725' })

    expect(res.status).toBe(400)
  })

  it('retorna 400 com email inválido', async () => {
    const clienteService = makeClienteService()
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app)
      .post('/api/clientes')
      .set('Cookie', 'session=sessao-id-1')
      .send({ tipoPessoa: 'PF', nome: 'João', documento: '52998224725', email: 'nao-e-email' })

    expect(res.status).toBe(400)
  })

  it('propaga AppError 409 do service (documento duplicado)', async () => {
    const clienteService = makeClienteService({
      criar: vi.fn().mockRejectedValue(new AppError(409, 'Documento duplicado')),
    })
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app)
      .post('/api/clientes')
      .set('Cookie', 'session=sessao-id-1')
      .send({ tipoPessoa: 'PF', nome: 'João', documento: '52998224725' })

    expect(res.status).toBe(409)
  })

  it('propaga AppError 400 do service (CPF inválido)', async () => {
    const clienteService = makeClienteService({
      criar: vi.fn().mockRejectedValue(new AppError(400, 'CPF inválido')),
    })
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app)
      .post('/api/clientes')
      .set('Cookie', 'session=sessao-id-1')
      .send({ tipoPessoa: 'PF', nome: 'João', documento: '123' })

    expect(res.status).toBe(400)
  })

  it('retorna 401 sem cookie session', async () => {
    const clienteService = makeClienteService()
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app)
      .post('/api/clientes')
      .send({ tipoPessoa: 'PF', nome: 'João', documento: '52998224725' })

    expect(res.status).toBe(401)
  })
})

describe('PUT /api/clientes/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e o cliente atualizado com body parcial válido', async () => {
    const clienteService = makeClienteService()
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app)
      .put('/api/clientes/cliente-1')
      .set('Cookie', 'session=sessao-id-1')
      .send({ nome: 'João Atualizado' })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('cliente-1')
    expect(clienteService.atualizar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      'cliente-1',
      { nome: 'João Atualizado' },
    )
  })

  it('propaga AppError 404 do service', async () => {
    const clienteService = makeClienteService({
      atualizar: vi.fn().mockRejectedValue(new AppError(404, 'Cliente não encontrado')),
    })
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app)
      .put('/api/clientes/inexistente')
      .set('Cookie', 'session=sessao-id-1')
      .send({ nome: 'João' })

    expect(res.status).toBe(404)
  })

  it('retorna 401 sem cookie session', async () => {
    const clienteService = makeClienteService()
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app).put('/api/clientes/cliente-1').send({ nome: 'João' })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/clientes/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e o cliente', async () => {
    const clienteService = makeClienteService()
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app)
      .get('/api/clientes/cliente-1')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('cliente-1')
    expect(clienteService.buscarPorId).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      'cliente-1',
    )
  })

  it('propaga AppError 404 do service', async () => {
    const clienteService = makeClienteService({
      buscarPorId: vi.fn().mockRejectedValue(new AppError(404, 'Cliente não encontrado')),
    })
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app)
      .get('/api/clientes/inexistente')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(404)
  })

  it('retorna 401 sem cookie session', async () => {
    const clienteService = makeClienteService()
    const authService = makeAuthService()
    const app = makeApp(clienteService, authService)

    const res = await request(app).get('/api/clientes/cliente-1')

    expect(res.status).toBe(401)
  })
})
