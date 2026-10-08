import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarResponsavelService } from '../responsavel.service.js'
import type {
  ResponsavelRepository,
  ResponsavelPublico,
} from '../../repositories/responsavel.repository.js'
import type { AuditoriaService } from '../auditoria.service.js'

const responsavelMock: ResponsavelPublico = {
  id: 'responsavel-1',
  tenantId: 'tenant-1',
  nome: 'João Engenheiro',
  registroProfissional: 'CREA-123456',
  email: 'joao@exemplo.com',
  telefone: null,
  ativo: true,
  criadoEm: new Date('2024-01-01'),
}

function makeDeps(overrides?: {
  responsavelRepo?: Partial<ResponsavelRepository>
  auditoriaService?: Partial<AuditoriaService>
}) {
  const responsavelRepo: ResponsavelRepository = {
    criar: vi.fn().mockResolvedValue(responsavelMock),
    buscarPorId: vi.fn().mockResolvedValue(responsavelMock),
    buscarPorNome: vi.fn().mockResolvedValue([responsavelMock]),
    atualizar: vi.fn().mockResolvedValue(responsavelMock),
    desativar: vi.fn().mockResolvedValue(undefined),
    ...overrides?.responsavelRepo,
  }
  const auditoriaService: AuditoriaService = {
    registrar: vi.fn().mockResolvedValue(undefined),
    listar: vi.fn().mockResolvedValue([]),
    ...overrides?.auditoriaService,
  }
  return { responsavelRepo, auditoriaService }
}

const ctx = { tenantId: 'tenant-1', usuarioId: 'user-1' }

describe('ResponsavelService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('criar()', () => {
    it('cria responsável e delega ao repositório', async () => {
      const deps = makeDeps()
      const service = criarResponsavelService(deps)

      const result = await service.criar(ctx, {
        nome: 'João Engenheiro',
        registroProfissional: 'CREA-123456',
      })

      expect(result.id).toBe('responsavel-1')
      expect(deps.responsavelRepo.criar).toHaveBeenCalledOnce()
    })

    it('registra evento de auditoria ao criar', async () => {
      const deps = makeDeps()
      const service = criarResponsavelService(deps)

      await service.criar(ctx, { nome: 'João Engenheiro' })

      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'criar', entidade: 'responsaveis_tecnicos' }),
      )
    })
  })

  describe('buscarPorId()', () => {
    it('retorna responsável quando existe', async () => {
      const deps = makeDeps()
      const service = criarResponsavelService(deps)

      const result = await service.buscarPorId(ctx, 'responsavel-1')

      expect(result.id).toBe('responsavel-1')
      expect(deps.responsavelRepo.buscarPorId).toHaveBeenCalledWith('tenant-1', 'responsavel-1')
    })

    it('lança AppError(404) quando não existe', async () => {
      const deps = makeDeps({
        responsavelRepo: { buscarPorId: vi.fn().mockResolvedValue(null) },
      })
      const service = criarResponsavelService(deps)

      await expect(service.buscarPorId(ctx, 'inexistente')).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })

  describe('buscar()', () => {
    it('delega para buscarPorNome com o termo', async () => {
      const deps = makeDeps()
      const service = criarResponsavelService(deps)

      const result = await service.buscar(ctx, 'joa')

      expect(result).toHaveLength(1)
      expect(deps.responsavelRepo.buscarPorNome).toHaveBeenCalledWith('tenant-1', 'joa')
    })
  })

  describe('atualizar()', () => {
    it('atualiza apenas o cadastro do responsável', async () => {
      const deps = makeDeps()
      const service = criarResponsavelService(deps)

      const result = await service.atualizar(ctx, 'responsavel-1', { nome: 'João Souza' })

      expect(result.id).toBe('responsavel-1')
      expect(deps.responsavelRepo.atualizar).toHaveBeenCalledWith('tenant-1', 'responsavel-1', {
        nome: 'João Souza',
      })
    })

    it('lança AppError(404) quando responsável não existe', async () => {
      const deps = makeDeps({
        responsavelRepo: { atualizar: vi.fn().mockResolvedValue(null) },
      })
      const service = criarResponsavelService(deps)

      await expect(service.atualizar(ctx, 'inexistente', { nome: 'X' })).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    it('registra evento de auditoria ao atualizar', async () => {
      const deps = makeDeps()
      const service = criarResponsavelService(deps)

      await service.atualizar(ctx, 'responsavel-1', { nome: 'João Souza' })

      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'atualizar', entidade: 'responsaveis_tecnicos' }),
      )
    })
  })

  describe('desativar()', () => {
    it('faz soft delete e audita', async () => {
      const deps = makeDeps()
      const service = criarResponsavelService(deps)

      await service.desativar(ctx, 'responsavel-1')

      expect(deps.responsavelRepo.desativar).toHaveBeenCalledWith('tenant-1', 'responsavel-1')
      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'desativar', entidade: 'responsaveis_tecnicos' }),
      )
    })

    it('lança AppError(404) quando responsável não existe', async () => {
      const deps = makeDeps({
        responsavelRepo: { buscarPorId: vi.fn().mockResolvedValue(null) },
      })
      const service = criarResponsavelService(deps)

      await expect(service.desativar(ctx, 'inexistente')).rejects.toMatchObject({
        statusCode: 404,
      })
      expect(deps.responsavelRepo.desativar).not.toHaveBeenCalled()
    })
  })
})
