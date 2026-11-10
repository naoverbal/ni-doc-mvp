import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import cookieParser from 'cookie-parser'
import { criarDashboardRouter } from '../dashboard.routes.js'
import { errorHandler } from '../../middlewares/error-handler.js'
import type { AuthService } from '../../services/auth.service.js'
import type { DashboardService } from '../../services/dashboard.service.js'
import type { UsuarioPublico } from '../../repositories/usuario.repository.js'
import type { SessaoAtiva } from '../../repositories/sessao.repository.js'

// `setTenant` usaria o pool `pg` real; o mock vira passthrough (ver
// clientes.routes.test.ts). Não reproduz o RLS de produção.
vi.mock('../../config/database.js', async () => {
  const { fakeDatabaseModule } = await import('../../__tests__/mock-tenant.js')
  return fakeDatabaseModule()
})

const usuarioMock: UsuarioPublico = {
  id: 'user-1',
  tenantId: 'tenant-1',
  nome: 'Ana Costa',
  email: 'ana@exemplo.com',
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

function makeAuthService(overrides?: Partial<AuthService>): AuthService {
  return {
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    validarSessao: vi.fn().mockResolvedValue({ usuario: usuarioMock, sessao: sessaoMock }),
    ...overrides,
  }
}

function makeDashboardService(overrides?: Partial<DashboardService>): DashboardService {
  return {
    resumo: vi.fn().mockResolvedValue({ porStatus: {}, taxaConversao: null }),
    criadosPorPeriodo: vi.fn().mockResolvedValue([]),
    enviadosPorPeriodo: vi.fn().mockResolvedValue([]),
    aprovadosPorPeriodo: vi.fn().mockResolvedValue([]),
    recentes: vi.fn().mockResolvedValue([]),
    pendentes: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

function makeApp(service: DashboardService, authService: AuthService) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/dashboard', criarDashboardRouter(service, authService))
  app.use(errorHandler)
  return app
}

describe('rotas /api/dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exige autenticação (401 sem sessão)', async () => {
    const service = makeDashboardService()
    const res = await request(makeApp(service, makeAuthService())).get('/api/dashboard/resumo')

    expect(res.status).toBe(401)
    expect(service.resumo).not.toHaveBeenCalled()
  })

  it('GET /resumo usa o tenant do usuário logado', async () => {
    const service = makeDashboardService()
    const res = await request(makeApp(service, makeAuthService()))
      .get('/api/dashboard/resumo')
      .set('Cookie', 'session=abc')

    expect(res.status).toBe(200)
    expect(service.resumo).toHaveBeenCalledWith({ tenantId: 'tenant-1' })
  })

  it('GET /criados aplica o padrão (mes) e repassa o intervalo', async () => {
    const service = makeDashboardService()
    const app = makeApp(service, makeAuthService())

    await request(app).get('/api/dashboard/criados').set('Cookie', 'session=abc')
    expect(service.criadosPorPeriodo).toHaveBeenLastCalledWith(
      { tenantId: 'tenant-1' },
      { granularidade: 'mes' },
    )

    await request(app)
      .get('/api/dashboard/criados?granularidade=semana&de=2025-01-01&ate=2025-03-31')
      .set('Cookie', 'session=abc')
    expect(service.criadosPorPeriodo).toHaveBeenLastCalledWith(
      { tenantId: 'tenant-1' },
      { granularidade: 'semana', de: '2025-01-01', ate: '2025-03-31' },
    )
  })

  it.each([
    ['granularidade inválida', 'granularidade=dia'],
    ['data fora do formato', 'de=01/01/2025'],
    ['data inexistente', 'de=2025-02-30'],
    ['intervalo invertido', 'de=2025-05-01&ate=2025-04-01'],
  ])('GET /criados retorna 400 para %s', async (_nome, query) => {
    const service = makeDashboardService()
    const res = await request(makeApp(service, makeAuthService()))
      .get(`/api/dashboard/criados?${query}`)
      .set('Cookie', 'session=abc')

    expect(res.status).toBe(400)
    expect(service.criadosPorPeriodo).not.toHaveBeenCalled()
  })

  it.each([
    ['enviados', 'enviadosPorPeriodo'],
    ['aprovados', 'aprovadosPorPeriodo'],
  ] as const)('GET /%s aplica o padrão (mes) e repassa o intervalo', async (rota, metodo) => {
    const service = makeDashboardService()
    const app = makeApp(service, makeAuthService())

    await request(app).get(`/api/dashboard/${rota}`).set('Cookie', 'session=abc')
    expect(service[metodo]).toHaveBeenLastCalledWith(
      { tenantId: 'tenant-1' },
      { granularidade: 'mes' },
    )

    await request(app)
      .get(`/api/dashboard/${rota}?granularidade=ano&de=2025-01-01&ate=2025-12-31`)
      .set('Cookie', 'session=abc')
    expect(service[metodo]).toHaveBeenLastCalledWith(
      { tenantId: 'tenant-1' },
      { granularidade: 'ano', de: '2025-01-01', ate: '2025-12-31' },
    )
  })

  it.each(['enviados', 'aprovados'])('GET /%s retorna 400 para intervalo invertido', async (rota) => {
    const service = makeDashboardService()
    const res = await request(makeApp(service, makeAuthService()))
      .get(`/api/dashboard/${rota}?de=2025-05-01&ate=2025-04-01`)
      .set('Cookie', 'session=abc')

    expect(res.status).toBe(400)
    expect(service.enviadosPorPeriodo).not.toHaveBeenCalled()
    expect(service.aprovadosPorPeriodo).not.toHaveBeenCalled()
  })

  it.each(['recentes', 'pendentes'] as const)('GET /%s usa limite padrão 5', async (rota) => {
    const service = makeDashboardService()
    const res = await request(makeApp(service, makeAuthService()))
      .get(`/api/dashboard/${rota}`)
      .set('Cookie', 'session=abc')

    expect(res.status).toBe(200)
    expect(service[rota]).toHaveBeenCalledWith({ tenantId: 'tenant-1' }, 5)
  })

  it.each(['0', '51', 'abc', '1.5'])('GET /recentes retorna 400 para limite=%s', async (limite) => {
    const service = makeDashboardService()
    const res = await request(makeApp(service, makeAuthService()))
      .get(`/api/dashboard/recentes?limite=${limite}`)
      .set('Cookie', 'session=abc')

    expect(res.status).toBe(400)
    expect(service.recentes).not.toHaveBeenCalled()
  })
})
