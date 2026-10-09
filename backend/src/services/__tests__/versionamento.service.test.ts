import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarVersionamentoService } from '../versionamento.service.js'
import type {
  OrcamentoComItens,
  OrcamentoRepository,
  OrcamentoStatus,
} from '../../repositories/orcamento.repository.js'
import type {
  CriarVersaoEnviarInput,
  OrcamentoVersaoPublica,
  OrcamentoVersaoRepository,
} from '../../repositories/orcamento-versao.repository.js'
import type { ClienteRepository, ClientePublico } from '../../repositories/cliente.repository.js'
import type { EmpresaRepository, EmpresaPublica } from '../../repositories/empresa.repository.js'
import type {
  ResponsavelRepository,
  ResponsavelPublico,
} from '../../repositories/responsavel.repository.js'
import type { SnapshotService } from '../snapshot.service.js'
import type { AuditoriaService } from '../auditoria.service.js'
import type { PdfService } from '../pdf.service.js'
import type { HtmlRendererService } from '../html-renderer.service.js'
import type { TemplatePublico, TemplateRepository } from '../../repositories/template.repository.js'
import { AppError } from '../../errors/app-error.js'

function itemMock(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    ordem: 1,
    nome: 'Serviço A',
    descricao: null,
    quantidade: 1,
    unidade: 'un',
    valorUnitario: 100,
    descontoTipo: null,
    descontoValor: null,
    total: 100,
    responsavelId: null,
    ...overrides,
  }
}

function orcamentoMock(overrides: Partial<OrcamentoComItens> = {}): OrcamentoComItens {
  return {
    id: 'orcamento-1',
    tenantId: 'tenant-1',
    numero: 'ORC-2026-0001',
    clienteId: 'cliente-1',
    empresaClienteId: null,
    usuarioId: 'user-1',
    titulo: 'Projeto X',
    descricao: null,
    status: 'rascunho' as OrcamentoStatus,
    dataEmissao: new Date('2026-01-01'),
    validadeDias: 30,
    descontoGlobalTipo: null,
    descontoGlobalValor: null,
    subtotal: 100,
    total: 100,
    versaoAtual: 0,
    observacoes: null,
    condicoesPagamento: null,
    criadoEm: new Date('2026-01-01'),
    atualizadoEm: new Date('2026-01-01'),
    itens: [itemMock()],
    ...overrides,
  }
}

const clienteMock: ClientePublico = {
  id: 'cliente-1',
  tenantId: 'tenant-1',
  tipoPessoa: 'PJ',
  nome: 'Cliente LTDA',
  documento: '12345678000190',
  email: null,
  telefone: null,
  endereco: null,
  observacoes: null,
  ativo: true,
  criadoEm: new Date('2026-01-01'),
}

const empresaMock: EmpresaPublica = {
  id: 'empresa-1',
  tenantId: 'tenant-1',
  tipo: 'cliente_pj',
  razaoSocial: 'Empresa Cliente SA',
  nomeFantasia: null,
  cnpj: null,
  email: null,
  telefone: null,
  endereco: null,
  ativo: true,
  criadoEm: new Date('2026-01-01'),
}

function responsavelMock(id: string): ResponsavelPublico {
  return {
    id,
    tenantId: 'tenant-1',
    nome: `Resp ${id}`,
    registroProfissional: null,
    email: null,
    telefone: null,
    ativo: true,
    criadoEm: new Date('2026-01-01'),
  }
}

const versaoPublicaMock: OrcamentoVersaoPublica = {
  id: 'versao-1',
  orcamentoId: 'orcamento-1',
  versao: 1,
  tokenPublico: 'uuid.hmac',
  templateId: 'template-1',
  pdfPath: null,
  pdfHash: null,
  enviadoEm: new Date('2026-01-10'),
  expiraEm: null,
}

const templateMock: TemplatePublico = {
  id: 'template-1',
  tenantId: 'tenant-1',
  versao: 1,
  layoutJson: { corpo: '{itens}', imagens: { logo: 'data:image/png;base64,LOGO' } },
  criadoEm: new Date('2026-01-01'),
}

// Simula o comportamento transacional real de `criarVersaoEnviar`: dentro da
// "transação", invoca o callback `gerarPdfDaVersao` (quando presente) e reflete
// `pdfPath`/`pdfHash` resultantes na versão retornada. Se o callback rejeita, a
// rejeição propaga (como o rollback real da trx faria).
function criarVersaoEnviarMock() {
  return vi.fn(async (input: CriarVersaoEnviarInput): Promise<OrcamentoVersaoPublica> => {
    if (input.gerarPdfDaVersao) {
      const { pdfPath, pdfHash } = await input.gerarPdfDaVersao({
        versao: versaoPublicaMock.versao,
        numero: input.numero,
        tokenPublico: versaoPublicaMock.tokenPublico,
        templateId: versaoPublicaMock.templateId,
      })
      return { ...versaoPublicaMock, pdfPath, pdfHash }
    }
    return versaoPublicaMock
  })
}

