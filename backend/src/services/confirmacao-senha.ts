import { AppError } from '../errors/app-error.js'
import { verificarSenha } from '../lib/senha.js'
import type { UsuarioRepository } from '../repositories/usuario.repository.js'
import type { AuditoriaService } from './auditoria.service.js'
import type { OrcamentoContexto } from './orcamento.service.js'

// -----------------------------------------------------------------------------
// Confirmação de senha para ações sensíveis sobre orçamentos (cancelar, reabrir).
//
// Reconfirma a SENHA do usuário logado com `verificarSenha`, sem criar sessão.
// Senha errada → 403 (nunca 401, para não ser confundido com sessão expirada) e a
// tentativa é auditada com a ação informada. A senha jamais é logada nem
// auditada.
// -----------------------------------------------------------------------------

export interface ConfirmacaoSenha {
  /**
   * Lança AppError(403) se a senha não confere com a do usuário do contexto,
   * registrando a tentativa em auditoria (`acaoTentativaInvalida`).
   */
  exigir(
    ctx: OrcamentoContexto,
    entidadeId: string,
    senha: string,
    acaoTentativaInvalida: string,
  ): Promise<void>
}

export function criarConfirmacaoSenha(deps: {
  usuarioRepo: UsuarioRepository
  auditoriaService: AuditoriaService
}): ConfirmacaoSenha {
  const { usuarioRepo, auditoriaService } = deps

  return {
    async exigir(ctx, entidadeId, senha, acaoTentativaInvalida) {
      const senhaHash = await usuarioRepo.buscarSenhaHashPorId(ctx.tenantId, ctx.usuarioId)
      const senhaValida = senhaHash !== null && (await verificarSenha(senha, senhaHash))
      if (senhaValida) {
        return
      }

      await auditoriaService.registrar({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: acaoTentativaInvalida,
        entidade: 'orcamentos',
        entidadeId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })
      throw new AppError(403, 'Senha incorreta')
    },
  }
}
