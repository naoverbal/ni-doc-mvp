import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarClienteService } from '../cliente.service.js'
import { hashDocumento } from '../../lib/crypto.js'
import type { ClienteRepository, ClientePublico } from '../../repositories/cliente.repository.js'
import type { AuditoriaService } from '../auditoria.service.js'

const CPF_VALIDO = '529.982.247-25'
const CNPJ_VALIDO = '11.222.333/0001-81'

const clienteMock: ClientePublico = {
  id: 'cliente-1',
  tenantId: 'tenant-1',
  tipoPessoa: 'PF',
  nome: 'Maria Silva',
  documento: '52998224725',
  email: 'maria@exemplo.com',
  telefone: null,
  endereco: null,
  observacoes: null,
  ativo: true,
  criadoEm: new Date('2024-01-01'),
}

function makeDeps(overrides?: {
  clienteRepo?: Partial<ClienteRepository>
  auditoriaService?: Partial<AuditoriaService>
}) {
  const clienteRepo: ClienteRepository = {
    criar: vi.fn().mockResolvedValue(clienteMock),
    buscarPorDocumentoHash: vi.fn().mockResolvedValue(null),
    buscarPorId: vi.fn().mockResolvedValue(clienteMock),
    buscarPorNome: vi.fn().mockResolvedValue([clienteMock]),
    atualizar: vi.fn().mockResolvedValue(clienteMock),
    desativar: vi.fn().mockResolvedValue(undefined),
    ...overrides?.clienteRepo,
  }
  const auditoriaService: AuditoriaService = {
    registrar: vi.fn().mockResolvedValue(undefined),
    listar: vi.fn().mockResolvedValue([]),
    ...overrides?.auditoriaService,
  }
  return { clienteRepo, auditoriaService }
}

const ctx = { tenantId: 'tenant-1', usuarioId: 'user-1' }

describe('ClienteService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('criar()', () => {
    it('cria cliente PF com CPF válido', async () => {
      const deps = makeDeps()
      const service = criarClienteService(deps)

      const result = await service.criar(ctx, {
        tipoPessoa: 'PF',
        nome: 'Maria Silva',
        documento: CPF_VALIDO,
      })

      expect(result.id).toBe('cliente-1')
      expect(deps.clienteRepo.criar).toHaveBeenCalledOnce()
    })

    it('cria cliente PJ com CNPJ válido', async () => {
      const deps = makeDeps()
      const service = criarClienteService(deps)

      await service.criar(ctx, {
        tipoPessoa: 'PJ',
        nome: 'Empresa X',
        documento: CNPJ_VALIDO,
      })

      expect(deps.clienteRepo.criar).toHaveBeenCalledOnce()
    })

    it('lança AppError(400) se CPF inválido', async () => {
      const deps = makeDeps()
      const service = criarClienteService(deps)

      await expect(
        service.criar(ctx, { tipoPessoa: 'PF', nome: 'X', documento: '111.111.111-11' }),
      ).rejects.toMatchObject({ statusCode: 400 })
      expect(deps.clienteRepo.criar).not.toHaveBeenCalled()
    })

    it('lança AppError(400) se CNPJ inválido', async () => {
      const deps = makeDeps()
      const service = criarClienteService(deps)

      await expect(
        service.criar(ctx, { tipoPessoa: 'PJ', nome: 'X', documento: '11.111.111/1111-11' }),
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('rejeita documento duplicado no mesmo tenant (409)', async () => {
      const deps = makeDeps({
        clienteRepo: { buscarPorDocumentoHash: vi.fn().mockResolvedValue(clienteMock) },
      })
      const service = criarClienteService(deps)

      await expect(
        service.criar(ctx, { tipoPessoa: 'PF', nome: 'Maria', documento: CPF_VALIDO }),
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(deps.clienteRepo.criar).not.toHaveBeenCalled()
    })

    it('verifica duplicidade pelo hash do documento no tenant', async () => {
      const buscarPorDocumentoHash = vi.fn().mockResolvedValue(null)
      const deps = makeDeps({ clienteRepo: { buscarPorDocumentoHash } })
      const service = criarClienteService(deps)

      await service.criar(ctx, { tipoPessoa: 'PF', nome: 'Maria', documento: CPF_VALIDO })

      expect(buscarPorDocumentoHash).toHaveBeenCalledWith('tenant-1', hashDocumento(CPF_VALIDO))
    })

    it('registra evento de auditoria ao criar', async () => {
      const deps = makeDeps()
      const service = criarClienteService(deps)

      await service.criar(ctx, { tipoPessoa: 'PF', nome: 'Maria', documento: CPF_VALIDO })

      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'criar', entidade: 'clientes' }),
      )
    })
  })

  describe('buscarPorId()', () => {
    it('retorna cliente quando existe', async () => {
      const deps = makeDeps()
      const service = criarClienteService(deps)

      const result = await service.buscarPorId(ctx, 'cliente-1')

      expect(result.id).toBe('cliente-1')
      expect(deps.clienteRepo.buscarPorId).toHaveBeenCalledWith('tenant-1', 'cliente-1')
    })

    it('lança AppError(404) quando não existe', async () => {
      const deps = makeDeps({
        clienteRepo: { buscarPorId: vi.fn().mockResolvedValue(null) },
      })
      const service = criarClienteService(deps)

      await expect(service.buscarPorId(ctx, 'inexistente')).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })

  describe('buscar()', () => {
    it('delega para buscarPorNome com o termo', async () => {
      const deps = makeDeps()
      const service = criarClienteService(deps)

      const result = await service.buscar(ctx, 'mar')

      expect(result).toHaveLength(1)
      expect(deps.clienteRepo.buscarPorNome).toHaveBeenCalledWith('tenant-1', 'mar')
    })
  })

  describe('atualizar()', () => {
    it('atualiza apenas o cadastro do cliente', async () => {
      const deps = makeDeps()
      const service = criarClienteService(deps)

      const result = await service.atualizar(ctx, 'cliente-1', { nome: 'Maria Souza' })

      expect(result.id).toBe('cliente-1')
      expect(deps.clienteRepo.atualizar).toHaveBeenCalledWith('tenant-1', 'cliente-1', {
        nome: 'Maria Souza',
      })
    })

    it('lança AppError(404) quando cliente não existe', async () => {
      const deps = makeDeps({
        clienteRepo: { atualizar: vi.fn().mockResolvedValue(null) },
      })
      const service = criarClienteService(deps)

      await expect(service.atualizar(ctx, 'inexistente', { nome: 'X' })).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    it('registra evento de auditoria ao atualizar', async () => {
      const deps = makeDeps()
      const service = criarClienteService(deps)

      await service.atualizar(ctx, 'cliente-1', { nome: 'Maria Souza' })

      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'atualizar', entidade: 'clientes' }),
      )
    })
  })

  describe('desativar()', () => {
    it('faz soft delete e audita', async () => {
      const deps = makeDeps()
      const service = criarClienteService(deps)

      await service.desativar(ctx, 'cliente-1')

      expect(deps.clienteRepo.desativar).toHaveBeenCalledWith('tenant-1', 'cliente-1')
      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'desativar', entidade: 'clientes' }),
      )
    })

    it('lança AppError(404) quando cliente não existe', async () => {
      const deps = makeDeps({
        clienteRepo: { buscarPorId: vi.fn().mockResolvedValue(null) },
      })
      const service = criarClienteService(deps)

      await expect(service.desativar(ctx, 'inexistente')).rejects.toMatchObject({
        statusCode: 404,
      })
      expect(deps.clienteRepo.desativar).not.toHaveBeenCalled()
    })
  })
})