function makeDeps(overrides?: {
  orcamentoRepo?: Partial<OrcamentoRepository>
  orcamentoVersaoRepo?: Partial<OrcamentoVersaoRepository>
  clienteRepo?: Partial<ClienteRepository>
  empresaRepo?: Partial<EmpresaRepository>
  responsavelRepo?: Partial<ResponsavelRepository>
  snapshotService?: Partial<SnapshotService>
  auditoriaService?: Partial<AuditoriaService>
  pdfService?: Partial<PdfService>
  htmlRenderer?: Partial<HtmlRendererService>
  templateRepo?: Partial<TemplateRepository>
}) {
  const orcamentoRepo = {
    criar: vi.fn(),
    buscarPorId: vi.fn().mockResolvedValue(orcamentoMock()),
    atualizar: vi.fn(),
    listarPorTenant: vi.fn(),
    deletar: vi.fn(),
    ...overrides?.orcamentoRepo,
  } as unknown as OrcamentoRepository

  const orcamentoVersaoRepo = {
    criarVersaoEnviar: criarVersaoEnviarMock(),
    ...overrides?.orcamentoVersaoRepo,
  } as unknown as OrcamentoVersaoRepository

  const clienteRepo = {
    criar: vi.fn(),
    buscarPorDocumentoHash: vi.fn(),
    buscarPorId: vi.fn().mockResolvedValue(clienteMock),
    buscarPorNome: vi.fn(),
    atualizar: vi.fn(),
    desativar: vi.fn(),
    ...overrides?.clienteRepo,
  } as unknown as ClienteRepository

  const empresaRepo = {
    criar: vi.fn(),
    buscarPorCnpjHash: vi.fn(),
    buscarPorId: vi.fn().mockResolvedValue(empresaMock),
    buscarPorNomeETipo: vi.fn(),
    atualizar: vi.fn(),
    desativar: vi.fn(),
    ...overrides?.empresaRepo,
  } as unknown as EmpresaRepository

  const responsavelRepo = {
    criar: vi.fn(),
    buscarPorId: vi
      .fn()
      .mockImplementation((_t: string, id: string) => Promise.resolve(responsavelMock(id))),
    buscarPorNome: vi.fn(),
    atualizar: vi.fn(),
    desativar: vi.fn(),
    ...overrides?.responsavelRepo,
  } as unknown as ResponsavelRepository

  const snapshotService = {
    montar: vi.fn().mockReturnValue({ cliente: { id: 'cliente-1' }, itens: [] }),
    ...overrides?.snapshotService,
  } as unknown as SnapshotService

  const auditoriaService = {
    registrar: vi.fn().mockResolvedValue(undefined),
    listar: vi.fn().mockResolvedValue([]),
    ...overrides?.auditoriaService,
  } as unknown as AuditoriaService

  const pdfService = {
    gerarPdf: vi.fn().mockResolvedValue({
      buffer: Buffer.from('%PDF-1.7'),
      caminho: '/var/ni-doc/pdfs/ORC-2026-0001-v1.pdf',
      hash: 'abc123',
    }),
    buscarPdf: vi.fn(),
    ...overrides?.pdfService,
  } as unknown as PdfService

  const htmlRenderer = {
    renderizar: vi.fn().mockReturnValue('<html></html>'),
    ...overrides?.htmlRenderer,
  } as unknown as HtmlRendererService

  const templateRepo = {
    criarTemplatePadrao: vi.fn(),
    salvar: vi.fn(),
    buscarAtivo: vi.fn().mockResolvedValue(templateMock),
    buscarPorId: vi.fn(),
    ...overrides?.templateRepo,
  } as unknown as TemplateRepository

  return {
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
  }
}

const ctx = { tenantId: 'tenant-1', usuarioId: 'user-1', ip: '1.2.3.4', userAgent: 'jest' }

