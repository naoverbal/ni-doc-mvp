import { AppError } from '../errors/app-error.js'
import { hashDocumento } from '../lib/crypto.js'
import { validarCNPJ } from '../lib/documento.js'
import type {
  AtualizarEmpresaInput,
  EmpresaPublica,
  EmpresaRepository,
} from '../repositories/empresa.repository.js'

export interface EmpresaContexto {
  tenantId: string
  usuarioId?: string
  ip?: string
  userAgent?: string
}

export interface CriarEmpresaDados {
  tipo: 'tenant' | 'cliente_pj'
  razaoSocial: string
  nomeFantasia?: string
  cnpj?: string
  email?: string
  telefone?: string
  endereco?: string
}

export interface EmpresaService {
  criar(ctx: EmpresaContexto, dados: CriarEmpresaDados): Promise<EmpresaPublica>
  buscar(
    ctx: EmpresaContexto,
    termo: string,
    tipo: 'tenant' | 'cliente_pj',
  ): Promise<EmpresaPublica[]>
  buscarPorId(ctx: EmpresaContexto, id: string): Promise<EmpresaPublica>
  atualizar(ctx: EmpresaContexto, id: string, dados: AtualizarEmpresaInput): Promise<EmpresaPublica>
  desativar(ctx: EmpresaContexto, id: string): Promise<void>
}

interface EmpresaServiceDeps {
  empresaRepo: EmpresaRepository
}

export function criarEmpresaService(deps: EmpresaServiceDeps): EmpresaService {
  const { empresaRepo } = deps

  return {
    async criar(ctx: EmpresaContexto, dados: CriarEmpresaDados): Promise<EmpresaPublica> {
      // CNPJ é opcional em empresas. Quando informado, valida, impede duplicidade
      // por tenant e armazena hash + valor cifrado; quando ausente, segue sem checagem.
      if (dados.cnpj !== undefined) {
        if (!validarCNPJ(dados.cnpj)) {
          throw new AppError(400, 'CNPJ inválido')
        }

        const existente = await empresaRepo.buscarPorCnpjHash(
          ctx.tenantId,
          hashDocumento(dados.cnpj),
        )
        if (existente) {
          throw new AppError(409, 'Já existe uma empresa com este CNPJ neste tenant')
        }
      }

      // Auditoria gravada pelo repositório na MESMA transação do cadastro.
      return empresaRepo.criar(
        {
          tenantId: ctx.tenantId,
          tipo: dados.tipo,
          razaoSocial: dados.razaoSocial,
          nomeFantasia: dados.nomeFantasia,
          cnpj: dados.cnpj,
          email: dados.email,
          telefone: dados.telefone,
          endereco: dados.endereco,
        },
        (empresa) => ({
          tenantId: ctx.tenantId,
          usuarioId: ctx.usuarioId,
          acao: 'criar',
          entidade: 'empresas',
          entidadeId: empresa.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        }),
      )
    },

    async buscar(
      ctx: EmpresaContexto,
      termo: string,
      tipo: 'tenant' | 'cliente_pj',
    ): Promise<EmpresaPublica[]> {
      return empresaRepo.buscarPorNomeETipo(ctx.tenantId, termo, tipo)
    },

    async buscarPorId(ctx: EmpresaContexto, id: string): Promise<EmpresaPublica> {
      const empresa = await empresaRepo.buscarPorId(ctx.tenantId, id)
      if (!empresa) {
        throw new AppError(404, 'Empresa não encontrada')
      }
      return empresa
    },

    async atualizar(
      ctx: EmpresaContexto,
      id: string,
      dados: AtualizarEmpresaInput,
    ): Promise<EmpresaPublica> {
      // Atualiza apenas o cadastro da empresa. Versões já emitidas preservam o
      // snapshot da empresa no momento da emissão e não são afetadas (RF-011).
      // Auditoria gravada pelo repositório na MESMA transação da atualização.
      const atualizado = await empresaRepo.atualizar(ctx.tenantId, id, dados, () => ({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'atualizar',
        entidade: 'empresas',
        entidadeId: id,
        estadoNovo: dados,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }))
      if (!atualizado) {
        throw new AppError(404, 'Empresa não encontrada')
      }

      return atualizado
    },

    async desativar(ctx: EmpresaContexto, id: string): Promise<void> {
      const empresa = await empresaRepo.buscarPorId(ctx.tenantId, id)
      if (!empresa) {
        throw new AppError(404, 'Empresa não encontrada')
      }

      // Auditoria gravada pelo repositório na MESMA transação da desativação.
      await empresaRepo.desativar(ctx.tenantId, id, () => ({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'desativar',
        entidade: 'empresas',
        entidadeId: id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }))
    },
  }
}
