import { AppError } from '../errors/app-error.js'
import { montarEmailOrcamentoCancelado } from '../lib/email-templates.js'
import type { Email } from '../lib/email.js'
import type {
  OrcamentoComItens,
  OrcamentoRepository,
} from '../repositories/orcamento.repository.js'
import type { UsuarioRepository } from '../repositories/usuario.repository.js'
import type { AuditoriaService } from './auditoria.service.js'
import type { ConfirmacaoSenha } from './confirmacao-senha.js'
import type { OrcamentoContexto } from './orcamento.service.js'

// -----------------------------------------------------------------------------
// Cancelamento de orçamento (RF-009): `enviado | aprovado → cancelado`.
//
// Exige a CONFIRMAÇÃO DA SENHA do usuário logado (helper compartilhado
// `confirmacao-senha`, sem criar sessão) e uma justificativa. Senha errada → 403 (nunca 401, para não
// ser confundido com sessão expirada) e a tentativa é auditada. A senha jamais é
// logada, auditada nem enviada por e-mail.
//
// A transição de estado é atômica no repositório (lock de linha + releitura do
// status): cancelamentos concorrentes → um vence, o outro recebe 409. Cancelar um
// `aprovado` só muda o status; aceite e comprovante são preservados.
// -----------------------------------------------------------------------------

export interface CancelarOrcamentoDados {
  senha: string
  justificativa: string
}

export interface CancelamentoService {
  cancelar(
    ctx: OrcamentoContexto,
    id: string,
    dados: CancelarOrcamentoDados,
  ): Promise<OrcamentoComItens>
}

interface CancelamentoServiceDeps {
  orcamentoRepo: OrcamentoRepository
  usuarioRepo: UsuarioRepository
  auditoriaService: AuditoriaService
  confirmacaoSenha: ConfirmacaoSenha
  // OPCIONAL: ausente quando o SMTP não está configurado (nada é enviado).
  email?: Email
}

export function criarCancelamentoService(deps: CancelamentoServiceDeps): CancelamentoService {
  const { orcamentoRepo, usuarioRepo, auditoriaService, confirmacaoSenha, email } = deps

  // Notifica (melhor esforço) o operador responsável pelo orçamento. Não envia se
  // ele mesmo cancelou. `email.enviar` nunca lança.
  async function notificar(
    ctx: OrcamentoContexto,
    orcamento: OrcamentoComItens,
    justificativa: string,
  ): Promise<void> {
    if (!email || orcamento.usuarioId === ctx.usuarioId) {
      return
    }
    try {
      const [responsavel, cancelador] = await Promise.all([
        usuarioRepo.buscarPorId(orcamento.usuarioId),
        usuarioRepo.buscarPorId(ctx.usuarioId),
      ])
      if (!responsavel || responsavel.email.length === 0) {
        return
      }
      await email.enviar(
        montarEmailOrcamentoCancelado({
          destinatario: responsavel.email,
          nomeOperador: responsavel.nome,
          numero: orcamento.numero,
          nomeCancelador: cancelador?.nome ?? 'Um usuário',
          justificativa,
        }),
      )
    } catch {
      // A notificação não pode desfazer um cancelamento já persistido.
    }
  }

  return {
    async cancelar(ctx, id, dados) {
      const justificativa = dados.justificativa.trim()
      if (justificativa.length === 0) {
        throw new AppError(400, 'Justificativa é obrigatória para cancelar o orçamento')
      }

      // Outro tenant (RLS) ou inexistente → 404, antes de qualquer verificação.
      const existente = await orcamentoRepo.buscarPorId(ctx.tenantId, id)
      if (!existente) {
        throw new AppError(404, 'Orçamento não encontrado')
      }

      await confirmacaoSenha.exigir(ctx, id, dados.senha, 'cancelar_senha_invalida')

      const { statusAnterior } = await orcamentoRepo.cancelar(ctx.tenantId, id)

      await auditoriaService.registrar({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'cancelar',
        entidade: 'orcamentos',
        entidadeId: id,
        estadoAnterior: { status: statusAnterior },
        estadoNovo: { status: 'cancelado', justificativa },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })

      await notificar(ctx, existente, justificativa)

      return (
        (await orcamentoRepo.buscarPorId(ctx.tenantId, id)) ?? { ...existente, status: 'cancelado' }
      )
    },
  }
}
