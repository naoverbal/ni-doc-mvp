import { AppError } from '../errors/app-error.js'
import type {
  AtualizarResponsavelInput,
  ResponsavelPublico,
  ResponsavelRepository,
} from '../repositories/responsavel.repository.js'

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
}

export function criarResponsavelService(deps: ResponsavelServiceDeps): ResponsavelService {
  const { responsavelRepo } = deps

  return {
    async criar(
      ctx: ResponsavelContexto,
      dados: CriarResponsavelDados,
    ): Promise<ResponsavelPublico> {
      // Auditoria gravada pelo repositório na MESMA transação do cadastro.
      return responsavelRepo.criar(
        {
          tenantId: ctx.tenantId,
          nome: dados.nome,
          registroProfissional: dados.registroProfissional,
          email: dados.email,
          telefone: dados.telefone,
        },
        (responsavel) => ({
          tenantId: ctx.tenantId,
          usuarioId: ctx.usuarioId,
          acao: 'criar',
          entidade: 'responsaveis_tecnicos',
          entidadeId: responsavel.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        }),
      )
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
      // Auditoria gravada pelo repositório na MESMA transação da atualização.
      const atualizado = await responsavelRepo.atualizar(ctx.tenantId, id, dados, () => ({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'atualizar',
        entidade: 'responsaveis_tecnicos',
        entidadeId: id,
        estadoNovo: dados,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }))
      if (!atualizado) {
        throw new AppError(404, 'Responsável não encontrado')
      }

      return atualizado
    },

    async desativar(ctx: ResponsavelContexto, id: string): Promise<void> {
      const responsavel = await responsavelRepo.buscarPorId(ctx.tenantId, id)
      if (!responsavel) {
        throw new AppError(404, 'Responsável não encontrado')
      }

      // Auditoria gravada pelo repositório na MESMA transação da desativação.
      await responsavelRepo.desativar(ctx.tenantId, id, () => ({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'desativar',
        entidade: 'responsaveis_tecnicos',
        entidadeId: id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }))
    },
  }
}
