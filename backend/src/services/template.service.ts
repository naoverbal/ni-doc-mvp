import { AppError } from '../errors/app-error.js'
import type {
  LayoutTemplate,
  TemplatePublico,
  TemplateRepository,
} from '../repositories/template.repository.js'
import type { AuditoriaService } from './auditoria.service.js'

export interface TemplateContexto {
  tenantId: string
  usuarioId: string
  ip?: string
  userAgent?: string
}

export interface TemplateService {
  // Cria a versão padrão (v1) do tenant; chamado no bootstrap de criação do tenant.
  criarTemplatePadrao(tenantId: string): Promise<TemplatePublico>
  // Salva uma nova versão do template ativo e registra auditoria.
  salvar(ctx: TemplateContexto, layoutJson: LayoutTemplate): Promise<TemplatePublico>
  // Retorna a versão ativa do tenant; AppError(404) se não houver.
  buscarAtivo(ctx: TemplateContexto): Promise<TemplatePublico>
  // Retorna uma versão específica; AppError(404) se não existir.
  buscarPorId(ctx: TemplateContexto, id: string): Promise<TemplatePublico>
}

interface TemplateServiceDeps {
  templateRepo: TemplateRepository
  auditoriaService: AuditoriaService
}

export function criarTemplateService(deps: TemplateServiceDeps): TemplateService {
  const { templateRepo, auditoriaService } = deps

  return {
    async criarTemplatePadrao(tenantId: string): Promise<TemplatePublico> {
      // Sem auditoria: ocorre no bootstrap do tenant, antes de haver contexto de
      // usuário; a auditoria da *alteração* de template é feita em `salvar`.
      return templateRepo.criarTemplatePadrao(tenantId)
    },

    async salvar(ctx: TemplateContexto, layoutJson: LayoutTemplate): Promise<TemplatePublico> {
      const template = await templateRepo.salvar({ tenantId: ctx.tenantId, layoutJson })

      await auditoriaService.registrar({
        tenantId: ctx.tenantId,
        usuarioId: ctx.usuarioId,
        acao: 'atualizar',
        entidade: 'templates',
        entidadeId: template.id,
        estadoNovo: { versao: template.versao },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })

      return template
    },

    async buscarAtivo(ctx: TemplateContexto): Promise<TemplatePublico> {
      const template = await templateRepo.buscarAtivo(ctx.tenantId)
      if (!template) {
        throw new AppError(404, 'Template não encontrado')
      }
      return template
    },

    async buscarPorId(ctx: TemplateContexto, id: string): Promise<TemplatePublico> {
      const template = await templateRepo.buscarPorId(ctx.tenantId, id)
      if (!template) {
        throw new AppError(404, 'Template não encontrado')
      }
      return template
    },
  }
}
