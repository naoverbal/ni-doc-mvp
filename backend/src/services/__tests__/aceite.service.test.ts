import { describe, it, expect, vi, beforeEach } from 'vitest'
import { criarAceiteService } from '../aceite.service.js'
import type {
  OrcamentoAceiteRepository,
  AceitePublico,
} from '../../repositories/orcamento-aceite.repository.js'
import type {
  OrcamentoVersaoRepository,
  VersaoPorToken,
} from '../../repositories/orcamento-versao.repository.js'
import type { OrcamentoRepository } from '../../repositories/orcamento.repository.js'
import type { AuditoriaService } from '../auditoria.service.js'
import type { PdfService } from '../pdf.service.js'
import type { HtmlRendererService } from '../html-renderer.service.js'
import { gerarTokenPublico } from '../../lib/token.js'

// -----------------------------------------------------------------------------
// Testes do serviço de aceite (RF-019, RF-020, RF-021). Todas as dependências
// são mocks via vi.fn() (mesmo padrão de versionamento.service.test). O token
// público é gerado com a lib real (`gerarTokenPublico`) ligado ao id da versão
// mockada, de modo que `validarTokenPublico` passe de verdade no caminho feliz.
// `SESSION_SECRET` está definido no ambiente de teste (vitest.config.ts).
// -----------------------------------------------------------------------------

const VERSAO_ID = 'versao-1'
const HASH = 'a'.repeat(64)
const tokenValido = gerarTokenPublico(VERSAO_ID)

function versaoPorToken(overrides: Partial<VersaoPorToken> = {}): VersaoPorToken {
  return {
    versaoId: VERSAO_ID,
    orcamentoId: 'orc-1',
    tenantId: 'tenant-1',
    numero: 'ORC-2026-0001',
    versao: 1,
    pdfHash: HASH,
    tokenPublico: tokenValido,
    expiraEm: null,
    statusOrcamento: 'enviado',
    ...overrides,
  }
}

function aceitePublico(overrides: Partial<AceitePublico> = {}): AceitePublico {
  return {
    id: 'aceite-1',
    versaoId: VERSAO_ID,
    metodo: 'cliente',
    usuarioId: null,
    ip: '1.2.3.4',
    userAgent: 'agent',
    hashDocumento: HASH,
    justificativa: null,
    criadoEm: new Date('2026-02-01'),
    ...overrides,
  }
}

function makeDeps(overrides?: {
  orcamentoVersaoRepo?: Partial<OrcamentoVersaoRepository>
  aceiteRepo?: Partial<OrcamentoAceiteRepository>
  orcamentoRepo?: Partial<OrcamentoRepository>
  auditoriaService?: Partial<AuditoriaService>
  pdfService?: Partial<PdfService>
  htmlRenderer?: Partial<HtmlRendererService>
  relogio?: () => Date
}) {
  const orcamentoVersaoRepo = {
    criarVersaoEnviar: vi.fn(),
    buscarPorToken: vi.fn().mockResolvedValue(versaoPorToken()),
    buscarVersaoAtualPorOrcamento: vi.fn().mockResolvedValue(versaoPorToken()),
    ...overrides?.orcamentoVersaoRepo,
  } as unknown as OrcamentoVersaoRepository

  const aceiteRepo = {
    aprovarAceite: vi.fn().mockResolvedValue(aceitePublico()),
    buscarPorVersao: vi.fn().mockResolvedValue(null),
    ...overrides?.aceiteRepo,
  } as unknown as OrcamentoAceiteRepository

  const orcamentoRepo = {
    criar: vi.fn(),
    buscarPorId: vi.fn().mockResolvedValue({ id: 'orc-1', numero: 'ORC-2026-0001' }),
    atualizar: vi.fn(),
    listarPorTenant: vi.fn(),
    deletar: vi.fn(),
    ...overrides?.orcamentoRepo,
  } as unknown as OrcamentoRepository

  const auditoriaService = {
    registrar: vi.fn().mockResolvedValue(undefined),
    listar: vi.fn().mockResolvedValue([]),
    ...overrides?.auditoriaService,
  } as unknown as AuditoriaService

  const pdfService = {
    gerarPdf: vi.fn().mockResolvedValue({
      buffer: Buffer.from('%PDF-1.7'),
      caminho: '/pdfs/ORC-2026-0001-aceite-v1.pdf',
      hash: 'comprovante-hash',
    }),
    buscarPdf: vi.fn(),
    ...overrides?.pdfService,
  } as unknown as PdfService

  const htmlRenderer = {
    renderizar: vi.fn().mockReturnValue('<html></html>'),
    ...overrides?.htmlRenderer,
  } as unknown as HtmlRendererService

  return {
    orcamentoVersaoRepo,
    aceiteRepo,
    orcamentoRepo,
    auditoriaService,
    pdfService,
    htmlRenderer,
    ...(overrides?.relogio ? { relogio: overrides.relogio } : {}),
  }
}

