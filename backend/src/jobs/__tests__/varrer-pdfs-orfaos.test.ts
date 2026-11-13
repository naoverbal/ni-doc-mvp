import { describe, it, expect, vi } from 'vitest'
import {
  criarVarrerPdfsOrfaosJob,
  type ArquivoNoDisco,
  type VarrerPdfsFileSystem,
  type VarrerPdfsRepositorio,
} from '../varrer-pdfs-orfaos.js'

// Job de varredura de PDFs órfãos, com disco e banco injetados (sem I/O real).

const AGORA = new Date('2026-06-15T12:00:00.000Z')
const TENANT = '11111111-1111-4111-8111-111111111111'
const OUTRO_TENANT = '22222222-2222-4222-8222-222222222222'
const HA_2_DIAS = new Date(AGORA.getTime() - 2 * 24 * 60 * 60 * 1000)
const HA_1_HORA = new Date(AGORA.getTime() - 60 * 60 * 1000)
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function arquivo(nome: string, modificadoEm = HA_2_DIAS, tenant = TENANT): ArquivoNoDisco {
  return { nome, caminho: `/pdfs/${tenant}/${nome}`, modificadoEm }
}

function montar(opts: {
  arquivos?: Record<string, ArquivoNoDisco[]>
  referenciados?: Record<string, string[]>
  tenantsNoBanco?: string[]
  rm?: VarrerPdfsFileSystem['rm']
  extra?: { limiteRemocoes?: number }
}) {
  const arquivos = opts.arquivos ?? { [TENANT]: [] }
  const ordem: string[] = []
  const fs: VarrerPdfsFileSystem = {
    listarDiretorios: vi.fn(async () => Object.keys(arquivos)),
    listarArquivos: vi.fn(async (tenantId: string) => {
      ordem.push('disco')
      return arquivos[tenantId] ?? []
    }),
    rm: vi.fn(opts.rm ?? (async () => undefined)),
  }
  const repo: VarrerPdfsRepositorio = {
    tenantExiste: vi.fn(async (tenantId: string) =>
      (opts.tenantsNoBanco ?? Object.keys(arquivos)).includes(tenantId),
    ),
    nomesReferenciados: vi.fn(async (tenantId: string) => {
      ordem.push('banco')
      return new Set(opts.referenciados?.[tenantId] ?? [])
    }),
  }
  const escopados: string[] = []
  const escopoTenant = async <T>(tenantId: string, fn: () => Promise<T>): Promise<T> => {
    escopados.push(tenantId)
    return fn()
  }
  const job = criarVarrerPdfsOrfaosJob({
    repo,
    fs,
    escopoTenant,
    agora: () => AGORA,
    logger,
    ...opts.extra,
  })
  return { job, fs, repo, escopados, ordem }
}

