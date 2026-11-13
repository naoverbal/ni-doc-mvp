import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import {
  criarLimparPdfsJob,
  type PdfExpirado,
  type LimparPdfsRepositorio,
  type LimparPdfsFileSystem,
} from '../limpar-pdfs.js'
import { eventoAuditoriaDe } from '../../__tests__/auditoria-teste.js'

// Logger silencioso para não poluir a saída dos testes.
const loggerSilencioso = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

// -----------------------------------------------------------------------------
// Testes do job de limpeza de PDFs (Tarefa 55, _Requirements: cleanup_).
//
// O job é um `criar*` com dependências injetadas (repositório, filesystem,
// serviço de auditoria e relógio), de modo que roda sem banco, sem disco real e
// sem agendador de cron. Validamos: cálculo da data-limite (1 ano), remoção dos
// arquivos antigos, registro na auditoria por tenant, tolerância a falhas de I/O
// e o no-op quando não há PDFs expirados.
// -----------------------------------------------------------------------------

const AGORA = new Date('2026-06-15T03:00:00.000Z')
// Exatamente 1 ano antes de AGORA — a fronteira da retenção.
const UM_ANO_ANTES = new Date('2025-06-15T03:00:00.000Z')

function pdfExpirado(overrides?: Partial<PdfExpirado>): PdfExpirado {
  return {
    versaoId: 'versao-1',
    orcamentoId: 'orcamento-1',
    tenantId: 'tenant-1',
    numero: 'ORC-2024-0001',
    versao: 1,
    pdfPath: '/var/ni-doc/pdfs/ORC-2024-0001-v1.pdf',
    enviadoEm: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeRepo(overrides?: Partial<LimparPdfsRepositorio>): LimparPdfsRepositorio {
  return {
    listarPdfsExpirados: vi.fn().mockResolvedValue([]),
    limparReferenciaPdf: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makeFs(overrides?: Partial<LimparPdfsFileSystem>): LimparPdfsFileSystem {
  return {
    rm: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('criarLimparPdfsJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('consulta o repositório com a data-limite de 1 ano atrás', async () => {
    const repo = makeRepo()
    const job = criarLimparPdfsJob({
      repo,
      fs: makeFs(),
      agora: () => AGORA,
      logger: loggerSilencioso,
    })

    await job.executar()

    expect(repo.listarPdfsExpirados).toHaveBeenCalledOnce()
    const dataLimite = (repo.listarPdfsExpirados as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Date
    expect(dataLimite.getTime()).toBe(UM_ANO_ANTES.getTime())
  })

  it('remove do disco cada PDF expirado', async () => {
    const pdfs = [
      pdfExpirado({ versaoId: 'v1', pdfPath: '/pdfs/a.pdf' }),
      pdfExpirado({ versaoId: 'v2', pdfPath: '/pdfs/b.pdf' }),
    ]
    const fs = makeFs()
    const repo = makeRepo({ listarPdfsExpirados: vi.fn().mockResolvedValue(pdfs) })
    const job = criarLimparPdfsJob({ repo, fs, agora: () => AGORA, logger: loggerSilencioso })

    const resultado = await job.executar()

    expect(fs.rm).toHaveBeenCalledTimes(2)
    expect(fs.rm).toHaveBeenCalledWith('/pdfs/a.pdf')
    expect(fs.rm).toHaveBeenCalledWith('/pdfs/b.pdf')
    expect(resultado.removidos).toBe(2)
  })

  it('entrega a auditoria ao repositório (mesma transação da limpeza) com o tenant do orçamento', async () => {
    const pdf = pdfExpirado({
      tenantId: 'tenant-xyz',
      orcamentoId: 'orc-9',
      pdfPath: '/pdfs/x.pdf',
    })
    const repo = makeRepo({ listarPdfsExpirados: vi.fn().mockResolvedValue([pdf]) })
    const job = criarLimparPdfsJob({
      repo,
      fs: makeFs(),
      agora: () => AGORA,
      logger: loggerSilencioso,
    })

    await job.executar()

    expect(repo.limparReferenciaPdf).toHaveBeenCalledOnce()
    const evento = eventoAuditoriaDe(repo.limparReferenciaPdf as Mock)
    expect(evento).toMatchObject({
      tenantId: 'tenant-xyz',
      acao: 'limpar_pdf',
      entidade: 'orcamento_versoes',
      entidadeId: pdf.versaoId,
    })
  })

  it('limpa a referência pdf_path/pdf_hash no banco ANTES de remover o arquivo', async () => {
    const pdf = pdfExpirado({ versaoId: 'v-ref', pdfPath: '/pdfs/ref.pdf' })
    const repo = makeRepo({ listarPdfsExpirados: vi.fn().mockResolvedValue([pdf]) })
    const job = criarLimparPdfsJob({
      repo,
      fs: makeFs(),
      agora: () => AGORA,
      logger: loggerSilencioso,
    })

    await job.executar()

    expect(repo.limparReferenciaPdf).toHaveBeenCalledWith('v-ref', expect.any(Function))
  })

  it('não remove nada quando não há PDFs expirados', async () => {
    const fs = makeFs()
    const repo = makeRepo()
    const job = criarLimparPdfsJob({
      repo,
      fs,
      agora: () => AGORA,
      logger: loggerSilencioso,
    })

    const resultado = await job.executar()

    expect(fs.rm).not.toHaveBeenCalled()
    expect(repo.limparReferenciaPdf).not.toHaveBeenCalled()
    expect(resultado.removidos).toBe(0)
  })

  it('continua removendo os demais quando a exclusão de um arquivo falha', async () => {
    const pdfs = [
      pdfExpirado({ versaoId: 'ok1', pdfPath: '/pdfs/ok1.pdf' }),
      pdfExpirado({ versaoId: 'fail', pdfPath: '/pdfs/fail.pdf' }),
      pdfExpirado({ versaoId: 'ok2', pdfPath: '/pdfs/ok2.pdf' }),
    ]
    const fs = makeFs({
      rm: vi.fn(async (caminho: string) => {
        if (caminho === '/pdfs/fail.pdf') {
          throw new Error('EACCES')
        }
      }),
    })
    const repo = makeRepo({ listarPdfsExpirados: vi.fn().mockResolvedValue(pdfs) })
    const job = criarLimparPdfsJob({ repo, fs, agora: () => AGORA, logger: loggerSilencioso })

    const resultado = await job.executar()

    // Os dois arquivos saudáveis foram removidos; o que falhou é contabilizado.
    expect(resultado.removidos).toBe(2)
    expect(resultado.falhas).toBe(1)
    // O banco vai primeiro: as três referências foram limpas (com auditoria na
    // mesma transação); a que falhou no disco fica órfã e é logada.
    expect(repo.limparReferenciaPdf).toHaveBeenCalledTimes(3)
  })

  it('limpa o banco (referência + auditoria) ANTES de remover o arquivo do disco', async () => {
    const ordem: string[] = []
    const repo = makeRepo({
      listarPdfsExpirados: vi.fn().mockResolvedValue([pdfExpirado({ versaoId: 'v1' })]),
      limparReferenciaPdf: vi.fn(async () => {
        ordem.push('banco')
      }),
    })
    const fs = makeFs({
      rm: vi.fn(async () => {
        ordem.push('disco')
      }),
    })
    const job = criarLimparPdfsJob({ repo, fs, agora: () => AGORA, logger: loggerSilencioso })

    await job.executar()

    expect(ordem).toEqual(['banco', 'disco'])
  })

  it('se a transação do banco (referência + auditoria) falhar, NÃO apaga o arquivo e segue com os demais', async () => {
    const pdfs = [
      pdfExpirado({ versaoId: 'falha-banco', pdfPath: '/pdfs/falha.pdf' }),
      pdfExpirado({ versaoId: 'ok', pdfPath: '/pdfs/ok.pdf' }),
    ]
    const repo = makeRepo({
      listarPdfsExpirados: vi.fn().mockResolvedValue(pdfs),
      limparReferenciaPdf: vi.fn(async (versaoId: string) => {
        if (versaoId === 'falha-banco') throw new Error('falha ao gravar auditoria')
      }),
    })
    const fs = makeFs()
    const job = criarLimparPdfsJob({ repo, fs, agora: () => AGORA, logger: loggerSilencioso })

    const resultado = await job.executar()

    expect(fs.rm).not.toHaveBeenCalledWith('/pdfs/falha.pdf')
    expect(fs.rm).toHaveBeenCalledWith('/pdfs/ok.pdf')
    expect(resultado).toEqual({ removidos: 1, falhas: 1 })
  })

  it('ignora versões sem pdf_path (nada a remover)', async () => {
    const pdfs = [pdfExpirado({ versaoId: 'sem-pdf', pdfPath: null })]
    const fs = makeFs()
    const repo = makeRepo({ listarPdfsExpirados: vi.fn().mockResolvedValue(pdfs) })
    const job = criarLimparPdfsJob({ repo, fs, agora: () => AGORA, logger: loggerSilencioso })

    const resultado = await job.executar()

    expect(fs.rm).not.toHaveBeenCalled()
    expect(repo.limparReferenciaPdf).not.toHaveBeenCalled()
    expect(resultado.removidos).toBe(0)
  })
})
