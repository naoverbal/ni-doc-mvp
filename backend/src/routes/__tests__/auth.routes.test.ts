import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import cookieParser from 'cookie-parser'
import { criarAuthRouter } from '../auth.routes.js'
import { errorHandler } from '../../middlewares/error-handler.js'
import { AppError } from '../../errors/app-error.js'
import type { AuthService } from '../../services/auth.service.js'
import type { UsuarioPublico } from '../../repositories/usuario.repository.js'
import type { SessaoAtiva } from '../../repositories/sessao.repository.js'

const usuarioMock = {
  id: 'user-1',
  nome: 'Ana Costa',
  email: 'ana@exemplo.com',
  papel: 'admin' as const,
  tenantId: 'tenant-1',
}

const loginResultMock = {
  sessaoId: 'sessao-id-1',
  expiraEm: new Date(Date.now() + 8 * 60 * 60 * 1000),
  usuario: usuarioMock,
}

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

// Cria uma instância do app por teste com rate limiter próprio
// para evitar que o contador de rate limit vaze entre testes
function makeApp(authService: AuthService) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/auth', criarAuthRouter(authService))
  app.use(errorHandler)
  return app
}

function makeAuthService(overrides?: Partial<AuthService>): AuthService {
  return {
    login: vi.fn().mockResolvedValue(loginResultMock),
    logout: vi.fn().mockResolvedValue(undefined),
    validarSessao: vi.fn().mockResolvedValue({ usuario: usuarioPublicoMock, sessao: sessaoMock }),
    ...overrides,
  }
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e seta cookie session com payload válido', async () => {
    const authService = makeAuthService()
    const app = makeApp(authService)

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@exemplo.com', senha: 'senha1234' })

    expect(res.status).toBe(200)
    expect(res.body.usuario.id).toBe('user-1')
    expect(res.headers['set-cookie']).toBeDefined()
    const cookieHeader = (res.headers['set-cookie'] as unknown as string[]).join(';')
    expect(cookieHeader).toContain('session=')
  })

  it('retorna 400 com payload malformado (sem senha)', async () => {
    const authService = makeAuthService()
    const app = makeApp(authService)

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@exemplo.com' })

    expect(res.status).toBe(400)
  })

  it('retorna 400 com email inválido', async () => {
    const authService = makeAuthService()
    const app = makeApp(authService)

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nao-e-email', senha: 'senha1234' })

    expect(res.status).toBe(400)
  })

  it('retorna 401 com credenciais inválidas', async () => {
    const authService = makeAuthService({
      login: vi.fn().mockRejectedValue(new AppError(401, 'Credenciais inválidas')),
    })
    const app = makeApp(authService)

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@exemplo.com', senha: 'errada123' })

    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  it('retorna 200 e limpa cookie session', async () => {
    const authService = makeAuthService()
    const app = makeApp(authService)

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    const setCookie = res.headers['set-cookie'] as string[] | undefined
    // O cookie session deve ser removido (Max-Age=0 ou expires no passado)
    expect(setCookie?.join(';')).toMatch(/session=;|session=.*Max-Age=0/)
  })

  it('retorna 200 mesmo sem cookie', async () => {
    const authService = makeAuthService()
    const app = makeApp(authService)

    const res = await request(app).post('/api/auth/logout')

    expect(res.status).toBe(200)
  })
})

describe('GET /api/auth/me', () => {
  it('retorna 401 sem cookie session', async () => {
    const authService = makeAuthService()
    const app = makeApp(authService)

    const res = await request(app).get('/api/auth/me')

    expect(res.status).toBe(401)
  })

  it('retorna 200 com dados do usuário com sessão válida', async () => {
    const authService = makeAuthService()
    const app = makeApp(authService)

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(res.body.usuario.id).toBe('user-1')
  })
})

describe('Rate limiting no login (T-306)', () => {
  it('retorna 429 na 6ª tentativa dentro da janela', async () => {
    // Usar um authService que sempre rejeita para simular credenciais inválidas
    // Cada instância do criarAuthRouter cria um novo rate limiter (novo store em memória)
    const authService = makeAuthService({
      login: vi.fn().mockRejectedValue(new AppError(401, 'Credenciais inválidas')),
    })
    const app = makeApp(authService)

    const payload = { email: 'ana@exemplo.com', senha: 'errada123' }

    // 5 tentativas — devem retornar 401
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/auth/login').send(payload)
      expect(res.status).toBe(401)
    }

    // 6ª tentativa — deve retornar 429
    const res = await request(app).post('/api/auth/login').send(payload)
    expect(res.status).toBe(429)
  })
})
