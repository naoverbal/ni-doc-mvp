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
import type { PdfService } from './pdf.service.js'
import type { HtmlRendererService } from './html-renderer.service.js'
import type { LayoutTemplate, TemplateRepository } from '../repositories/template.repository.js'
import { gerarQrCodeDataUrl } from '../lib/qrcode.js'

// -----------------------------------------------------------------------------
// Serviço de versionamento (RF-008, RF-009, RF-016). Transforma um orçamento
// `rascunho` em uma versão imutável enviada: monta o snapshot (snapshot.service),
// carrega o template ativo e orquestra a geração do PDF (html-renderer + QR +
// pdf.service) DENTRO da transação de persistência do repositório — se o PDF
// falhar, o envio inteiro reverte (nenhuma versão/estado parcial persiste). A
// persistência atômica (próxima versão sequencial, token público único,
// invalidação do aceite anterior, status → `enviado`, pdf_path/pdf_hash) é
// delegada ao repositório; ao final registra auditoria.
//
// Imutabilidade (RF-016): o PDF não é regenerado em acessos posteriores — isso é
// garantido por `pdf.service.gerarPdf` (reusa os bytes se o arquivo já existir)
// e por `buscarPdf`; aqui apenas delegamos, sem lógica de regeneração própria.
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
  pdfService: PdfService
  htmlRenderer: HtmlRendererService
  templateRepo: TemplateRepository
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
    pdfService,
    htmlRenderer,
    templateRepo,
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

      // Template ativo do tenant (respeita o isolamento por tenant). A coluna
      // template_id da versão é NOT NULL; sem template ativo o envio não segue.
      // Nota (MVP): o layout vem desta leitura e o template_id persistido é
      // relido dentro da transação do repositório (tenants_template_ativo). Com
      // um único template ativo por tenant no MVP as duas fontes convergem; a
      // janela de divergência (troca de template entre as leituras) é aceitável
      // neste escopo e fica para uma futura unificação.
      const template = await templateRepo.buscarAtivo(ctx.tenantId)
      if (!template) {
        throw new AppError(409, 'Tenant não possui template ativo')
      }

      const versao = await orcamentoVersaoRepo.criarVersaoEnviar({
        tenantId: ctx.tenantId,
        orcamentoId,
        numero: orcamento.numero,
        snapshot,
        expiraEm: null,
        // Geração do PDF dentro da transação do repositório: renderiza o HTML
        // (com o QR Code da URL pública embutido) e delega ao pdfService. Uma
        // falha aqui propaga e a transação reverte o envio inteiro (RF-016).
        gerarPdfDaVersao: async ({ versao, numero, tokenPublico }) => {
          // URL pública relativa; a base URL absoluta é item de tarefa futura
          // (não há env de base URL no escopo desta tarefa).
          const urlPublica = `/publico/orcamento/${tokenPublico}`
          const qrCodeDataUrl = await gerarQrCodeDataUrl(urlPublica)

          // Embute o QR nas imagens do layout sem descartar as existentes; o
          // renderer resolve `{img:qrcode}`.
          const imagensExistentes =
            typeof template.layoutJson['imagens'] === 'object' &&
            template.layoutJson['imagens'] !== null
              ? (template.layoutJson['imagens'] as Record<string, unknown>)
              : {}
          const layoutComQr: LayoutTemplate = {
            ...template.layoutJson,
            imagens: { ...imagensExistentes, qrcode: qrCodeDataUrl },
          }

          const html = htmlRenderer.renderizar({ layout: layoutComQr, snapshot, numero, versao })
          const pdf = await pdfService.gerarPdf({ html, numero, versao })
          return { pdfPath: pdf.caminho, pdfHash: pdf.hash }
        },
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