describe('VersionamentoService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('envia um rascunho com itens: monta snapshot e persiste a versão', async () => {
    const deps = makeDeps()
    const service = criarVersionamentoService(deps)

    const versao = await service.enviar(ctx, 'orcamento-1')

    expect(deps.clienteRepo.buscarPorId).toHaveBeenCalledWith('tenant-1', 'cliente-1')
    expect(deps.snapshotService.montar).toHaveBeenCalledWith(
      expect.objectContaining({
        orcamento: expect.objectContaining({ id: 'orcamento-1' }),
        cliente: clienteMock,
      }),
    )
    expect(deps.orcamentoVersaoRepo.criarVersaoEnviar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', orcamentoId: 'orcamento-1' }),
    )
    expect(versao.versao).toBe(1)
    expect(versao.tokenPublico).toBe('uuid.hmac')
  })

  it('gera o PDF no envio e persiste pdf_path e pdf_hash na versão', async () => {
    const deps = makeDeps()
    const service = criarVersionamentoService(deps)

    const versao = await service.enviar(ctx, 'orcamento-1')

    // Template ativo do tenant é carregado para a renderização.
    expect(deps.templateRepo.buscarAtivo).toHaveBeenCalledWith('tenant-1')
    // HTML renderizado com layout + snapshot + numero + versao.
    expect(deps.htmlRenderer.renderizar).toHaveBeenCalledWith(
      expect.objectContaining({ numero: 'ORC-2026-0001', versao: 1 }),
    )
    // PDF gerado com o HTML montado e o identificador numero/versao.
    expect(deps.pdfService.gerarPdf).toHaveBeenCalledWith(
      expect.objectContaining({ html: '<html></html>', numero: 'ORC-2026-0001', versao: 1 }),
    )
    // O repositório recebe o callback de geração + o numero do arquivo.
    expect(deps.orcamentoVersaoRepo.criarVersaoEnviar).toHaveBeenCalledWith(
      expect.objectContaining({
        numero: 'ORC-2026-0001',
        gerarPdfDaVersao: expect.any(Function),
      }),
    )
    // A versão retornada carrega pdf_path e pdf_hash preenchidos.
    expect(versao.pdfPath).toBe('/var/ni-doc/pdfs/ORC-2026-0001-v1.pdf')
    expect(versao.pdfHash).toBe('abc123')
  })

  it('embute o QR Code da URL pública no layout antes de renderizar o HTML', async () => {
    const deps = makeDeps()
    const service = criarVersionamentoService(deps)

    await service.enviar(ctx, 'orcamento-1')

    const renderArg = (deps.htmlRenderer.renderizar as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { layout: { imagens: Record<string, string> } }
    // A imagem `qrcode` é adicionada sem descartar imagens já existentes do layout.
    expect(renderArg.layout.imagens.qrcode).toMatch(/^data:image\/png;base64,/)
    expect(renderArg.layout.imagens.logo).toBe('data:image/png;base64,LOGO')
  })

  it('é imutável: delega a geração ao pdfService.gerarPdf sem regenerar por conta própria', async () => {
    const deps = makeDeps()
    const service = criarVersionamentoService(deps)

    await service.enviar(ctx, 'orcamento-1')

    // Um único ponto de geração: o serviço chama gerarPdf exatamente uma vez e
    // não implementa regeneração própria (a imutabilidade/reuso vive no pdfService).
    expect(deps.pdfService.gerarPdf).toHaveBeenCalledTimes(1)
    expect(deps.htmlRenderer.renderizar).toHaveBeenCalledTimes(1)
  })

  it('faz rollback quando a geração de PDF falha: propaga o erro e não registra auditoria', async () => {
    const deps = makeDeps({
      pdfService: {
        gerarPdf: vi.fn().mockRejectedValue(new AppError(500, 'falha ao gerar PDF')),
      },
    })
    const service = criarVersionamentoService(deps)

    await expect(service.enviar(ctx, 'orcamento-1')).rejects.toMatchObject({ statusCode: 500 })
    // Nenhum estado parcial: auditoria só roda após a persistência bem-sucedida.
    expect(deps.auditoriaService.registrar).not.toHaveBeenCalled()
  })

  it('lança AppError(409) quando o tenant não possui template ativo', async () => {
    const deps = makeDeps({ templateRepo: { buscarAtivo: vi.fn().mockResolvedValue(null) } })
    const service = criarVersionamentoService(deps)

    await expect(service.enviar(ctx, 'orcamento-1')).rejects.toMatchObject({ statusCode: 409 })
    expect(deps.pdfService.gerarPdf).not.toHaveBeenCalled()
  })

  it('lança AppError(404) quando o orçamento não existe', async () => {
    const deps = makeDeps({ orcamentoRepo: { buscarPorId: vi.fn().mockResolvedValue(null) } })
    const service = criarVersionamentoService(deps)

    await expect(service.enviar(ctx, 'inexistente')).rejects.toMatchObject({ statusCode: 404 })
    expect(deps.orcamentoVersaoRepo.criarVersaoEnviar).not.toHaveBeenCalled()
  })

  it('lança AppError(409) quando o status não é rascunho', async () => {
    const deps = makeDeps({
      orcamentoRepo: {
        buscarPorId: vi.fn().mockResolvedValue(orcamentoMock({ status: 'enviado' })),
      },
    })
    const service = criarVersionamentoService(deps)

    await expect(service.enviar(ctx, 'orcamento-1')).rejects.toMatchObject({ statusCode: 409 })
    expect(deps.orcamentoVersaoRepo.criarVersaoEnviar).not.toHaveBeenCalled()
  })

  it('lança AppError(409) quando o status é aprovado', async () => {
    const deps = makeDeps({
      orcamentoRepo: {
        buscarPorId: vi.fn().mockResolvedValue(orcamentoMock({ status: 'aprovado' })),
      },
    })
    const service = criarVersionamentoService(deps)

    await expect(service.enviar(ctx, 'orcamento-1')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('lança AppError(400) quando o rascunho não tem itens', async () => {
    const deps = makeDeps({
      orcamentoRepo: { buscarPorId: vi.fn().mockResolvedValue(orcamentoMock({ itens: [] })) },
    })
    const service = criarVersionamentoService(deps)

    await expect(service.enviar(ctx, 'orcamento-1')).rejects.toMatchObject({ statusCode: 400 })
    expect(deps.orcamentoVersaoRepo.criarVersaoEnviar).not.toHaveBeenCalled()
  })

  it('registra auditoria com acao=enviar após a persistência', async () => {
    const deps = makeDeps()
    const service = criarVersionamentoService(deps)

    await service.enviar(ctx, 'orcamento-1')

    expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        usuarioId: 'user-1',
        acao: 'enviar',
        entidade: 'orcamentos',
        entidadeId: 'orcamento-1',
        ip: '1.2.3.4',
        userAgent: 'jest',
      }),
    )
  })

  it('passa empresa null ao snapshot quando empresaClienteId é null (não busca empresa)', async () => {
    const deps = makeDeps()
    const service = criarVersionamentoService(deps)

    await service.enviar(ctx, 'orcamento-1')

    expect(deps.empresaRepo.buscarPorId).not.toHaveBeenCalled()
    expect(deps.snapshotService.montar).toHaveBeenCalledWith(
      expect.objectContaining({ empresaCliente: null }),
    )
  })

  it('busca e passa a empresa quando empresaClienteId está presente', async () => {
    const deps = makeDeps({
      orcamentoRepo: {
        buscarPorId: vi.fn().mockResolvedValue(orcamentoMock({ empresaClienteId: 'empresa-1' })),
      },
    })
    const service = criarVersionamentoService(deps)

    await service.enviar(ctx, 'orcamento-1')

    expect(deps.empresaRepo.buscarPorId).toHaveBeenCalledWith('tenant-1', 'empresa-1')
    expect(deps.snapshotService.montar).toHaveBeenCalledWith(
      expect.objectContaining({ empresaCliente: empresaMock }),
    )
  })

  it('resolve responsáveis distintos sem buscas duplicadas e monta o Map', async () => {
    const deps = makeDeps({
      orcamentoRepo: {
        buscarPorId: vi.fn().mockResolvedValue(
          orcamentoMock({
            itens: [
              itemMock({ id: 'i1', responsavelId: 'resp-1' }),
              itemMock({ id: 'i2', responsavelId: 'resp-1' }),
              itemMock({ id: 'i3', responsavelId: 'resp-2' }),
              itemMock({ id: 'i4', responsavelId: null }),
            ],
          }),
        ),
      },
    })
    const service = criarVersionamentoService(deps)

    await service.enviar(ctx, 'orcamento-1')

    // 2 ids distintos não-nulos → 2 buscas (não 3; e o null é ignorado).
    expect(deps.responsavelRepo.buscarPorId).toHaveBeenCalledTimes(2)
    const montarArg = (deps.snapshotService.montar as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { responsaveisPorId: Map<string, ResponsavelPublico> }
    expect(montarArg.responsaveisPorId.size).toBe(2)
    expect(montarArg.responsaveisPorId.get('resp-1')?.id).toBe('resp-1')
  })

  it('ignora responsável ausente no banco (não entra no Map)', async () => {
    const deps = makeDeps({
      orcamentoRepo: {
        buscarPorId: vi
          .fn()
          .mockResolvedValue(orcamentoMock({ itens: [itemMock({ responsavelId: 'resp-x' })] })),
      },
      responsavelRepo: { buscarPorId: vi.fn().mockResolvedValue(null) },
    })
    const service = criarVersionamentoService(deps)

    await service.enviar(ctx, 'orcamento-1')

    const montarArg = (deps.snapshotService.montar as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { responsaveisPorId: Map<string, ResponsavelPublico> }
    expect(montarArg.responsaveisPorId.size).toBe(0)
  })

  it('lança AppError(409) quando o cliente do orçamento não é encontrado', async () => {
    const deps = makeDeps({ clienteRepo: { buscarPorId: vi.fn().mockResolvedValue(null) } })
    const service = criarVersionamentoService(deps)

    await expect(service.enviar(ctx, 'orcamento-1')).rejects.toMatchObject({ statusCode: 409 })
    expect(deps.orcamentoVersaoRepo.criarVersaoEnviar).not.toHaveBeenCalled()
  })
})
