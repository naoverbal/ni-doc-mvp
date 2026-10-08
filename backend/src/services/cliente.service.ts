import { AppError } from '../errors/app-error.js'
import { hashDocumento } from '../lib/crypto.js'
import { validarCPF, validarCNPJ } from '../lib/documento.js'
import type {
  AtualizarClienteInput,
  ClientePublico,
  ClienteRepository,
} from '../repositories/cliente.repository.js'
import type { AuditoriaService } from './auditoria.service.js'

export interface ClienteContexto {
  tenantId: string
  usuarioId?: string
  ip?: string
  userAgent?: string
}

export interface CriarClienteDados {
  tipoPessoa: 'PF' | 'PJ'
  nome: string
  documento: string
  email?: string
  telefone?: string
  endereco?: string
  observacoes?: string
}

export interface ClienteService {
  criar(ctx: ClienteContexto, dados: CriarClienteDados): Promise<ClientePublico>
  buscar(ctx: ClienteContexto, termo: string): Promise<ClientePublico[]>
  buscarPorId(ctx: ClienteContexto, id: string): Promise<ClientePublico>
  atualizar(
    ctx: ClienteContexto,
    id: string,
    dados: AtualizarClienteInput,
  ): Promise<ClientePublico>
  desativar(ctx: ClienteContexto, id: string): Promise<void>
}

interface ClienteServiceDeps {
  clienteRepo: ClienteRepository
  auditoriaService: AuditoriaService
}

function validarDocumento(tipoPessoa: 'PF' | 'PJ', documento: string): void {
  const valido = tipoPessoa === 'PF' ? validarCPF(documento) : validarCNPJ(documento)
  if (!valido) {
    const rotulo = tipoPessoa === 'PF' ? 'CPF' : 'CNPJ'
    throw new AppError(400, `${rotulo} inválido`)
  }
}

export function criarClienteService(deps: ClienteServiceDeps): ClienteService {
  const { clienteRepo, auditoriaService } = deps

  return {
    async criar(ctx: ClienteContexto, dados: CriarClienteDados): Promise<ClientePublico> {
      validarDocumento(dados.tipoPessoa, dados.documento)

      const documentoHash = hashDocumento(dados.documento)
      const existente = await clienteRepo.buscarPorDocumentoHash(ctx.tenantId, documentoHash)
      if (existente) {
        throw new AppError(409, 'Já existe um cliente com este documento neste tenant')
      }

      const cliente = await clienteRepo.criar({
        tenantId: ctx.tenantId,
        tipoPessoa: dados.tipoPessoa,
        nome: dados.nome,
        documento: dados.documento,
        email: dados.email,
        telefone: dados.telefone,
        endereco: dados.endereco,
        observacoes: dados.observacoes,
      })

      await auditoriaService.registrar({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'criar',
        entidade: 'clientes',
        entidadeId: cliente.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })

      return cliente
    },

    async buscar(ctx: ClienteContexto, termo: string): Promise<ClientePublico[]> {
      return clienteRepo.buscarPorNome(ctx.tenantId, termo)
    },

    async buscarPorId(ctx: ClienteContexto, id: string): Promise<ClientePublico> {
      const cliente = await clienteRepo.buscarPorId(ctx.tenantId, id)
      if (!cliente) {
        throw new AppError(404, 'Cliente não encontrado')
      }
      return cliente
    },

    async atualizar(
      ctx: ClienteContexto,
      id: string,
      dados: AtualizarClienteInput,
    ): Promise<ClientePublico> {
      // Atualiza apenas o cadastro do cliente. Versões já emitidas preservam o
      // snapshot do cliente no momento da emissão e não são afetadas (RF-010.4).
      const atualizado = await clienteRepo.atualizar(ctx.tenantId, id, dados)
      if (!atualizado) {
        throw new AppError(404, 'Cliente não encontrado')
      }

      await auditoriaService.registrar({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'atualizar',
        entidade: 'clientes',
        entidadeId: id,
        estadoNovo: dados,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })

      return atualizado
    },

    async desativar(ctx: ClienteContexto, id: string): Promise<void> {
      const cliente = await clienteRepo.buscarPorId(ctx.tenantId, id)
      if (!cliente) {
        throw new AppError(404, 'Cliente não encontrado')
      }

      await clienteRepo.desativar(ctx.tenantId, id)

      await auditoriaService.registrar({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'desativar',
        entidade: 'clientes',
        entidadeId: id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })
    },
  }
}
