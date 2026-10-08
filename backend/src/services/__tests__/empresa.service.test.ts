import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarEmpresaService } from '../empresa.service.js'
import { hashDocumento } from '../../lib/crypto.js'
import type { EmpresaRepository, EmpresaPublica } from '../../repositories/empresa.repository.js'
import type { AuditoriaService } from '../auditoria.service.js'

const CNPJ_VALIDO = '11.222.333/0001-81'
const CNPJ_INVALIDO = '11.111.111/1111-11'

const empresaMock: EmpresaPublica = {
  id: 'empresa-1',
  tenantId: 'tenant-1',
  tipo: 'cliente_pj',
  razaoSocial: 'Acme Indústria Ltda',
  nomeFantasia: 'Acme',
  cnpj: '11222333000181',
  email: 'contato@acme.com',
  telefone: null,
  endereco: null,
  ativo: true,
  criadoEm: new Date('2024-01-01'),
}

function makeDeps(overrides?: {
  empresaRepo?: Partial<EmpresaRepository>
  auditoriaService?: Partial<AuditoriaService>
}) {
  const empresaRepo: EmpresaRepository = {
    criar: vi.fn().mockResolvedValue(empresaMock),
    buscarPorCnpjHash: vi.fn().mockResolvedValue(null),
    buscarPorId: vi.fn().mockResolvedValue(empresaMock),
    buscarPorNomeETipo: vi.fn().mockResolvedValue([empresaMock]),
    atualizar: vi.fn().mockResolvedValue(empresaMock),
    desativar: vi.fn().mockResolvedValue(undefined),
    ...overrides?.empresaRepo,
  }
  const auditoriaService: AuditoriaService = {
    registrar: vi.fn().mockResolvedValue(undefined),
    listar: vi.fn().mockResolvedValue([]),
    ...overrides?.auditoriaService,
  }
  return { empresaRepo, auditoriaService }
}

const ctx = { tenantId: 'tenant-1', usuarioId: 'user-1' }

