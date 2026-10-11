import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import cookieParser from 'cookie-parser'
import type { Request, Response, NextFunction } from 'express'
import { criarMiddlewareAuth } from '../auth.js'
import { criarMiddlewareTenant, setTenant } from '../tenant.js'
import { executarComTenant } from '../../config/database.js'
import type { AuthService } from '../../services/auth.service.js'
import type { UsuarioPublico } from '../../repositories/usuario.repository.js'
import type { SessaoAtiva } from '../../repositories/sessao.repository.js'

// O middleware de tenant abre o escopo de conexão por request via
// `executarComTenant` (config/database). Aqui mockamos esse escopo para testar o
// contrato do middleware sem um PostgreSQL real; a verificação ponta-a-ponta do
// RLS fica para os testes de integração (tenant.integration.test.ts).
vi.mock('../../config/database.js', () => ({
  executarComTenant: vi.fn(
    async (_tenantId: string, fn: () => Promise<unknown>): Promise<unknown> => fn(),
  ),
}))

const executarComTenantMock = vi.mocked(executarComTenant)

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

    const res = await request(app).get('/protegido').set('Cookie', 'session=sessao-expirada')

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ erro: 'Sessão expirada' })
  })

  it('chama next() com sessão válida e retorna 200', async () => {
    const authService = makeAuthService()
    const app = makeApp(authService)

    const res = await request(app).get('/protegido').set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
  })

  it('popula req.usuario com sessão válida', async () => {
    const authService = makeAuthService()
    const app = makeApp(authService)

    const res = await request(app).get('/protegido').set('Cookie', 'session=sessao-id-1')

    expect(res.body.usuario.id).toBe('user-1')
    expect(res.body.usuario.email).toBe('ana@exemplo.com')
  })
})

describe('Middleware setTenant', () => {
  // Resposta fake mínima: o middleware anexa handlers em `finish`/`close` para
  // fechar o escopo quando a resposta termina. Guardamos esses handlers para
  // disparar manualmente e simular o fim do request.
  function makeRes(): { res: Response; finish: () => void } {
    const handlers: Record<string, Array<() => void>> = {}
    const res = {
      on(evento: string, cb: () => void) {
        ;(handlers[evento] ??= []).push(cb)
        return this
      },
    } as unknown as Response
    return {
      res,
      finish: () => (handlers['finish'] ?? []).forEach((cb) => cb()),
    }
  }

  function makeReq(tenantId: string): Request {
    return { usuario: { ...usuarioMock, tenantId } } as unknown as Request
  }

  beforeEach(() => {
    vi.clearAllMocks()
    executarComTenantMock.mockImplementation(
      async (_tenantId: string, fn: () => Promise<unknown>): Promise<unknown> => fn(),
    )
  })

  it('abre o escopo de tenant com o tenantId de req.usuario', async () => {
    const middleware = criarMiddlewareTenant()
    const next = vi.fn() as unknown as NextFunction
    const { res, finish } = makeRes()

    middleware(makeReq('tenant-xyz'), res, next)
    // O escopo foi aberto com o tenant correto.
    expect(executarComTenantMock).toHaveBeenCalledTimes(1)
    expect(executarComTenantMock.mock.calls[0]![0]).toBe('tenant-xyz')

    // next() é chamado dentro do escopo (handler do request segue o pipeline).
    expect(next).toHaveBeenCalledTimes(1)

    // Encerrar a resposta resolve a Promise interna, fechando o escopo.
    finish()
  })

  it('propaga o tenant do usuário logado (valor dinâmico por request)', async () => {
    const middleware = criarMiddlewareTenant()
    const next = vi.fn() as unknown as NextFunction

    const a = makeRes()
    const b = makeRes()
    middleware(makeReq('tenant-a'), a.res, next)
    middleware(makeReq('tenant-b'), b.res, next)

    expect(executarComTenantMock.mock.calls[0]![0]).toBe('tenant-a')
    expect(executarComTenantMock.mock.calls[1]![0]).toBe('tenant-b')
    a.finish()
    b.finish()
  })

  it('expõe o alias setTenant apontando para a mesma fábrica', () => {
    expect(setTenant).toBe(criarMiddlewareTenant)
  })
})
