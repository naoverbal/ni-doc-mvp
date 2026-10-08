import { AppError } from '../errors/app-error.js'
import type { OrcamentoRepository } from '../repositories/orcamento.repository.js'
import type { OrcamentoVersaoRepository } from '../repositories/orcamento-versao.repository.js'
import type { ClienteRepository } from '../repositories/cliente.repository.js'
import type { EmpresaRepository, EmpresaPublica } from '../repositories/empresa.repository.js'
import type {
  ResponsavelPublico,
  ResponsavelRepository,
} from '../repositories/responsavel.repository.js'
import type { SnapshotService } from './snapshot.service.js'
import type { AuditoriaService } from './auditoria.service.js'

// -----------------------------------------------------------------------------
// Serviço de versionamento (RF-008, RF-009). Transforma um orçamento `rascunho`
// em uma versão imutável enviada: monta o snapshot (snapshot.service), delega a
// persistência atômica ao repositório de versões (próxima versão sequencial,
// token público único, invalidação do aceite anterior, status → `enviado`) e
// registra auditoria. A geração de PDF é da tarefa 40: pdf_path/pdf_hash nulos.
// -----------------------------------------------------------------------------

export interface VersionamentoContexto {
  tenantId: string
  usuarioId: string
  ip?: string
  userAgent?: string
}

export interface VersaoEnviada {
  id: string
  orcamentoId: string
  versao: number
  tokenPublico: string
  templateId: string
  pdfPath: string | null
  pdfHash: string | null
  enviadoEm: Date
  expiraEm: Date | null
}

export interface VersionamentoService {
  enviar(ctx: VersionamentoContexto, orcamentoId: string): Promise<VersaoEnviada>
}

interface VersionamentoServiceDeps {
  orcamentoRepo: OrcamentoRepository
  orcamentoVersaoRepo: OrcamentoVersaoRepository
  clienteRepo: ClienteRepository
  empresaRepo: EmpresaRepository
  responsavelRepo: ResponsavelRepository
  snapshotService: SnapshotService
  auditoriaService: AuditoriaService
}

export function criarVersionamentoService(deps: VersionamentoServiceDeps): VersionamentoService {
  const {
    orcamentoRepo,
    orcamentoVersaoRepo,
    clienteRepo,
    empresaRepo,
    responsavelRepo,
    snapshotService,
    auditoriaService,
  } = deps

  return {
    async enviar(ctx: VersionamentoContexto, orcamentoId: string): Promise<VersaoEnviada> {
      const orcamento = await orcamentoRepo.buscarPorId(ctx.tenantId, orcamentoId)
      if (!orcamento) {
        throw new AppError(404, 'Orçamento não encontrado')
      }
      // Só rascunho pode ser enviado (RF-008). Conflito de estado → 409.
      if (orcamento.status !== 'rascunho') {
        throw new AppError(409, 'Só é possível enviar orçamentos em rascunho')
      }
      // Regra de entrada: rascunho precisa ter itens → 400.
      if (orcamento.itens.length === 0) {
        throw new AppError(400, 'Orçamento deve ter ao menos um item')
      }

      // Dados vivos exigidos pelo snapshot imutável.
      const cliente = await clienteRepo.buscarPorId(ctx.tenantId, orcamento.clienteId)
      if (!cliente) {
        throw new AppError(409, 'Cliente do orçamento não encontrado')
      }

      let empresaCliente: EmpresaPublica | null = null
      if (orcamento.empresaClienteId !== null) {
        empresaCliente = await empresaRepo.buscarPorId(ctx.tenantId, orcamento.empresaClienteId)
      }

      // Responsáveis distintos (ids não-nulos). Ausentes no banco não entram no Map.
      const idsResponsaveis = [
        ...new Set(
          orcamento.itens
            .map((item) => item.responsavelId)
            .filter((id): id is string => id !== null),
        ),
      ]
      const responsaveisPorId = new Map<string, ResponsavelPublico>()
      for (const id of idsResponsaveis) {
        const responsavel = await responsavelRepo.buscarPorId(ctx.tenantId, id)
        if (responsavel) {
          responsaveisPorId.set(id, responsavel)
        }
      }

      const snapshot = snapshotService.montar({
        orcamento,
        cliente,
        empresaCliente,
        responsaveisPorId,
      })

      const versao = await orcamentoVersaoRepo.criarVersaoEnviar({
        tenantId: ctx.tenantId,
        orcamentoId,
        snapshot,
        expiraEm: null,
      })

      await auditoriaService.registrar({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'enviar',
        entidade: 'orcamentos',
        entidadeId: orcamentoId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })

      return {
        id: versao.id,
        orcamentoId: versao.orcamentoId,
        versao: versao.versao,
        tokenPublico: versao.tokenPublico,
        templateId: versao.templateId,
        pdfPath: versao.pdfPath,
        pdfHash: versao.pdfHash,
        enviadoEm: versao.enviadoEm,
        expiraEm: versao.expiraEm,
      }
    },
  }
}
