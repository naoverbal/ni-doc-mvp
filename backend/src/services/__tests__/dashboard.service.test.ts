import { describe, it, expect, vi } from 'vitest'
import { criarDashboardService } from '../dashboard.service.js'
import type {
  DashboardRepository,
  OrcamentoDashboard,
} from '../../repositories/dashboard.repository.js'

function makeRepo(overrides?: Partial<DashboardRepository>): DashboardRepository {
  return {
    resumoPorStatus: vi.fn().mockResolvedValue([]),
    criadosPorPeriodo: vi.fn().mockResolvedValue([]),
    recentes: vi.fn().mockResolvedValue([]),
    pendentes: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

const ctx = { tenantId: 'tenant-1' }

describe('dashboardService.resumo', () => {
  it('retorna todos os status zerados e conversão nula sem orçamentos', async () => {
    const service = criarDashboardService({ dashboardRepo: makeRepo() })

    const resumo = await service.resumo(ctx)

    expect(Object.keys(resumo.porStatus).sort()).toEqual(
      ['aprovado', 'cancelado', 'enviado', 'expirado', 'rascunho', 'reprovado'].sort(),
    )
    expect(resumo.porStatus.aprovado).toEqual({ quantidade: 0, valor: 0 })
    expect(resumo.valorEmAberto).toBe(0)
    expect(resumo.valorEnviado).toBe(0)
    expect(resumo.valorAprovado).toBe(0)
    expect(resumo.taxaConversao).toBeNull()
  })

  it('calcula valores e taxa pelo status atual (enviado + aprovado + reprovado)', async () => {
    const repo = makeRepo({
      resumoPorStatus: vi.fn().mockResolvedValue([
        { status: 'enviado', quantidade: 2, valor: 200.1 },
        { status: 'aprovado', quantidade: 1, valor: 300.2 },
        { status: 'reprovado', quantidade: 1, valor: 50 },
        // Fora do denominador e do "valor enviado".
        { status: 'cancelado', quantidade: 5, valor: 999 },
        { status: 'expirado', quantidade: 3, valor: 10 },
        { status: 'rascunho', quantidade: 4, valor: 1 },
      ]),
    })
    const service = criarDashboardService({ dashboardRepo: repo })

    const resumo = await service.resumo(ctx)

    expect(repo.resumoPorStatus).toHaveBeenCalledWith('tenant-1')
    expect(resumo.valorEmAberto).toBe(200.1)
    expect(resumo.valorAprovado).toBe(300.2)
    expect(resumo.valorEnviado).toBe(550.3)
    expect(resumo.taxaConversao).toBeCloseTo(1 / 4)
    expect(resumo.porStatus.cancelado).toEqual({ quantidade: 5, valor: 999 })
  })
})

describe('dashboardService.criadosPorPeriodo', () => {
  it('monta rótulos pt-BR por granularidade', async () => {
    const repo = makeRepo({
      criadosPorPeriodo: vi.fn().mockResolvedValue([{ chave: '2025-03', quantidade: 4 }]),
    })
    const service = criarDashboardService({ dashboardRepo: repo })

    expect(await service.criadosPorPeriodo(ctx, { granularidade: 'mes' })).toEqual([
      { chave: '2025-03', rotulo: '03/2025', quantidade: 4 },
    ])

    vi.mocked(repo.criadosPorPeriodo).mockResolvedValue([{ chave: '2025-W03', quantidade: 1 }])
    expect(await service.criadosPorPeriodo(ctx, { granularidade: 'semana' })).toEqual([
      { chave: '2025-W03', rotulo: '2025-S03', quantidade: 1 },
    ])

    vi.mocked(repo.criadosPorPeriodo).mockResolvedValue([{ chave: '2025', quantidade: 9 }])
    expect(await service.criadosPorPeriodo(ctx, { granularidade: 'ano' })).toEqual([
      { chave: '2025', rotulo: '2025', quantidade: 9 },
    ])
  })

  it('repassa tenant e filtro ao repositório', async () => {
    const repo = makeRepo()
    const service = criarDashboardService({ dashboardRepo: repo })
    const filtro = { granularidade: 'mes' as const, de: '2025-01-01', ate: '2025-12-31' }

    await service.criadosPorPeriodo(ctx, filtro)

    expect(repo.criadosPorPeriodo).toHaveBeenCalledWith('tenant-1', filtro)
  })
})

describe('dashboardService.pendentes / recentes', () => {
  const base: OrcamentoDashboard = {
    id: 'o-1',
    numero: 'ORC-1',
    titulo: 'Obra',
    status: 'enviado',
    clienteId: 'c-1',
    clienteNome: 'Cliente Um',
    total: 100,
    criadoEm: new Date('2025-01-01T00:00:00Z'),
    enviadoEm: new Date('2025-01-02T12:00:00Z'),
    expiraEm: null,
  }

  it('calcula dias inteiros aguardando a partir do envio da versão vigente', async () => {
    const repo = makeRepo({
      pendentes: vi.fn().mockResolvedValue([base, { ...base, id: 'o-2', enviadoEm: null }]),
    })
    const service = criarDashboardService({
      dashboardRepo: repo,
      relogio: () => new Date('2025-01-05T11:00:00Z'),
    })

    const itens = await service.pendentes(ctx, 5)

    expect(repo.pendentes).toHaveBeenCalledWith('tenant-1', 5)
    expect(itens[0]?.diasAguardando).toBe(2)
    expect(itens[1]?.diasAguardando).toBeNull()
  })

  it('não retorna dias negativos quando o envio está no futuro', async () => {
    const repo = makeRepo({ recentes: vi.fn().mockResolvedValue([base]) })
    const service = criarDashboardService({
      dashboardRepo: repo,
      relogio: () => new Date('2024-12-01T00:00:00Z'),
    })

    const itens = await service.recentes(ctx, 3)

    expect(repo.recentes).toHaveBeenCalledWith('tenant-1', 3)
    expect(itens[0]?.diasAguardando).toBe(0)
  })
})
