import { AppError } from '../errors/app-error.js'
import type {
  AtualizarResponsavelInput,
  ResponsavelPublico,
  ResponsavelRepository,
} from '../repositories/responsavel.repository.js'
import type { AuditoriaService } from './auditoria.service.js'

export interface ResponsavelContexto {
  tenantId: string
  usuarioId?: string
  ip?: string
  userAgent?: string
}

export interface CriarResponsavelDados {
  nome: string
  registroProfissional?: string
  email?: string
  telefone?: string
}

export interface ResponsavelService {
  criar(ctx: ResponsavelContexto, dados: CriarResponsavelDados): Promise<ResponsavelPublico>
  buscar(ctx: ResponsavelContexto, termo: string): Promise<ResponsavelPublico[]>
  buscarPorId(ctx: ResponsavelContexto, id: string): Promise<ResponsavelPublico>
  atualizar(
    ctx: ResponsavelContexto,
    id: string,
    dados: AtualizarResponsavelInput,
  ): Promise<ResponsavelPublico>
  desativar(ctx: ResponsavelContexto, id: string): Promise<void>
}

interface ResponsavelServiceDeps {
  responsavelRepo: ResponsavelRepository
  auditoriaService: AuditoriaService
}

export function criarResponsavelService(deps: ResponsavelServiceDeps): ResponsavelService {
  const { responsavelRepo, auditoriaService } = deps

  return {
    async criar(
      ctx: ResponsavelContexto,
      dados: CriarResponsavelDados,
    ): Promise<ResponsavelPublico> {
      const responsavel = await responsavelRepo.criar({
        tenantId: ctx.tenantId,
        nome: dados.nome,
        registroProfissional: dados.registroProfissional,
        email: dados.email,
        telefone: dados.telefone,
      })

      await auditoriaService.registrar({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'criar',
        entidade: 'responsaveis_tecnicos',
        entidadeId: responsavel.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })

      return responsavel
    },

    async buscar(ctx: ResponsavelContexto, termo: string): Promise<ResponsavelPublico[]> {
      return responsavelRepo.buscarPorNome(ctx.tenantId, termo)
    },

    async buscarPorId(ctx: ResponsavelContexto, id: string): Promise<ResponsavelPublico> {
      const responsavel = await responsavelRepo.buscarPorId(ctx.tenantId, id)
      if (!responsavel) {
        throw new AppError(404, 'Responsável não encontrado')
      }
      return responsavel
    },

    async atualizar(
      ctx: ResponsavelContexto,
      id: string,
      dados: AtualizarResponsavelInput,
    ): Promise<ResponsavelPublico> {
      // Atualiza apenas o cadastro do responsável técnico. Versões já emitidas
      // preservam o snapshot do responsável no momento da emissão e não são
      // afetadas (RF-012).
      const atualizado = await responsavelRepo.atualizar(ctx.tenantId, id, dados)
      if (!atualizado) {
        throw new AppError(404, 'Responsável não encontrado')
      }

      await auditoriaService.registrar({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'atualizar',
        entidade: 'responsaveis_tecnicos',
        entidadeId: id,
        estadoNovo: dados,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })

      return atualizado
    },

    async desativar(ctx: ResponsavelContexto, id: string): Promise<void> {
      const responsavel = await responsavelRepo.buscarPorId(ctx.tenantId, id)
      if (!responsavel) {
        throw new AppError(404, 'Responsável não encontrado')
      }

      await responsavelRepo.desativar(ctx.tenantId, id)

      await auditoriaService.registrar({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'desativar',
        entidade: 'responsaveis_tecnicos',
        entidadeId: id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })
    },
  }
}
