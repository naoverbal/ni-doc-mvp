import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarAuditoriaService } from '../auditoria.service.js'
import type { AuditoriaRepository, EventoAuditoria } from '../../repositories/auditoria.repository.js'

function makeRepo(overrides?: Partial<AuditoriaRepository>): AuditoriaRepository {
  return {
    criar: vi.fn().mockResolvedValue({ id: 'evento-id-1' }),
    listar: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

const baseEvento: EventoAuditoria = {
  id: 'evento-id-1',
  tenant_id: 'tenant-1',
  usuario_id: 'user-1',
  acao: 'login',
  entidade: 'usuarios',
  entidade_id: 'user-1',
  estado_anterior: null,
  estado_novo: null,
  ip: '127.0.0.1',
  user_agent: 'test-agent',
  criado_em: new Date('2024-01-01'),
}

describe('AuditoriaService', () => {
  describe('registrar()', () => {
    it('chama repo.criar com todos os campos', async () => {
      const repo = makeRepo()
      const service = criarAuditoriaService(repo)

      await service.registrar({
        tenantId: 'tenant-1',
        usuarioId: 'user-1',
        acao: 'login',
        entidade: 'usuarios',
        entidadeId: 'user-1',
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      })

      expect(repo.criar).toHaveBeenCalledOnce()
      expect(repo.criar).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        usuarioId: 'user-1',
        acao: 'login',
        entidade: 'usuarios',
        entidadeId: 'user-1',
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      })
    })

    it('chama repo.criar sem campos opcionais', async () => {
      const repo = makeRepo()
      const service = criarAuditoriaService(repo)

      await service.registrar({
        tenantId: 'tenant-1',
        acao: 'criar_orcamento',
        entidade: 'orcamentos',
      })

      expect(repo.criar).toHaveBeenCalledOnce()
      expect(repo.criar).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        acao: 'criar_orcamento',
        entidade: 'orcamentos',
      })
    })

    it('não retorna valor (void)', async () => {
      const repo = makeRepo()
      const service = criarAuditoriaService(repo)
      const result = await service.registrar({
        tenantId: 'tenant-1',
        acao: 'test',
        entidade: 'test',
      })
      expect(result).toBeUndefined()
    })
  })

  describe('listar()', () => {
    it('retorna eventos do repo', async () => {
      const repo = makeRepo({ listar: vi.fn().mockResolvedValue([baseEvento]) })
      const service = criarAuditoriaService(repo)

      const result = await service.listar({ tenantId: 'tenant-1' })

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(baseEvento)
    })

    it('filtra por entidade', async () => {
      const repo = makeRepo({ listar: vi.fn().mockResolvedValue([baseEvento]) })
      const service = criarAuditoriaService(repo)

      await service.listar({ tenantId: 'tenant-1', entidade: 'usuarios' })

      expect(repo.listar).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        entidade: 'usuarios',
      })
    })

    it('respeita isolamento de tenant', async () => {
      const repo = makeRepo({ listar: vi.fn().mockResolvedValue([]) })
      const service = criarAuditoriaService(repo)

      await service.listar({ tenantId: 'outro-tenant' })

      expect(repo.listar).toHaveBeenCalledWith({ tenantId: 'outro-tenant' })
    })
  })
})