describe('AceiteService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('aprovarViaCliente()', () => {
    it('valida o token e registra o aceite com metodo=cliente, IP, UA e hash do documento', async () => {
      const deps = makeDeps()
      const service = criarAceiteService(deps)

      const resultado = await service.aprovarViaCliente({
        token: tokenValido,
        ip: '1.2.3.4',
        userAgent: 'agent',
      })

      expect(deps.orcamentoVersaoRepo.buscarPorToken).toHaveBeenCalledWith(tokenValido)
      expect(deps.aceiteRepo.aprovarAceite).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          versaoId: VERSAO_ID,
          metodo: 'cliente',
          hashDocumento: HASH,
          ip: '1.2.3.4',
          userAgent: 'agent',
        }),
      )
      expect(resultado.metodo).toBe('cliente')
      expect(resultado.orcamentoId).toBe('orc-1')
      expect(resultado.hashDocumento).toBe(HASH)
    })

    it('gera o comprovante PDF com os campos de RF-021.2 e sufixo -aceite no nome', async () => {
      const deps = makeDeps()
      const service = criarAceiteService(deps)

      const resultado = await service.aprovarViaCliente({
        token: tokenValido,
        ip: '1.2.3.4',
        userAgent: 'agent',
      })

      expect(deps.pdfService.gerarPdf).toHaveBeenCalledTimes(1)
      const arg = (deps.pdfService.gerarPdf as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
        html: string
        numero: string
        versao: number
      }
      expect(arg.numero).toBe('ORC-2026-0001-aceite')
      expect(arg.versao).toBe(1)
      // O HTML carrega as evidências exigidas por RF-021.2.
      expect(arg.html).toContain('ORC-2026-0001')
      expect(arg.html).toContain('1.2.3.4')
      expect(arg.html).toContain('agent')
      expect(arg.html).toContain(HASH)
      expect(arg.html).toContain('cliente')
      expect(resultado.comprovantePdfPath).toBe('/pdfs/ORC-2026-0001-aceite-v1.pdf')
      expect(resultado.comprovantePdfHash).toBe('comprovante-hash')
    })

    it('registra auditoria acao=aprovar, entidade=orcamentos com IP/UA', async () => {
      const deps = makeDeps()
      const service = criarAceiteService(deps)

      await service.aprovarViaCliente({ token: tokenValido, ip: '1.2.3.4', userAgent: 'agent' })

      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          acao: 'aprovar',
          entidade: 'orcamentos',
          entidadeId: 'orc-1',
          ip: '1.2.3.4',
          userAgent: 'agent',
        }),
      )
    })

    it('gera comprovante mesmo sem IP/UA (campos opcionais vazios no HTML)', async () => {
      const deps = makeDeps()
      const service = criarAceiteService(deps)

      await service.aprovarViaCliente({ token: tokenValido })

      expect(deps.aceiteRepo.aprovarAceite).toHaveBeenCalledWith(
        expect.objectContaining({ ip: undefined, userAgent: undefined }),
      )
      expect(deps.pdfService.gerarPdf).toHaveBeenCalledTimes(1)
    })

    it('lança AppError(410) quando o token não existe e não persiste nem gera PDF', async () => {
      const deps = makeDeps({
        orcamentoVersaoRepo: { buscarPorToken: vi.fn().mockResolvedValue(null) },
      })
      const service = criarAceiteService(deps)

      await expect(service.aprovarViaCliente({ token: tokenValido })).rejects.toMatchObject({
        statusCode: 410,
      })
      expect(deps.aceiteRepo.aprovarAceite).not.toHaveBeenCalled()
      expect(deps.pdfService.gerarPdf).not.toHaveBeenCalled()
    })

    it('lança AppError(410) quando o HMAC do token é inválido', async () => {
      const deps = makeDeps({
        orcamentoVersaoRepo: {
          buscarPorToken: vi
            .fn()
            .mockResolvedValue(versaoPorToken({ tokenPublico: 'uuid.hmacadulterado' })),
        },
      })
      const service = criarAceiteService(deps)

      // Token com HMAC que não valida contra o id da versão.
      await expect(
        service.aprovarViaCliente({ token: 'abc.deadbeef' }),
      ).rejects.toMatchObject({ statusCode: 410 })
      expect(deps.aceiteRepo.aprovarAceite).not.toHaveBeenCalled()
    })

    it('lança AppError(410) quando a versão está expirada', async () => {
      const deps = makeDeps({
        orcamentoVersaoRepo: {
          buscarPorToken: vi
            .fn()
            .mockResolvedValue(versaoPorToken({ expiraEm: new Date('2026-01-01') })),
        },
        relogio: () => new Date('2026-02-01'),
      })
      const service = criarAceiteService(deps)

      await expect(service.aprovarViaCliente({ token: tokenValido })).rejects.toMatchObject({
        statusCode: 410,
      })
      expect(deps.aceiteRepo.aprovarAceite).not.toHaveBeenCalled()
    })

    it('lança AppError(409) quando o orçamento já está aprovado (duplicado) e não gera PDF', async () => {
      const deps = makeDeps({
        orcamentoVersaoRepo: {
          buscarPorToken: vi
            .fn()
            .mockResolvedValue(versaoPorToken({ statusOrcamento: 'aprovado' })),
        },
      })
      const service = criarAceiteService(deps)

      await expect(service.aprovarViaCliente({ token: tokenValido })).rejects.toMatchObject({
        statusCode: 409,
      })
      expect(deps.pdfService.gerarPdf).not.toHaveBeenCalled()
    })

    it('propaga AppError(409) do repositório (constraint UNIQUE) e não registra auditoria', async () => {
      const deps = makeDeps({
        aceiteRepo: {
          aprovarAceite: vi.fn().mockRejectedValue(new (await import('../../errors/app-error.js')).AppError(409, 'duplicado')),
          buscarPorVersao: vi.fn().mockResolvedValue(null),
        },
      })
      const service = criarAceiteService(deps)

      await expect(service.aprovarViaCliente({ token: tokenValido })).rejects.toMatchObject({
        statusCode: 409,
      })
      expect(deps.auditoriaService.registrar).not.toHaveBeenCalled()
    })

    it('lança AppError(409) quando a versão não tem pdf_hash (documento sem integridade)', async () => {
      const deps = makeDeps({
        orcamentoVersaoRepo: {
          buscarPorToken: vi.fn().mockResolvedValue(versaoPorToken({ pdfHash: null })),
        },
      })
      const service = criarAceiteService(deps)

      await expect(service.aprovarViaCliente({ token: tokenValido })).rejects.toMatchObject({
        statusCode: 409,
      })
      expect(deps.aceiteRepo.aprovarAceite).not.toHaveBeenCalled()
    })
  })

  describe('aceiteManual()', () => {
    const inputManual = {
      tenantId: 'tenant-1',
      orcamentoId: 'orc-1',
      usuarioId: 'op-1',
      justificativa: 'cliente confirmou por telefone',
    }

    it('lança AppError(400) quando a justificativa é vazia e nada persiste', async () => {
      const deps = makeDeps()
      const service = criarAceiteService(deps)

      await expect(
        service.aceiteManual({ ...inputManual, justificativa: '   ' }),
      ).rejects.toMatchObject({ statusCode: 400 })
      expect(deps.aceiteRepo.aprovarAceite).not.toHaveBeenCalled()
    })

    it('registra o aceite com metodo=operador, usuario e justificativa', async () => {
      const deps = makeDeps({
        aceiteRepo: {
          aprovarAceite: vi
            .fn()
            .mockResolvedValue(
              aceitePublico({ metodo: 'operador', usuarioId: 'op-1', ip: null, userAgent: null }),
            ),
          buscarPorVersao: vi.fn(),
        },
      })
      const service = criarAceiteService(deps)

      const resultado = await service.aceiteManual(inputManual)

      expect(deps.aceiteRepo.aprovarAceite).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          versaoId: VERSAO_ID,
          metodo: 'operador',
          usuarioId: 'op-1',
          justificativa: 'cliente confirmou por telefone',
          hashDocumento: HASH,
        }),
      )
      expect(resultado.metodo).toBe('operador')
    })

    it('gera o comprovante PDF com metodo=operador', async () => {
      const deps = makeDeps()
      const service = criarAceiteService(deps)

      const resultado = await service.aceiteManual(inputManual)

      const arg = (deps.pdfService.gerarPdf as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
        html: string
        numero: string
      }
      expect(arg.numero).toBe('ORC-2026-0001-aceite')
      expect(arg.html).toContain('operador')
      expect(resultado.comprovantePdfPath).toBe('/pdfs/ORC-2026-0001-aceite-v1.pdf')
    })

    it('registra auditoria acao=aceite_manual com usuarioId e entidadeId', async () => {
      const deps = makeDeps()
      const service = criarAceiteService(deps)

      await service.aceiteManual(inputManual)

      expect(deps.auditoriaService.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          usuarioId: 'op-1',
          acao: 'aceite_manual',
          entidade: 'orcamentos',
          entidadeId: 'orc-1',
        }),
      )
    })

    it('lança AppError(404) quando o orçamento não existe', async () => {
      const deps = makeDeps({ orcamentoRepo: { buscarPorId: vi.fn().mockResolvedValue(null) } })
      const service = criarAceiteService(deps)

      await expect(service.aceiteManual(inputManual)).rejects.toMatchObject({ statusCode: 404 })
      expect(deps.aceiteRepo.aprovarAceite).not.toHaveBeenCalled()
    })

    it('lança AppError(409) quando o orçamento não tem versão enviada', async () => {
      const deps = makeDeps({
        orcamentoVersaoRepo: {
          buscarVersaoAtualPorOrcamento: vi.fn().mockResolvedValue(null),
        },
      })
      const service = criarAceiteService(deps)

      await expect(service.aceiteManual(inputManual)).rejects.toMatchObject({ statusCode: 409 })
      expect(deps.aceiteRepo.aprovarAceite).not.toHaveBeenCalled()
    })

    it('propaga AppError(409) do repositório quando o orçamento já está aprovado', async () => {
      const { AppError } = await import('../../errors/app-error.js')
      const deps = makeDeps({
        aceiteRepo: {
          aprovarAceite: vi.fn().mockRejectedValue(new AppError(409, 'Orçamento já aprovado')),
          buscarPorVersao: vi.fn(),
        },
      })
      const service = criarAceiteService(deps)

      await expect(service.aceiteManual(inputManual)).rejects.toMatchObject({ statusCode: 409 })
      expect(deps.auditoriaService.registrar).not.toHaveBeenCalled()
    })
  })
})