describe('criarVarrerPdfsOrfaosJob', () => {
  it('remove o PDF antigo sem referência e preserva o referenciado', async () => {
    const { job, fs } = montar({
      arquivos: { [TENANT]: [arquivo('ORC-1-v1.pdf'), arquivo('ORC-2-v1.pdf')] },
      referenciados: { [TENANT]: ['ORC-1-v1.pdf'] },
    })

    const resultado = await job.executar()

    expect(fs.rm).toHaveBeenCalledTimes(1)
    expect(fs.rm).toHaveBeenCalledWith(`/pdfs/${TENANT}/ORC-2-v1.pdf`)
    expect(resultado).toMatchObject({ analisados: 2, removidos: 1, falhas: 0 })
  })

  it('preserva arquivos recentes (carência), mesmo sem referência: podem ser de uma transação em andamento', async () => {
    const { job, fs, repo } = montar({
      arquivos: { [TENANT]: [arquivo('ORC-3-v1.pdf', HA_1_HORA)] },
    })

    const resultado = await job.executar()

    expect(fs.rm).not.toHaveBeenCalled()
    expect(repo.nomesReferenciados).not.toHaveBeenCalled()
    expect(resultado.removidos).toBe(0)
  })

  it('remove temporários .tmp antigos e ignora arquivos de outra extensão', async () => {
    const { job, fs } = montar({
      arquivos: {
        [TENANT]: [arquivo('ORC-4-v1.pdf.abc.tmp'), arquivo('README.txt'), arquivo('notas.docx')],
      },
    })

    await job.executar()

    expect(fs.rm).toHaveBeenCalledTimes(1)
    expect(fs.rm).toHaveBeenCalledWith(`/pdfs/${TENANT}/ORC-4-v1.pdf.abc.tmp`)
  })

  it('ignora diretórios cujo nome não é UUID', async () => {
    const { job, fs } = montar({
      arquivos: { lixo: [arquivo('ORC-5-v1.pdf', HA_2_DIAS, 'lixo')] },
    })

    await job.executar()

    expect(fs.listarArquivos).not.toHaveBeenCalled()
    expect(fs.rm).not.toHaveBeenCalled()
  })

  it('NÃO apaga nada quando o tenant do diretório não é encontrado no banco (proteção contra "zero referências" por falha)', async () => {
    const { job, fs, repo } = montar({
      arquivos: { [TENANT]: [arquivo('ORC-6-v1.pdf')] },
      tenantsNoBanco: [],
    })

    const resultado = await job.executar()

    expect(fs.rm).not.toHaveBeenCalled()
    expect(repo.nomesReferenciados).not.toHaveBeenCalled()
    expect(resultado.tenantsIgnorados).toBe(1)
  })

  it('lê o disco ANTES das referências do banco (arquivo commitado no meio já aparece como referenciado)', async () => {
    const { job, ordem } = montar({
      arquivos: { [TENANT]: [arquivo('ORC-7-v1.pdf')] },
    })

    await job.executar()

    expect(ordem).toEqual(['disco', 'banco'])
  })

  it('consulta o banco sob o escopo do tenant do diretório', async () => {
    const { job, escopados } = montar({
      arquivos: {
        [TENANT]: [arquivo('A-v1.pdf')],
        [OUTRO_TENANT]: [arquivo('B-v1.pdf', HA_2_DIAS, OUTRO_TENANT)],
      },
    })

    await job.executar()

    expect(escopados).toEqual([TENANT, OUTRO_TENANT])
  })

  it('não confunde tenants: a referência de um tenant não protege o arquivo homônimo de outro', async () => {
    const { job, fs } = montar({
      arquivos: {
        [TENANT]: [arquivo('ORC-1-v1.pdf')],
        [OUTRO_TENANT]: [arquivo('ORC-1-v1.pdf', HA_2_DIAS, OUTRO_TENANT)],
      },
      referenciados: { [TENANT]: ['ORC-1-v1.pdf'] },
    })

    await job.executar()

    expect(fs.rm).toHaveBeenCalledTimes(1)
    expect(fs.rm).toHaveBeenCalledWith(`/pdfs/${OUTRO_TENANT}/ORC-1-v1.pdf`)
  })

  it('respeita o teto de remoções por execução e sinaliza limiteAtingido', async () => {
    const { job, fs } = montar({
      arquivos: { [TENANT]: [1, 2, 3, 4, 5].map((n) => arquivo(`ORC-${n}-v1.pdf`)) },
      extra: { limiteRemocoes: 2 },
    })

    const resultado = await job.executar()

    expect(fs.rm).toHaveBeenCalledTimes(2)
    expect(resultado).toMatchObject({ removidos: 2, limiteAtingido: true })
  })

  it('contabiliza falha de remoção e segue com os demais', async () => {
    const { job, fs } = montar({
      arquivos: { [TENANT]: [arquivo('A-v1.pdf'), arquivo('B-v1.pdf')] },
      rm: async (caminho: string) => {
        if (caminho.endsWith('A-v1.pdf')) throw new Error('EACCES')
      },
    })

    const resultado = await job.executar()

    expect(fs.rm).toHaveBeenCalledTimes(2)
    expect(resultado).toMatchObject({ removidos: 1, falhas: 1 })
  })

  it('não faz nada quando PDFS_DIR não tem diretórios', async () => {
    const { job, fs } = montar({ arquivos: {} })

    const resultado = await job.executar()

    expect(fs.rm).not.toHaveBeenCalled()
    expect(resultado).toMatchObject({ analisados: 0, removidos: 0 })
  })
})
