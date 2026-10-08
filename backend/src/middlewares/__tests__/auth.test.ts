import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import cookieParser from 'cookie-parser'
import type { Request, Response, NextFunction } from 'express'
import { Kysely, PostgresDialect, type CompiledQuery } from 'kysely'
import { Pool } from 'pg'
import { criarMiddlewareAuth } from '../auth.js'
import { criarMiddlewareTenant, setTenant } from '../tenant.js'
import type { AuthService } from '../../services/auth.service.js'
import type { UsuarioPublico } from '../../repositories/usuario.repository.js'
import type { SessaoAtiva } from '../../repositories/sessao.repository.js'
import type { Database } from '../../types/database.js'

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
  function makeDbMock() {
    // Instância real do Kysely (necessária para compilar o `sql` template),
    // mas SEM conexão: o Pool nunca é usado porque executeQuery é um spy.
    const db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool() }),
    })
    const executeQuery = vi.spyOn(db, 'executeQuery').mockResolvedValue({ rows: [] } as never)
    return { db, executeQuery }
  }

  function makeReq(tenantId: string): Request {
    return { usuario: { ...usuarioMock, tenantId } } as unknown as Request
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('executa set_config com o tenantId de req.usuario antes de next()', async () => {
    const { db, executeQuery } = makeDbMock()
    const middleware = criarMiddlewareTenant(db)
    const next = vi.fn() as unknown as NextFunction
    const req = makeReq('tenant-xyz')

    await middleware(req, {} as Response, next)

    // SQL foi executado exatamente uma vez com o tenant correto.
    expect(executeQuery).toHaveBeenCalledTimes(1)
    const compiled = executeQuery.mock.calls[0]![0] as unknown as CompiledQuery
    expect(compiled.sql.toLowerCase()).toContain('set_config')
    expect(compiled.sql).toContain('app.current_tenant')
    expect(compiled.parameters).toContain('tenant-xyz')

    // next() foi chamado uma vez, sem erro.
    expect(next).toHaveBeenCalledTimes(1)
    expect((next as unknown as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(0)
  })

  it('executa o SET do tenant ANTES de chamar next()', async () => {
    const { db, executeQuery } = makeDbMock()
    const ordem: string[] = []
    executeQuery.mockImplementation(async () => {
      ordem.push('set_config')
      return { rows: [] }
    })
    const next = vi.fn(() => {
      ordem.push('next')
    }) as unknown as NextFunction
    const middleware = criarMiddlewareTenant(db)

    await middleware(makeReq('tenant-1'), {} as Response, next)

    expect(ordem).toEqual(['set_config', 'next'])
  })

  it('propaga o tenant do usuário logado (valor dinâmico por request)', async () => {
    const { db, executeQuery } = makeDbMock()
    const middleware = criarMiddlewareTenant(db)
    const next = vi.fn() as unknown as NextFunction

    await middleware(makeReq('tenant-a'), {} as Response, next)
    await middleware(makeReq('tenant-b'), {} as Response, next)

    const paramsA = (executeQuery.mock.calls[0]![0] as unknown as CompiledQuery).parameters
    const paramsB = (executeQuery.mock.calls[1]![0] as unknown as CompiledQuery).parameters
    expect(paramsA).toContain('tenant-a')
    expect(paramsB).toContain('tenant-b')
  })

  it('expõe o alias setTenant apontando para a mesma fábrica', () => {
    expect(setTenant).toBe(criarMiddlewareTenant)
  })
})
