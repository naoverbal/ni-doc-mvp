import { AppError } from '../errors/app-error.js'
import type {
  AtualizarOrcamentoInput,
  CriarOrcamentoItemInput,
  DescontoTipo,
  ListaOrcamentos,
  ListarOrcamentosFiltro,
  OrcamentoComItens,
  OrcamentoRepository,
} from '../repositories/orcamento.repository.js'
import type { AuditoriaService } from './auditoria.service.js'

export interface OrcamentoContexto {
  tenantId: string
  usuarioId: string
  ip?: string
  userAgent?: string
}

// Espelha CriarOrcamentoInput sem tenantId/usuarioId — ambos vêm do contexto.
export interface CriarOrcamentoDados {
  clienteId: string
  empresaClienteId?: string
  titulo: string
  descricao?: string
  validadeDias?: number
  descontoGlobalTipo?: DescontoTipo
  descontoGlobalValor?: number
  observacoes?: string
  condicoesPagamento?: string
  itens: CriarOrcamentoItemInput[]
}

export interface OrcamentoService {
  criar(ctx: OrcamentoContexto, dados: CriarOrcamentoDados): Promise<OrcamentoComItens>
  buscarPorId(ctx: OrcamentoContexto, id: string): Promise<OrcamentoComItens>
  listar(ctx: OrcamentoContexto, filtro?: ListarOrcamentosFiltro): Promise<ListaOrcamentos>
  atualizar(
    ctx: OrcamentoContexto,
    id: string,
    dados: AtualizarOrcamentoInput,
  ): Promise<OrcamentoComItens>
  deletar(ctx: OrcamentoContexto, id: string): Promise<void>
}

interface OrcamentoServiceDeps {
  orcamentoRepo: OrcamentoRepository
  auditoriaService: AuditoriaService
}

export function criarOrcamentoService(deps: OrcamentoServiceDeps): OrcamentoService {
  const { orcamentoRepo, auditoriaService } = deps

  return {
    async criar(ctx: OrcamentoContexto, dados: CriarOrcamentoDados): Promise<OrcamentoComItens> {
      // Regras mínimas de negócio (RF-005.4). A validação de formato detalhada
      // (Zod) é responsabilidade das rotas (tarefa 30).
      if (!dados.clienteId) {
        throw new AppError(400, 'Cliente é obrigatório')
      }
      if (!dados.titulo || dados.titulo.trim().length === 0) {
        throw new AppError(400, 'Título é obrigatório')
      }
      if (dados.itens.length === 0) {
        throw new AppError(400, 'Orçamento deve ter ao menos um item')
      }

      // O repositório é o dono do cálculo de totais (via orcamento-calculo).
      const orcamento = await orcamentoRepo.criar({
        tenantId: ctx.tenantId,
        clienteId: dados.clienteId,
        empresaClienteId: dados.empresaClienteId,
        usuarioId: ctx.usuarioId,
        titulo: dados.titulo,
        descricao: dados.descricao,
        validadeDias: dados.validadeDias,
        descontoGlobalTipo: dados.descontoGlobalTipo,
        descontoGlobalValor: dados.descontoGlobalValor,
        observacoes: dados.observacoes,
        condicoesPagamento: dados.condicoesPagamento,
        itens: dados.itens,
      })

      await auditoriaService.registrar({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'criar',
        entidade: 'orcamentos',
        entidadeId: orcamento.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })

      return orcamento
    },

    async buscarPorId(ctx: OrcamentoContexto, id: string): Promise<OrcamentoComItens> {
      const orcamento = await orcamentoRepo.buscarPorId(ctx.tenantId, id)
      if (!orcamento) {
        throw new AppError(404, 'Orçamento não encontrado')
      }
      return orcamento
    },

    async listar(
      ctx: OrcamentoContexto,
      filtro?: ListarOrcamentosFiltro,
    ): Promise<ListaOrcamentos> {
      return orcamentoRepo.listarPorTenant(ctx.tenantId, filtro)
    },

    async atualizar(
      ctx: OrcamentoContexto,
      id: string,
      dados: AtualizarOrcamentoInput,
    ): Promise<OrcamentoComItens> {
      const existente = await orcamentoRepo.buscarPorId(ctx.tenantId, id)
      if (!existente) {
        throw new AppError(404, 'Orçamento não encontrado')
      }
      // Edição irrestrita só em rascunho (RF-005.5).
      if (existente.status !== 'rascunho') {
        throw new AppError(409, 'Só é possível editar orçamentos em rascunho')
      }

      const atualizado = await orcamentoRepo.atualizar(ctx.tenantId, id, dados)
      if (!atualizado) {
        throw new AppError(404, 'Orçamento não encontrado')
      }

      await auditoriaService.registrar({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'atualizar',
        entidade: 'orcamentos',
        entidadeId: id,
        estadoNovo: dados,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })

      return atualizado
    },

    async deletar(ctx: OrcamentoContexto, id: string): Promise<void> {
      const existente = await orcamentoRepo.buscarPorId(ctx.tenantId, id)
      if (!existente) {
        throw new AppError(404, 'Orçamento não encontrado')
      }
      // Só rascunho pode ser excluído (RF-005.5).
      if (existente.status !== 'rascunho') {
        throw new AppError(409, 'Só é possível excluir orçamentos em rascunho')
      }

      await orcamentoRepo.deletar(ctx.tenantId, id)

      await auditoriaService.registrar({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'deletar',
        entidade: 'orcamentos',
        entidadeId: id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })
    },
  }
}
