import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarTemplateService } from '../template.service.js'
import type {
  LayoutTemplate,
  TemplatePublico,
  TemplateRepository,
} from '../../repositories/template.repository.js'
import type { AuditoriaService } from '../auditoria.service.js'

const layout: LayoutTemplate = { formato: 'A4', orientacao: 'retrato', secoes: [] }

function templateMock(versao = 1, id = 'template-1'): TemplatePublico {
  return {
    id,
    tenantId: 'tenant-1',
    versao,
    layoutJson: layout,
    criadoEm: new Date('2024-01-01'),
  }
}

function makeDeps(overrides?: {
  templateRepo?: Partial<TemplateRepository>
  auditoriaService?: Partial<AuditoriaService>
}) {
  const templateRepo: TemplateRepository = {
    criarTemplatePadrao: vi.fn().mockResolvedValue(templateMock()),
    salvar: vi.fn().mockResolvedValue(templateMock()),
    buscarAtivo: vi.fn().mockResolvedValue(templateMock()),
    buscarPorId: vi.fn().mockResolvedValue(templateMock()),
    ...overrides?.templateRepo,
  }
  const auditoriaService: AuditoriaService = {
    registrar: vi.fn().mockResolvedValue(undefined),
    listar: vi.fn().mockResolvedValue([]),
    ...overrides?.auditoriaService,
  }
  return { templateRepo, auditoriaService }
}

const ctx = { tenantId: 'tenant-1', usuarioId: 'user-1' }

describe('TemplateService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('criarTemplatePadrao()', () => {
    it('delega ao repositório e retorna o resultado', async () => {
      const deps = makeDeps()
      const service = criarTemplateService(deps)

      const result = await service.criarTemplatePadrao('tenant-1')

      expect(result.versao).toBe(1)
      expect(deps.templateRepo.criarTemplatePadrao).toHaveBeenCalledWith('tenant-1')
    })

    it('não registra auditoria (criação automática no bootstrap do tenant)', async () => {
      const deps = makeDeps()
      const service = criarTemplateService(deps)

      await service.criarTemplatePadrao('tenant-1')

      expect(deps.auditoriaService.registrar).not.toHaveBeenCalled()
    })
  })

  describe('salvar()', () => {
    it('delega ao repositório com tenantId do contexto e o layout informado', async () => {
      const deps = makeDeps()
      const service = criarTemplateService(deps)

      const result = await service.salvar(ctx, layout)

      expect(result.id).toBe('template-1')
      expect(deps.templateRepo.salvar).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        layoutJson: layout,
      })
    })

    it('registra auditoria com acao atualizar e entidade templates', async () => {
      const deps = makeDeps({
        templateRepo: { salvar: vi.fn().mockResolvedValue(templateMock(2, 'template-2')) },
      })
      const service = criarTemplateService(deps)

      await service.salvar(ctx, layout)

      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: 'atualizar',
          entidade: 'templates',
          entidadeId: 'template-2',
        }),
      )
    })

    it('retorna o TemplatePublico devolvido pelo repositório', async () => {
      const deps = makeDeps({
        templateRepo: { salvar: vi.fn().mockResolvedValue(templateMock(2, 'template-2')) },
      })
      const service = criarTemplateService(deps)

      const result = await service.salvar(ctx, layout)

      expect(result.versao).toBe(2)
    })
  })

  describe('buscarAtivo()', () => {
    it('retorna o template ativo quando existe', async () => {
      const deps = makeDeps()
      const service = criarTemplateService(deps)

      const result = await service.buscarAtivo(ctx)

      expect(result.id).toBe('template-1')
      expect(deps.templateRepo.buscarAtivo).toHaveBeenCalledWith('tenant-1')
    })

    it('lança AppError(404) quando não há template ativo', async () => {
      const deps = makeDeps({
        templateRepo: { buscarAtivo: vi.fn().mockResolvedValue(null) },
      })
      const service = criarTemplateService(deps)

      await expect(service.buscarAtivo(ctx)).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('buscarPorId()', () => {
    it('retorna a versão quando existe e delega com tenantId e id', async () => {
      const deps = makeDeps()
      const service = criarTemplateService(deps)

      const result = await service.buscarPorId(ctx, 'template-1')

      expect(result.id).toBe('template-1')
      expect(deps.templateRepo.buscarPorId).toHaveBeenCalledWith('tenant-1', 'template-1')
    })

    it('lança AppError(404) quando a versão não existe', async () => {
      const deps = makeDeps({
        templateRepo: { buscarPorId: vi.fn().mockResolvedValue(null) },
      })
      const service = criarTemplateService(deps)

      await expect(service.buscarPorId(ctx, 'inexistente')).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })

  describe('DoD — versionamento visível no serviço', () => {
    it('ao salvar duas vezes repassa ambas as versões e audita cada salvamento', async () => {
      const deps = makeDeps({
        templateRepo: {
          salvar: vi
            .fn()
            .mockResolvedValueOnce(templateMock(1, 'template-1'))
            .mockResolvedValueOnce(templateMock(2, 'template-2')),
          buscarPorId: vi.fn().mockResolvedValue(templateMock(1, 'template-1')),
        },
      })
      const service = criarTemplateService(deps)

      const v1 = await service.salvar(ctx, layout)
      const v2 = await service.salvar(ctx, layout)

      expect(v1.versao).toBe(1)
      expect(v2.versao).toBe(2)
      expect(deps.auditoriaService.registrar).toHaveBeenCalledTimes(2)

      // v1 permanece acessível (salvar não a sobrescreve).
      const recuperada = await service.buscarPorId(ctx, 'template-1')
      expect(recuperada.versao).toBe(1)
    })
  })
})
