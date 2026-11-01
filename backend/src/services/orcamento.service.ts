import { AppError } from '../errors/app-error.js'
import type {
  AtualizarOrcamentoInput,
  CriarOrcamentoCondicaoPagamentoInput,
  CriarOrcamentoItemInput,
  DescontoTipo,
  ListaOrcamentos,
  ListarOrcamentosFiltro,
  OrcamentoComItens,
  OrcamentoRepository,
} from '../repositories/orcamento.repository.js'
import type { ClienteRepository } from '../repositories/cliente.repository.js'
import type { EmpresaRepository } from '../repositories/empresa.repository.js'
import type { ResponsavelRepository } from '../repositories/responsavel.repository.js'
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
  prazoEntregaDias?: number
  descontoGlobalTipo?: DescontoTipo
  descontoGlobalValor?: number
  observacoes?: string
  condicoesPagamentoTexto?: string
  condicoesPagamento?: CriarOrcamentoCondicaoPagamentoInput[]
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
  clienteRepo: ClienteRepository
  empresaRepo: EmpresaRepository
  responsavelRepo: ResponsavelRepository
  auditoriaService: AuditoriaService
}

export function criarOrcamentoService(deps: OrcamentoServiceDeps): OrcamentoService {
  const { orcamentoRepo, clienteRepo, empresaRepo, responsavelRepo, auditoriaService } = deps

  // As FKs do Postgres ignoram o RLS: um id de outro tenant satisfaz a FK. Por
  // isso cada referência é lida pelos repositórios (filtrados por tenant e sob
  // RLS) e, se não existir no tenant do usuário, a operação é recusada (409).
  async function validarReferencias(
    tenantId: string,
    refs: {
      clienteId?: string
      empresaClienteId?: string
      itens?: { responsavelId?: string }[]
    },
  ): Promise<void> {
    if (refs.clienteId !== undefined) {
      if (!(await clienteRepo.buscarPorId(tenantId, refs.clienteId))) {
        throw new AppError(409, 'Cliente não encontrado')
      }
    }
    if (refs.empresaClienteId !== undefined) {
      if (!(await empresaRepo.buscarPorId(tenantId, refs.empresaClienteId))) {
        throw new AppError(409, 'Empresa do cliente não encontrada')
      }
    }
    const responsaveis = new Set<string>()
    for (const item of refs.itens ?? []) {
      if (item.responsavelId !== undefined) responsaveis.add(item.responsavelId)
    }
    for (const responsavelId of responsaveis) {
      if (!(await responsavelRepo.buscarPorId(tenantId, responsavelId))) {
        throw new AppError(409, 'Responsável técnico não encontrado')
      }
    }
  }

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

      await validarReferencias(ctx.tenantId, dados)

      // O repositório é o dono do cálculo de totais (via orcamento-calculo).
      const orcamento = await orcamentoRepo.criar({
        tenantId: ctx.tenantId,
        clienteId: dados.clienteId,
        empresaClienteId: dados.empresaClienteId,
        usuarioId: ctx.usuarioId,
        titulo: dados.titulo,
        descricao: dados.descricao,
        validadeDias: dados.validadeDias,
        prazoEntregaDias: dados.prazoEntregaDias,
        descontoGlobalTipo: dados.descontoGlobalTipo,
        descontoGlobalValor: dados.descontoGlobalValor,
        observacoes: dados.observacoes,
        condicoesPagamentoTexto: dados.condicoesPagamentoTexto,
        condicoesPagamento: dados.condicoesPagamento,
        itens: dados.itens,
      })

      await auditoriaService.registrar({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'criar',
        entidade: 'orcamentos',
        entidadeId: orcamento.id,
        estadoNovo: {
          titulo: orcamento.titulo,
          prazoEntregaDias: orcamento.prazoEntregaDias,
          condicoesPagamento: orcamento.condicoesPagamento,
          total: orcamento.total,
        },
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

      await validarReferencias(ctx.tenantId, dados)

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
        // Estado anterior/novo cobrindo os campos relevantes (incl. os novos:
        // prazo de entrega e condições de pagamento estruturadas).
        estadoAnterior: {
          titulo: existente.titulo,
          prazoEntregaDias: existente.prazoEntregaDias,
          condicoesPagamento: existente.condicoesPagamento,
          total: existente.total,
        },
        estadoNovo: {
          titulo: atualizado.titulo,
          prazoEntregaDias: atualizado.prazoEntregaDias,
          condicoesPagamento: atualizado.condicoesPagamento,
          total: atualizado.total,
        },
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
