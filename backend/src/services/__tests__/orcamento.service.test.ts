import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarOrcamentoService } from '../orcamento.service.js'
import type {
  ListaOrcamentos,
  OrcamentoComItens,
  OrcamentoRepository,
  OrcamentoStatus,
} from '../../repositories/orcamento.repository.js'
import type { AuditoriaService } from '../auditoria.service.js'

function orcamentoMock(status: OrcamentoStatus = 'rascunho'): OrcamentoComItens {
  return {
    id: 'orcamento-1',
    tenantId: 'tenant-1',
    numero: 'ORC-2024-0001',
    clienteId: 'cliente-1',
    empresaClienteId: null,
    usuarioId: 'user-1',
    titulo: 'Projeto X',
    descricao: null,
    status,
    dataEmissao: new Date('2024-01-01'),
    validadeDias: 30,
    descontoGlobalTipo: null,
    descontoGlobalValor: null,
    subtotal: 100,
    total: 100,
    versaoAtual: 1,
    observacoes: null,
    condicoesPagamento: null,
    criadoEm: new Date('2024-01-01'),
    atualizadoEm: new Date('2024-01-01'),
    itens: [
      {
        id: 'item-1',
        ordem: 1,
        nome: 'Serviço A',
        descricao: null,
        quantidade: 1,
        unidade: 'un',
        valorUnitario: 100,
        descontoTipo: null,
        descontoValor: null,
        total: 100,
        responsavelId: null,
      },
    ],
  }
}

const listaMock: ListaOrcamentos = {
  itens: [
    {
      id: 'orcamento-1',
      numero: 'ORC-2024-0001',
      titulo: 'Projeto X',
      status: 'rascunho',
      clienteId: 'cliente-1',
      subtotal: 100,
      total: 100,
      versaoAtual: 1,
      dataEmissao: new Date('2024-01-01'),
      criadoEm: new Date('2024-01-01'),
    },
  ],
  total: 1,
  pagina: 1,
  tamanhoPagina: 20,
}

function makeDeps(overrides?: {
  orcamentoRepo?: Partial<OrcamentoRepository>
  auditoriaService?: Partial<AuditoriaService>
}) {
  const orcamentoRepo: OrcamentoRepository = {
    criar: vi.fn().mockResolvedValue(orcamentoMock()),
    buscarPorId: vi.fn().mockResolvedValue(orcamentoMock()),
    atualizar: vi.fn().mockResolvedValue(orcamentoMock()),
    listarPorTenant: vi.fn().mockResolvedValue(listaMock),
    deletar: vi.fn().mockResolvedValue(undefined),
    ...overrides?.orcamentoRepo,
  }
  const auditoriaService: AuditoriaService = {
    registrar: vi.fn().mockResolvedValue(undefined),
    listar: vi.fn().mockResolvedValue([]),
    ...overrides?.auditoriaService,
  }
  return { orcamentoRepo, auditoriaService }
}

const ctx = { tenantId: 'tenant-1', usuarioId: 'user-1' }

const dadosValidos = {
  clienteId: 'cliente-1',
  titulo: 'Projeto X',
  itens: [{ nome: 'Serviço A', quantidade: 1, valorUnitario: 100 }],
}