describe('EmpresaService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('criar()', () => {
    it('cria empresa com CNPJ válido', async () => {
      const deps = makeDeps()
      const service = criarEmpresaService(deps)

      const result = await service.criar(ctx, {
        tipo: 'cliente_pj',
        razaoSocial: 'Acme Indústria Ltda',
        cnpj: CNPJ_VALIDO,
      })

      expect(result.id).toBe('empresa-1')
      expect(deps.empresaRepo.criar).toHaveBeenCalledOnce()
    })

    it('cria empresa SEM CNPJ (sem validação nem checagem de duplicidade)', async () => {
      const deps = makeDeps()
      const service = criarEmpresaService(deps)

      await service.criar(ctx, {
        tipo: 'tenant',
        razaoSocial: 'Minha Empresa Ltda',
      })

      expect(deps.empresaRepo.buscarPorCnpjHash).not.toHaveBeenCalled()
      expect(deps.empresaRepo.criar).toHaveBeenCalledOnce()
      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'criar', entidade: 'empresas' }),
      )
    })

    it('lança AppError(400) se CNPJ inválido', async () => {
      const deps = makeDeps()
      const service = criarEmpresaService(deps)

      await expect(
        service.criar(ctx, {
          tipo: 'cliente_pj',
          razaoSocial: 'X',
          cnpj: CNPJ_INVALIDO,
        }),
      ).rejects.toMatchObject({ statusCode: 400 })
      expect(deps.empresaRepo.criar).not.toHaveBeenCalled()
    })

    it('rejeita CNPJ duplicado no mesmo tenant (409)', async () => {
      const deps = makeDeps({
        empresaRepo: { buscarPorCnpjHash: vi.fn().mockResolvedValue(empresaMock) },
      })
      const service = criarEmpresaService(deps)

      await expect(
        service.criar(ctx, {
          tipo: 'cliente_pj',
          razaoSocial: 'Acme',
          cnpj: CNPJ_VALIDO,
        }),
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(deps.empresaRepo.criar).not.toHaveBeenCalled()
    })

    it('verifica duplicidade pelo hash do CNPJ no tenant', async () => {
      const buscarPorCnpjHash = vi.fn().mockResolvedValue(null)
      const deps = makeDeps({ empresaRepo: { buscarPorCnpjHash } })
      const service = criarEmpresaService(deps)

      await service.criar(ctx, {
        tipo: 'cliente_pj',
        razaoSocial: 'Acme',
        cnpj: CNPJ_VALIDO,
      })

      expect(buscarPorCnpjHash).toHaveBeenCalledWith('tenant-1', hashDocumento(CNPJ_VALIDO))
    })

    it('registra evento de auditoria ao criar', async () => {
      const deps = makeDeps()
      const service = criarEmpresaService(deps)

      await service.criar(ctx, {
        tipo: 'cliente_pj',
        razaoSocial: 'Acme',
        cnpj: CNPJ_VALIDO,
      })

      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'criar', entidade: 'empresas' }),
      )
    })
  })

  describe('buscarPorId()', () => {
    it('retorna empresa quando existe', async () => {
      const deps = makeDeps()
      const service = criarEmpresaService(deps)

      const result = await service.buscarPorId(ctx, 'empresa-1')

      expect(result.id).toBe('empresa-1')
      expect(deps.empresaRepo.buscarPorId).toHaveBeenCalledWith('tenant-1', 'empresa-1')
    })

    it('lança AppError(404) quando não existe', async () => {
      const deps = makeDeps({
        empresaRepo: { buscarPorId: vi.fn().mockResolvedValue(null) },
      })
      const service = criarEmpresaService(deps)

      await expect(service.buscarPorId(ctx, 'inexistente')).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })

  describe('buscar()', () => {
    it('delega para buscarPorNomeETipo com termo e tipo', async () => {
      const deps = makeDeps()
      const service = criarEmpresaService(deps)

      const result = await service.buscar(ctx, 'acme', 'cliente_pj')

      expect(result).toHaveLength(1)
      expect(deps.empresaRepo.buscarPorNomeETipo).toHaveBeenCalledWith(
        'tenant-1',
        'acme',
        'cliente_pj',
      )
    })
  })

  describe('atualizar()', () => {
    it('atualiza apenas o cadastro da empresa', async () => {
      const deps = makeDeps()
      const service = criarEmpresaService(deps)

      const result = await service.atualizar(ctx, 'empresa-1', { razaoSocial: 'Acme S.A.' })

      expect(result.id).toBe('empresa-1')
      expect(deps.empresaRepo.atualizar).toHaveBeenCalledWith('tenant-1', 'empresa-1', {
        razaoSocial: 'Acme S.A.',
      })
    })

    it('lança AppError(404) quando empresa não existe', async () => {
      const deps = makeDeps({
        empresaRepo: { atualizar: vi.fn().mockResolvedValue(null) },
      })
      const service = criarEmpresaService(deps)

      await expect(
        service.atualizar(ctx, 'inexistente', { razaoSocial: 'X' }),
      ).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    it('registra evento de auditoria ao atualizar', async () => {
      const deps = makeDeps()
      const service = criarEmpresaService(deps)

      await service.atualizar(ctx, 'empresa-1', { razaoSocial: 'Acme S.A.' })

      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'atualizar', entidade: 'empresas' }),
      )
    })
  })

  describe('desativar()', () => {
    it('faz soft delete e audita', async () => {
      const deps = makeDeps()
      const service = criarEmpresaService(deps)

      await service.desativar(ctx, 'empresa-1')

      expect(deps.empresaRepo.desativar).toHaveBeenCalledWith('tenant-1', 'empresa-1')
      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'desativar', entidade: 'empresas' }),
      )
    })

    it('lança AppError(404) quando empresa não existe', async () => {
      const deps = makeDeps({
        empresaRepo: { buscarPorId: vi.fn().mockResolvedValue(null) },
      })
      const service = criarEmpresaService(deps)

      await expect(service.desativar(ctx, 'inexistente')).rejects.toMatchObject({
        statusCode: 404,
      })
      expect(deps.empresaRepo.desativar).not.toHaveBeenCalled()
    })
  })
})
