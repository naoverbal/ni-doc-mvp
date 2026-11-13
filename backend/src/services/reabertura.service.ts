import { AppError } from '../errors/app-error.js'
import type {
  OrcamentoComItens,
  OrcamentoRepository,
} from '../repositories/orcamento.repository.js'
import type { ConfirmacaoSenha } from './confirmacao-senha.js'
import type { OrcamentoContexto } from './orcamento.service.js'

// -----------------------------------------------------------------------------
// Reabertura de orçamento (RF-008, RF-009): `reprovado | cancelado | expirado →
// rascunho`.
//
// Mesmo mecanismo do cancelamento: confirmação da senha do usuário logado (helper
// compartilhado; senha errada → 403 auditado) e justificativa obrigatória. A
// reabertura NÃO cria versão: a versão N+1 nasce no próximo `/enviar`, pelo fluxo
// normal. As versões e aceites anteriores ficam intactos.
//
// A transição é atômica no repositório (lock de linha + releitura do status):
// reaberturas concorrentes → uma vence, a outra recebe 409. O repositório também
// renova a data de emissão (mantendo `validade_dias`) e guarda o status de origem,
// usado se o rascunho reaberto for excluído.
// -----------------------------------------------------------------------------

export interface ReabrirOrcamentoDados {
  senha: string
  justificativa: string
}

export interface ReaberturaService {
  reabrir(
    ctx: OrcamentoContexto,
    id: string,
    dados: ReabrirOrcamentoDados,
  ): Promise<OrcamentoComItens>
}

interface ReaberturaServiceDeps {
  orcamentoRepo: OrcamentoRepository
  confirmacaoSenha: ConfirmacaoSenha
}

export function criarReaberturaService(deps: ReaberturaServiceDeps): ReaberturaService {
  const { orcamentoRepo, confirmacaoSenha } = deps

  return {
    async reabrir(ctx, id, dados) {
      const justificativa = dados.justificativa.trim()
      if (justificativa.length === 0) {
        throw new AppError(400, 'Justificativa é obrigatória para reabrir o orçamento')
      }

      // Outro tenant (RLS) ou inexistente → 404, antes de qualquer verificação.
      const existente = await orcamentoRepo.buscarPorId(ctx.tenantId, id)
      if (!existente) {
        throw new AppError(404, 'Orçamento não encontrado')
      }

      await confirmacaoSenha.exigir(ctx, id, dados.senha, 'reabrir_senha_invalida')

      // Auditoria gravada pelo repositório na mesma transação da reabertura.
      await orcamentoRepo.reabrir(ctx.tenantId, id, ({ statusAnterior }) => ({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'reabrir',
        entidade: 'orcamentos',
        entidadeId: id,
        estadoAnterior: { status: statusAnterior },
        estadoNovo: { status: 'rascunho', justificativa },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }))

      return (
        (await orcamentoRepo.buscarPorId(ctx.tenantId, id)) ?? { ...existente, status: 'rascunho' }
      )
    },
  }
}