describe('OrcamentoService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('criar()', () => {
    it('delega ao repositório com tenantId e usuarioId do contexto', async () => {
      const deps = makeDeps()
      const service = criarOrcamentoService(deps)

      const result = await service.criar(ctx, dadosValidos)

      expect(result.id).toBe('orcamento-1')
      expect(deps.orcamentoRepo.criar).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          usuarioId: 'user-1',
          clienteId: 'cliente-1',
          titulo: 'Projeto X',
        }),
      )
    })

    it('lança AppError(400) quando a lista de itens está vazia', async () => {
      const deps = makeDeps()
      const service = criarOrcamentoService(deps)

      await expect(service.criar(ctx, { ...dadosValidos, itens: [] })).rejects.toMatchObject({
        statusCode: 400,
      })
      expect(deps.orcamentoRepo.criar).not.toHaveBeenCalled()
    })

    it('lança AppError(400) quando o título está vazio', async () => {
      const deps = makeDeps()
      const service = criarOrcamentoService(deps)

      await expect(service.criar(ctx, { ...dadosValidos, titulo: '   ' })).rejects.toMatchObject({
        statusCode: 400,
      })
      expect(deps.orcamentoRepo.criar).not.toHaveBeenCalled()
    })

    it('lança AppError(400) quando o cliente não é informado', async () => {
      const deps = makeDeps()
      const service = criarOrcamentoService(deps)

      await expect(service.criar(ctx, { ...dadosValidos, clienteId: '' })).rejects.toMatchObject({
        statusCode: 400,
      })
      expect(deps.orcamentoRepo.criar).not.toHaveBeenCalled()
    })

    it('registra evento de auditoria ao criar', async () => {
      const deps = makeDeps()
      const service = criarOrcamentoService(deps)

      await service.criar(ctx, dadosValidos)

      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: 'criar',
          entidade: 'orcamentos',
          entidadeId: 'orcamento-1',
        }),
      )
    })
  })

  describe('buscarPorId()', () => {
    it('retorna o orçamento quando existe', async () => {
      const deps = makeDeps()
      const service = criarOrcamentoService(deps)

      const result = await service.buscarPorId(ctx, 'orcamento-1')

      expect(result.id).toBe('orcamento-1')
      expect(deps.orcamentoRepo.buscarPorId).toHaveBeenCalledWith('tenant-1', 'orcamento-1')
    })

    it('lança AppError(404) quando não existe', async () => {
      const deps = makeDeps({
        orcamentoRepo: { buscarPorId: vi.fn().mockResolvedValue(null) },
      })
      const service = criarOrcamentoService(deps)

      await expect(service.buscarPorId(ctx, 'inexistente')).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })

  describe('listar()', () => {
    it('delega para listarPorTenant repassando o filtro', async () => {
      const deps = makeDeps()
      const service = criarOrcamentoService(deps)

      const filtro = { status: 'rascunho' as const, pagina: 2 }
      const result = await service.listar(ctx, filtro)

      expect(result.total).toBe(1)
      expect(deps.orcamentoRepo.listarPorTenant).toHaveBeenCalledWith('tenant-1', filtro)
    })

    it('respeita o isolamento de tenant sem filtro', async () => {
      const deps = makeDeps()
      const service = criarOrcamentoService(deps)

      await service.listar(ctx)

      expect(deps.orcamentoRepo.listarPorTenant).toHaveBeenCalledWith('tenant-1', undefined)
    })
  })

  describe('atualizar()', () => {
    const itens = [{ nome: 'Serviço A', quantidade: 1, valorUnitario: 100 }]

    it('atualiza quando o status é rascunho e audita', async () => {
      const deps = makeDeps()
      const service = criarOrcamentoService(deps)

      const result = await service.atualizar(ctx, 'orcamento-1', { titulo: 'Novo', itens })

      expect(result.id).toBe('orcamento-1')
      expect(deps.orcamentoRepo.atualizar).toHaveBeenCalledWith('tenant-1', 'orcamento-1', {
        titulo: 'Novo',
        itens,
      })
      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'atualizar', entidade: 'orcamentos' }),
      )
    })

    it('lança AppError(404) quando o orçamento não existe', async () => {
      const deps = makeDeps({
        orcamentoRepo: { buscarPorId: vi.fn().mockResolvedValue(null) },
      })
      const service = criarOrcamentoService(deps)

      await expect(
        service.atualizar(ctx, 'inexistente', { titulo: 'X', itens }),
      ).rejects.toMatchObject({ statusCode: 404 })
      expect(deps.orcamentoRepo.atualizar).not.toHaveBeenCalled()
    })

    it('lança AppError(409) quando o status não é rascunho', async () => {
      const deps = makeDeps({
        orcamentoRepo: { buscarPorId: vi.fn().mockResolvedValue(orcamentoMock('enviado')) },
      })
      const service = criarOrcamentoService(deps)

      await expect(
        service.atualizar(ctx, 'orcamento-1', { titulo: 'X', itens }),
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(deps.orcamentoRepo.atualizar).not.toHaveBeenCalled()
    })
  })

  describe('deletar()', () => {
    it('deleta quando o status é rascunho e audita', async () => {
      const deps = makeDeps()
      const service = criarOrcamentoService(deps)

      await service.deletar(ctx, 'orcamento-1')

      expect(deps.orcamentoRepo.deletar).toHaveBeenCalledWith('tenant-1', 'orcamento-1')
      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'deletar', entidade: 'orcamentos' }),
      )
    })

    it('lança AppError(404) quando o orçamento não existe', async () => {
      const deps = makeDeps({
        orcamentoRepo: { buscarPorId: vi.fn().mockResolvedValue(null) },
      })
      const service = criarOrcamentoService(deps)

      await expect(service.deletar(ctx, 'inexistente')).rejects.toMatchObject({ statusCode: 404 })
      expect(deps.orcamentoRepo.deletar).not.toHaveBeenCalled()
    })

    it('lança AppError(409) quando o status não é rascunho', async () => {
      const deps = makeDeps({
        orcamentoRepo: { buscarPorId: vi.fn().mockResolvedValue(orcamentoMock('aprovado')) },
      })
      const service = criarOrcamentoService(deps)

      await expect(service.deletar(ctx, 'orcamento-1')).rejects.toMatchObject({ statusCode: 409 })
      expect(deps.orcamentoRepo.deletar).not.toHaveBeenCalled()
    })
  })
})
