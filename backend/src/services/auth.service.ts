import { verificarSenha } from '../lib/senha.js'
import { AppError } from '../errors/app-error.js'
import type { UsuarioPublico, UsuarioRepository } from '../repositories/usuario.repository.js'
import type { SessaoAtiva, SessaoRepository } from '../repositories/sessao.repository.js'
import type { AuditoriaService } from './auditoria.service.js'

export interface LoginInput {
  email: string
  senha: string
  ip?: string
  userAgent?: string
}

export interface LoginResult {
  sessaoId: string
  expiraEm: Date
  usuario: {
    id: string
    nome: string
    email: string
    papel: 'admin' | 'operador'
    tenantId: string
  }
}

export interface AuthService {
  login(input: LoginInput): Promise<LoginResult>
  logout(sessaoId: string): Promise<void>
  validarSessao(sessaoId: string): Promise<{ usuario: UsuarioPublico; sessao: SessaoAtiva } | null>
}

interface AuthServiceDeps {
  usuarioRepo: UsuarioRepository
  sessaoRepo: SessaoRepository
  auditoriaService: AuditoriaService
}

const OITO_HORAS_MS = 8 * 60 * 60 * 1000

export function criarAuthService(deps: AuthServiceDeps): AuthService {
  const { usuarioRepo, sessaoRepo, auditoriaService } = deps

  return {
    async login(input: LoginInput): Promise<LoginResult> {
      const usuario = await usuarioRepo.buscarPorEmail(input.email)

      if (!usuario) {
        throw new AppError(401, 'Credenciais inválidas')
      }

      if (!usuario.ativo) {
        throw new AppError(403, 'Usuário inativo')
      }

      const senhaValida = await verificarSenha(input.senha, usuario.senhaHash)
      if (!senhaValida) {
        throw new AppError(401, 'Credenciais inválidas')
      }

      const expiraEm = new Date(Date.now() + OITO_HORAS_MS)
      const sessao = await sessaoRepo.criar({
        usuarioId: usuario.id,
        ip: input.ip,
        userAgent: input.userAgent,
        expiraEm,
      })

      await auditoriaService.registrar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.id,
        acao: 'login',
        entidade: 'usuarios',
        entidadeId: usuario.id,
        ip: input.ip,
        userAgent: input.userAgent,
      })

      return {
        sessaoId: sessao.id,
        expiraEm: sessao.expiraEm,
        usuario: {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          papel: usuario.papel,
          tenantId: usuario.tenantId,
        },
      }
    },

    async logout(sessaoId: string): Promise<void> {
      // Buscar sessão para obter tenantId/usuarioId para auditoria
      const sessao = await sessaoRepo.buscarPorId(sessaoId)
      await sessaoRepo.invalidar(sessaoId)

      if (sessao) {
        const usuario = await usuarioRepo.buscarPorId(sessao.usuarioId)
        if (usuario) {
          await auditoriaService.registrar({
            tenantId: usuario.tenantId,
            usuarioId: usuario.id,
            acao: 'logout',
            entidade: 'usuarios',
            entidadeId: usuario.id,
          })
        }
      }
    },

    async validarSessao(
      sessaoId: string,
    ): Promise<{ usuario: UsuarioPublico; sessao: SessaoAtiva } | null> {
      const sessao = await sessaoRepo.buscarPorId(sessaoId)
      if (!sessao) return null

      if (sessao.expiraEm < new Date()) {
        return null
      }

      const usuario = await usuarioRepo.buscarPorId(sessao.usuarioId)
      if (!usuario) return null

      await sessaoRepo.atualizarAtividade(sessaoId)

      return { usuario, sessao }
    },
  }
}
