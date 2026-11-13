import { createHash } from 'node:crypto'
import { access, mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { db, executarComTenant } from '../config/database.js'
import { criarLimparPdfsJob, criarLimparPdfsRepositorio } from '../jobs/limpar-pdfs.js'
import {
  criarVarrerPdfsFileSystem,
  criarVarrerPdfsOrfaosJob,
  criarVarrerPdfsRepositorio,
  type VarrerPdfsFileSystem,
} from '../jobs/varrer-pdfs-orfaos.js'
import { PDFS_DIR_TESTE } from './config-banco.js'
import {
  adminPool,
  criarCenario,
  criarEnviado,
  encerrarConexoes,
  limparDados,
  novoApp,
} from './helpers.js'

// -----------------------------------------------------------------------------
// Ciclo de vida dos PDFs fora da transação: comprovante do aceite (referência
// gravada no banco), varredor de órfãos e limpeza por retenção. Os jobs rodam
// com o papel de APLICAÇÃO (RLS ativo), como em produção.
// -----------------------------------------------------------------------------

afterAll(async () => {
  await limparDados()
  await encerrarConexoes()
})

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const existe = (caminho: string) =>
  access(caminho).then(
    () => true,
    () => false,
  )
const HA_2_DIAS = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
const loggerMudo = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

async function envelhecer(caminho: string, quando = HA_2_DIAS): Promise<void> {
  await utimes(caminho, quando, quando)
}

async function plantar(tenantId: string, nome: string, antigo: boolean): Promise<string> {
  const dir = join(PDFS_DIR_TESTE, tenantId)
  await mkdir(dir, { recursive: true })
  const caminho = join(dir, nome)
  await writeFile(caminho, '%PDF-1.4 plantado pelo teste')
  if (antigo) await envelhecer(caminho)
  return caminho
}

async function aprovarPeloCliente(token: string) {
  return request(await novoApp())
    .post(`/api/publico/orcamento/${token}/aprovar`)
    .set('User-Agent', 'Agente-de-Teste/1.0')
}

interface LinhaAceite {
  comprovante_pdf_path: string | null
  comprovante_pdf_hash: string | null
}
const aceiteDaVersao = async (versaoId: string): Promise<LinhaAceite | undefined> => {
  const { rows } = await adminPool.query<LinhaAceite>(
    'SELECT comprovante_pdf_path, comprovante_pdf_hash FROM orcamento_aceites WHERE versao_id = $1',
    [versaoId],
  )
  return rows[0]
}

describe('comprovante do aceite — referência gravada no banco', () => {
  it('quando o cliente aprova, então caminho e hash do comprovante ficam gravados no aceite e batem com o arquivo em disco', async () => {
    const c = await criarCenario()
    const { versao } = await criarEnviado(c)

    const resposta = await aprovarPeloCliente(versao.tokenPublico)

    expect(resposta.status).toBe(201)
    const aceite = await aceiteDaVersao(versao.id)
    expect(aceite?.comprovante_pdf_path).toBeTruthy()
    expect(await existe(aceite?.comprovante_pdf_path ?? '')).toBe(true)
    expect(aceite?.comprovante_pdf_hash).toBe(resposta.body.comprovantePdfHash)
    expect(aceite?.comprovante_pdf_hash).toBe(
      sha256(await readFile(aceite?.comprovante_pdf_path ?? '')),
    )
  })

  it('quando o cliente reprova, então não há comprovante nem referência', async () => {
    const c = await criarCenario()
    const { versao } = await criarEnviado(c)

    const resposta = await request(await novoApp())
      .post(`/api/publico/orcamento/${versao.tokenPublico}/reprovar`)
      .send({})

    expect(resposta.status).toBe(201)
    expect(await aceiteDaVersao(versao.id)).toEqual({
      comprovante_pdf_path: null,
      comprovante_pdf_hash: null,
    })
  })

  it('quando alguém tenta trocar o comprovante já gravado, então o banco recusa (grava uma vez)', async () => {
    const c = await criarCenario()
    const { versao } = await criarEnviado(c)
    await aprovarPeloCliente(versao.tokenPublico)

    await expect(
      adminPool.query(
        `UPDATE orcamento_aceites SET comprovante_pdf_path = '/outro.pdf' WHERE versao_id = $1`,
        [versao.id],
      ),
    ).rejects.toThrow(/imutável/)
    await expect(
      adminPool.query(
        `UPDATE orcamento_aceites SET comprovante_pdf_path = NULL, comprovante_pdf_hash = NULL WHERE versao_id = $1`,
        [versao.id],
      ),
    ).rejects.toThrow(/imutável/)
  })
})

describe('varredor de PDFs órfãos (banco + disco reais, papel de aplicação com RLS)', () => {
  function varredorRestritoA(tenantIds: string[]) {
    const real = criarVarrerPdfsFileSystem(PDFS_DIR_TESTE)
    // Hermético: o diretório de PDFs de teste é compartilhado com outros arquivos.
    const fs: VarrerPdfsFileSystem = {
      ...real,
      listarDiretorios: async () =>
        (await real.listarDiretorios()).filter((d) => tenantIds.includes(d)),
    }
    return criarVarrerPdfsOrfaosJob({
      repo: criarVarrerPdfsRepositorio(db),
      fs,
      escopoTenant: executarComTenant,
      logger: loggerMudo,
    })
  }

  it('remove órfãos antigos e temporários; preserva PDF de versão, comprovante, arquivo recente e PDF cuja referência foi zerada só se recente', async () => {
    const c = await criarCenario()
    const { orcamento, versao } = await criarEnviado(c)
    await aprovarPeloCliente(versao.tokenPublico)
    const { rows } = await adminPool.query<{ pdf_path: string; comprovante_pdf_path: string }>(
      `SELECT v.pdf_path, a.comprovante_pdf_path FROM orcamento_versoes v
       JOIN orcamento_aceites a ON a.versao_id = v.id WHERE v.id = $1`,
      [versao.id],
    )
    const pdfDaVersao = rows[0]?.pdf_path ?? ''
    const comprovante = rows[0]?.comprovante_pdf_path ?? ''
    // Referenciados, porém antigos: NÃO podem ser apagados.
    await envelhecer(pdfDaVersao)
    await envelhecer(comprovante)

    const orfaoAntigo = await plantar(c.tenant.id, 'ORC-FANTASMA-v1.pdf', true)
    const temporarioAntigo = await plantar(c.tenant.id, 'ORC-FANTASMA-v2.pdf.abc123.tmp', true)
    const orfaoRecente = await plantar(c.tenant.id, 'ORC-RECENTE-v1.pdf', false)

    const resultado = await varredorRestritoA([c.tenant.id]).executar()

    expect(resultado).toMatchObject({ removidos: 2, falhas: 0, tenantsIgnorados: 0 })
    expect(await existe(orfaoAntigo)).toBe(false)
    expect(await existe(temporarioAntigo)).toBe(false)
    expect(await existe(orfaoRecente)).toBe(true)
    expect(await existe(pdfDaVersao)).toBe(true)
    expect(await existe(comprovante)).toBe(true)
    expect(orcamento.id).toBeTruthy()
  })

  it('quando a referência do PDF foi zerada no banco (retenção) e o arquivo ficou no disco, então o varredor o recolhe', async () => {
    const c = await criarCenario()
    const { versao } = await criarEnviado(c)
    const { rows } = await adminPool.query<{ pdf_path: string }>(
      'SELECT pdf_path FROM orcamento_versoes WHERE id = $1',
      [versao.id],
    )
    const caminho = rows[0]?.pdf_path ?? ''
    await envelhecer(caminho)
    await adminPool.query(
      'UPDATE orcamento_versoes SET pdf_path = NULL, pdf_hash = NULL WHERE id = $1',
      [versao.id],
    )

    const resultado = await varredorRestritoA([c.tenant.id]).executar()

    expect(resultado.removidos).toBe(1)
    expect(await existe(caminho)).toBe(false)
  })

  it('quando o diretório pertence a um tenant que o banco não encontra, então NADA é apagado e o diretório é ignorado', async () => {
    const c = await criarCenario()
    const tenantFantasma = '99999999-9999-4999-8999-999999999999'
    const arquivo = await plantar(tenantFantasma, 'ORC-9-v1.pdf', true)

    const resultado = await varredorRestritoA([c.tenant.id, tenantFantasma]).executar()

    expect(resultado.tenantsIgnorados).toBe(1)
    expect(resultado.removidos).toBe(0)
    expect(await existe(arquivo)).toBe(true)
  })

  it('o RLS vale para o varredor: um tenant nunca "protege" nem expõe o arquivo de outro', async () => {
    const a = await criarCenario()
    const b = await criarCenario()
    const { versao: versaoA } = await criarEnviado(a)
    const { rows } = await adminPool.query<{ pdf_path: string }>(
      'SELECT pdf_path FROM orcamento_versoes WHERE id = $1',
      [versaoA.id],
    )
    const pdfDeA = rows[0]?.pdf_path ?? ''
    const nomeDeA = pdfDeA.split('/').pop() ?? ''
    await envelhecer(pdfDeA)
    // Mesmo nome de arquivo no diretório do tenant B, sem nenhuma versão lá.
    const homonimoEmB = await plantar(b.tenant.id, nomeDeA, true)

    await varredorRestritoA([a.tenant.id, b.tenant.id]).executar()

    expect(await existe(pdfDeA)).toBe(true)
    expect(await existe(homonimoEmB)).toBe(false)
  })
})

describe('limpeza de PDFs por retenção (papel de aplicação com RLS)', () => {
  it('quando a versão passou da retenção, então o job a enxerga apesar do RLS, zera a referência, audita e só então apaga o arquivo', async () => {
    const c = await criarCenario()
    const { versao } = await criarEnviado(c)
    const { rows: antes } = await adminPool.query<{ pdf_path: string }>(
      'SELECT pdf_path FROM orcamento_versoes WHERE id = $1',
      [versao.id],
    )
    const caminho = antes[0]?.pdf_path ?? ''
    expect(await existe(caminho)).toBe(true)

    const repoReal = criarLimparPdfsRepositorio(db)
    const job = criarLimparPdfsJob({
      // Restringe ao tenant do teste (a listagem real é cross-tenant).
      repo: {
        ...repoReal,
        listarPdfsExpirados: async (limite) =>
          (await repoReal.listarPdfsExpirados(limite)).filter((p) => p.tenantId === c.tenant.id),
      },
      fs: {
        rm: (caminhoArquivo) =>
          import('node:fs/promises').then((m) => m.rm(caminhoArquivo, { force: true })),
      },
      escopoTenant: executarComTenant,
      // "Agora" daqui a 2 anos: a versão recém-enviada passa a ter mais de 1 ano.
      agora: () => new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
      logger: loggerMudo,
    })

    const resultado = await job.executar()

    expect(resultado).toEqual({ removidos: 1, falhas: 0 })
    const { rows: depois } = await adminPool.query<{
      pdf_path: string | null
      pdf_hash: string | null
    }>('SELECT pdf_path, pdf_hash FROM orcamento_versoes WHERE id = $1', [versao.id])
    expect(depois[0]).toEqual({ pdf_path: null, pdf_hash: null })
    expect(await existe(caminho)).toBe(false)
    const { rows: auditoria } = await adminPool.query(
      `SELECT 1 FROM eventos_auditoria WHERE tenant_id = $1 AND acao = 'limpar_pdf' AND entidade_id = $2`,
      [c.tenant.id, versao.id],
    )
    expect(auditoria).toHaveLength(1)
  })
})
