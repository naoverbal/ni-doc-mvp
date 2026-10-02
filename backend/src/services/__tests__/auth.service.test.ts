import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarAuthService } from '../auth.service.js'
import { AppError } from '../../errors/app-error.js'
import type { UsuarioRepository, UsuarioComSenha, UsuarioPublico } from '../../repositories/usuario.repository.js'
import type { SessaoRepository, SessaoAtiva } from '../../repositories/sessao.repository.js'
import type { AuditoriaService } from '../auditoria.service.js'
import * as senhaLib from '../../lib/senha.js'

const usuarioMock: UsuarioComSenha = {
  id: 'user-1',
  tenantId: 'tenant-1',
  nome: 'Ana Costa',
  email: 'ana@exemplo.com',
  papel: 'admin',
  ativo: true,
  criadoEm: new Date('2024-01-01'),
  senhaHash: '$argon2id$hash',
}

const usuarioPublicoMock: UsuarioPublico = {
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

function makeDeps(overrides?: {
  usuarioRepo?: Partial<UsuarioRepository>
  sessaoRepo?: Partial<SessaoRepository>
  auditoriaService?: Partial<AuditoriaService>
}) {
  const usuarioRepo: UsuarioRepository = {
    criar: vi.fn(),
    buscarPorEmail: vi.fn().mockResolvedValue(usuarioMock),
    buscarPorId: vi.fn().mockResolvedValue(usuarioPublicoMock),
    ...overrides?.usuarioRepo,
  }
  const sessaoRepo: SessaoRepository = {
    criar: vi.fn().mockResolvedValue({ id: 'sessao-id-1', expiraEm: sessaoMock.expiraEm }),
    buscarPorId: vi.fn().mockResolvedValue(sessaoMock),
    invalidar: vi.fn().mockResolvedValue(undefined),
    atualizarAtividade: vi.fn().mockResolvedValue(undefined),
    ...overrides?.sessaoRepo,
  }
  const auditoriaService: AuditoriaService = {
    registrar: vi.fn().mockResolvedValue(undefined),
    listar: vi.fn().mockResolvedValue([]),
    ...overrides?.auditoriaService,
  }
  return { usuarioRepo, sessaoRepo, auditoriaService }
}

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('login()', () => {
    it('retorna sessaoId e usuario com credenciais válidas', async () => {
      vi.spyOn(senhaLib, 'verificarSenha').mockResolvedValue(true)
      const deps = makeDeps()
      const service = criarAuthService(deps)

      const result = await service.login({
        email: 'ana@exemplo.com',
        senha: 'senha123',
      })

      expect(result.sessaoId).toBe('sessao-id-1')
      expect(result.usuario.id).toBe('user-1')
      expect(result.usuario.tenantId).toBe('tenant-1')
      expect(deps.sessaoRepo.criar).toHaveBeenCalledOnce()
    })

    it('registra evento de auditoria no login', async () => {
      vi.spyOn(senhaLib, 'verificarSenha').mockResolvedValue(true)
      const deps = makeDeps()
      const service = criarAuthService(deps)

      await service.login({ email: 'ana@exemplo.com', senha: 'senha123' })

      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'login', entidade: 'usuarios' }),
      )
    })

    it('lança AppError(401) se email não encontrado', async () => {
      const deps = makeDeps({
        usuarioRepo: { buscarPorEmail: vi.fn().mockResolvedValue(null) },
      })
      const service = criarAuthService(deps)

      await expect(
        service.login({ email: 'naoexiste@exemplo.com', senha: 'senha123' }),
      ).rejects.toThrow(AppError)

      await expect(
        service.login({ email: 'naoexiste@exemplo.com', senha: 'senha123' }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })

    it('lança AppError(403) se usuário inativo', async () => {
      const deps = makeDeps({
        usuarioRepo: {
          buscarPorEmail: vi.fn().mockResolvedValue({ ...usuarioMock, ativo: false }),
        },
      })
      const service = criarAuthService(deps)

      await expect(
        service.login({ email: 'ana@exemplo.com', senha: 'senha123' }),
      ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('lança AppError(401) se senha errada', async () => {
      vi.spyOn(senhaLib, 'verificarSenha').mockResolvedValue(false)
      const deps = makeDeps()
      const service = criarAuthService(deps)

      await expect(
        service.login({ email: 'ana@exemplo.com', senha: 'senhaerrada' }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('logout()', () => {
    it('chama sessaoRepo.invalidar com o sessaoId correto', async () => {
      const deps = makeDeps()
      const service = criarAuthService(deps)

      await service.logout('sessao-id-1')

      expect(deps.sessaoRepo.invalidar).toHaveBeenCalledWith('sessao-id-1')
    })

    it('registra evento de auditoria no logout', async () => {
      const deps = makeDeps()
      const service = criarAuthService(deps)

      await service.logout('sessao-id-1')

      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'logout' }),
      )
    })
  })

  describe('validarSessao()', () => {
    it('retorna usuario e sessao para sessão válida', async () => {
      const deps = makeDeps()
      const service = criarAuthService(deps)

      const result = await service.validarSessao('sessao-id-1')

      expect(result).not.toBeNull()
      expect(result?.usuario.id).toBe('user-1')
      expect(result?.sessao.id).toBe('sessao-id-1')
    })

    it('retorna null para sessão expirada', async () => {
      const sessaoExpirada: SessaoAtiva = {
        ...sessaoMock,
        expiraEm: new Date(Date.now() - 1000), // passado
      }
      const deps = makeDeps({
        sessaoRepo: { buscarPorId: vi.fn().mockResolvedValue(sessaoExpirada) },
      })
      const service = criarAuthService(deps)

      const result = await service.validarSessao('sessao-id-1')

      expect(result).toBeNull()
    })

    it('retorna null se sessão não existe', async () => {
      const deps = makeDeps({
        sessaoRepo: { buscarPorId: vi.fn().mockResolvedValue(null) },
      })
      const service = criarAuthService(deps)

      const result = await service.validarSessao('sessao-inexistente')

      expect(result).toBeNull()
    })

    it('chama atualizarAtividade para sessão válida', async () => {
      const deps = makeDeps()
      const service = criarAuthService(deps)

      await service.validarSessao('sessao-id-1')

      expect(deps.sessaoRepo.atualizarAtividade).toHaveBeenCalledWith('sessao-id-1')
    })
  })
})
