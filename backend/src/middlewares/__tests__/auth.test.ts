import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import cookieParser from 'cookie-parser'
import { criarMiddlewareAuth } from '../auth.js'
import type { AuthService } from '../../services/auth.service.js'
import type { UsuarioPublico } from '../../repositories/usuario.repository.js'
import type { SessaoAtiva } from '../../repositories/sessao.repository.js'

const usuarioMock: UsuarioPublico = {
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

function makeAuthService(overrides?: Partial<AuthService>): AuthService {
  return {
    login: vi.fn(),
    logout: vi.fn(),
    validarSessao: vi.fn().mockResolvedValue({ usuario: usuarioMock, sessao: sessaoMock }),
    ...overrides,
  }
}

function makeApp(authService: AuthService) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  const autenticar = criarMiddlewareAuth(authService)
  app.get('/protegido', autenticar, (req, res) => {
    res.json({ usuario: req.usuario })
  })
  return app
}

describe('Middleware autenticar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 401 sem cookie session', async () => {
    const authService = makeAuthService()
    const app = makeApp(authService)

    const res = await request(app).get('/protegido')

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ erro: 'Não autenticado' })
  })

  it('retorna 401 com sessão expirada (validarSessao retorna null)', async () => {
    const authService = makeAuthService({
      validarSessao: vi.fn().mockResolvedValue(null),
    })
    const app = makeApp(authService)

    const res = await request(app)
      .get('/protegido')
      .set('Cookie', 'session=sessao-expirada')

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ erro: 'Sessão expirada' })
  })

  it('chama next() com sessão válida e retorna 200', async () => {
    const authService = makeAuthService()
    const app = makeApp(authService)

    const res = await request(app)
      .get('/protegido')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
  })

  it('popula req.usuario com sessão válida', async () => {
    const authService = makeAuthService()
    const app = makeApp(authService)

    const res = await request(app)
      .get('/protegido')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.body.usuario.id).toBe('user-1')
    expect(res.body.usuario.email).toBe('ana@exemplo.com')
  })
})
