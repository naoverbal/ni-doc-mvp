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
  // Exclui um rascunho. Se nunca foi enviado, remove de verdade e devolve `null`
  // (rota responde 204). Se é um rascunho REABERTO, o histórico é preservado: o
  // orçamento volta ao último status com o conteúdo da última versão enviada e é
  // devolvido restaurado (rota responde 200).
  deletar(ctx: OrcamentoContexto, id: string): Promise<OrcamentoComItens | null>
}

interface OrcamentoServiceDeps {
  orcamentoRepo: OrcamentoRepository
  clienteRepo: ClienteRepository
  empresaRepo: EmpresaRepository
  responsavelRepo: ResponsavelRepository
}

export function criarOrcamentoService(deps: OrcamentoServiceDeps): OrcamentoService {
  const { orcamentoRepo, clienteRepo, empresaRepo, responsavelRepo } = deps

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
    if (responsaveis.size > 0) {
      // Uma consulta `IN (...)` em vez de uma por responsável.
      const encontrados = await responsavelRepo.buscarPorIds(tenantId, [...responsaveis])
      const idsEncontrados = new Set(encontrados.map((r) => r.id))
      for (const responsavelId of responsaveis) {
        if (!idsEncontrados.has(responsavelId)) {
          throw new AppError(409, 'Responsável técnico não encontrado')
        }
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
      // A auditoria é gravada pelo repositório na MESMA transação do orçamento,
      // dos itens e das condições: se ela falhar, nada é criado.
      return orcamentoRepo.criar(
        {
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
        },
        (orcamento) => ({
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
        }),
      )
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

      // Auditoria gravada pelo repositório na mesma transação da edição.
      const atualizado = await orcamentoRepo.atualizar(ctx.tenantId, id, dados, (novo) => ({
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
          titulo: novo.titulo,
          prazoEntregaDias: novo.prazoEntregaDias,
          condicoesPagamento: novo.condicoesPagamento,
          total: novo.total,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }))
      if (!atualizado) {
        throw new AppError(404, 'Orçamento não encontrado')
      }

      return atualizado
    },

    async deletar(ctx: OrcamentoContexto, id: string): Promise<OrcamentoComItens | null> {
      const existente = await orcamentoRepo.buscarPorId(ctx.tenantId, id)
      if (!existente) {
        throw new AppError(404, 'Orçamento não encontrado')
      }
      // Só rascunho pode ser excluído (RF-005.5).
      if (existente.status !== 'rascunho') {
        throw new AppError(409, 'Só é possível excluir orçamentos em rascunho')
      }

      // Auditoria gravada pelo repositório na mesma transação da exclusão/restauração.
      const resultado = await orcamentoRepo.deletar(ctx.tenantId, id, (r) =>
        r.resultado === 'removido'
          ? {
              tenantId: ctx.tenantId,
              usuarioId: ctx.usuarioId,
              acao: 'deletar',
              entidade: 'orcamentos',
              entidadeId: id,
              ip: ctx.ip,
              userAgent: ctx.userAgent,
            }
          : {
              // Rascunho reaberto: nada foi apagado; o orçamento voltou ao status de origem.
              tenantId: ctx.tenantId,
              usuarioId: ctx.usuarioId,
              acao: 'descartar_reabertura',
              entidade: 'orcamentos',
              entidadeId: id,
              estadoAnterior: { status: 'rascunho' },
              estadoNovo: { status: r.statusRestaurado, restauradoDaUltimaVersao: true },
              ip: ctx.ip,
              userAgent: ctx.userAgent,
            },
      )

      if (resultado.resultado === 'removido') {
        return null
      }

      const restaurado = await orcamentoRepo.buscarPorId(ctx.tenantId, id)
      if (!restaurado) {
        throw new AppError(404, 'Orçamento não encontrado')
      }
      return restaurado
    },
  }
}
