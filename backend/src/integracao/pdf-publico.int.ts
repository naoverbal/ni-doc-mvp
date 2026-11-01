import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import request, { type Test } from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PDFS_DIR_TESTE } from './config-banco.js'
import {
  adminPool,
  criarCenario,
  criarEnviado,
  encerrarConexoes,
  limparDados,
  novoApp,
  tokenDesconhecido,
} from './helpers.js'

// Rotas públicas de documento (achado B-11): PDF oficial da versão e comprovante
// de aceite, ambas autenticadas só pelo token (uuid.hmac) do link do cliente.
// Rotas reais, banco real, disco real; só o Chromium é simulado (setup.ts).

afterAll(async () => {
  await limparDados()
  await encerrarConexoes()
})

// App novo por chamada: o rate limit das rotas públicas é por instância.
// `ajustar` permite configurar a requisição antes de enviá-la (ex.: ler o corpo
// binário com `responseType('blob')`), já que o atalho devolve uma Promise.
type Ajuste = (requisicao: Test) => Test
const semAjuste: Ajuste = (requisicao) => requisicao
const pdf = async (token: string, ajustar: Ajuste = semAjuste) =>
  ajustar(request(await novoApp()).get(`/api/publico/orcamento/${token}/pdf`))
const comprovante = async (token: string, ajustar: Ajuste = semAjuste) =>
  ajustar(request(await novoApp()).get(`/api/publico/orcamento/${token}/comprovante`))
const aprovar = async (token: string) =>
  request(await novoApp()).post(`/api/publico/orcamento/${token}/aprovar`)

async function bytesNoDisco(
  tenantId: string,
  numero: string,
  versao: number,
  sufixo = '',
): Promise<Buffer> {
  return readFile(join(PDFS_DIR_TESTE, tenantId, `${numero}${sufixo}-v${versao}.pdf`))
}

function bytesDaResposta(corpo: unknown): Buffer {
  return Buffer.isBuffer(corpo) ? corpo : Buffer.from(corpo as ArrayBuffer)
}

describe('PDF público (GET /api/publico/orcamento/:token/pdf)', () => {
  let tenantId: string
  let numero: string
  let token: string

  beforeAll(async () => {
    const c = await criarCenario()
    const { orcamento, versao } = await criarEnviado(c)
    tenantId = c.tenant.id
    numero = orcamento.numero
    token = versao.tokenPublico
  })

  it('quando o token é válido e a versão tem PDF, então responde 200 com application/pdf, os bytes do documento e Cache-Control private, no-store', async () => {
    const resposta = await pdf(token, (t) => t.responseType('blob'))
    expect(resposta.status).toBe(200)
    expect(resposta.headers['content-type']).toMatch(/^application\/pdf/)
    expect(resposta.headers['cache-control']).toBe('private, no-store')
    expect(resposta.headers['content-disposition']).toMatch(/^inline;/)
    expect(bytesDaResposta(resposta.body).equals(await bytesNoDisco(tenantId, numero, 1))).toBe(
      true,
    )
  })

  it('quando o token é desconhecido, então responde 404', async () => {
    expect((await pdf(tokenDesconhecido())).status).toBe(404)
  })

  it('quando o HMAC do token foi adulterado, então responde 404', async () => {
    const adulterado = `${token.split('.')[0]}.${'0'.repeat(64)}`
    expect((await pdf(adulterado)).status).toBe(404)
  })

  it('quando o token está expirado, então responde 410', async () => {
    const c = await criarCenario()
    const { versao } = await criarEnviado(c)
    await adminPool.query(
      `UPDATE orcamento_versoes SET expira_em = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [versao.id],
    )
    expect((await pdf(versao.tokenPublico)).status).toBe(410)
  })

  it('quando a versão não tem PDF (removido pelo job de limpeza), então responde 404', async () => {
    const c = await criarCenario()
    const { versao } = await criarEnviado(c)
    await adminPool.query(
      'UPDATE orcamento_versoes SET pdf_path = NULL, pdf_hash = NULL WHERE id = $1',
      [versao.id],
    )
    expect((await pdf(versao.tokenPublico)).status).toBe(404)
  })

  it('quando dois tenants têm orçamentos com o mesmo número, então cada token devolve o PDF do próprio tenant', async () => {
    const a = await criarCenario()
    const b = await criarCenario()
    const enviadoA = await criarEnviado(a, {
      titulo: 'Proposta exclusiva do tenant A',
      itens: [{ nome: 'Item confidencial A', quantidade: 1, valorUnitario: 111 }],
    })
    const enviadoB = await criarEnviado(b, {
      titulo: 'Proposta exclusiva do tenant B',
      itens: [{ nome: 'Item confidencial B', quantidade: 1, valorUnitario: 222 }],
    })
    expect(enviadoA.orcamento.numero).toBe(enviadoB.orcamento.numero)

    const respA = await pdf(enviadoA.versao.tokenPublico, (t) => t.responseType('blob'))
    const respB = await pdf(enviadoB.versao.tokenPublico, (t) => t.responseType('blob'))

    expect(respA.status).toBe(200)
    expect(respB.status).toBe(200)
    expect(bytesDaResposta(respA.body).equals(bytesDaResposta(respB.body))).toBe(false)
  })

  it('quando a rota recebe mais de 60 acessos em 15 minutos do mesmo IP, então responde 429', async () => {
    const app = await novoApp()
    let ultimo = 0
    for (let i = 0; i < 61; i++) {
      ultimo = (await request(app).get(`/api/publico/orcamento/${tokenDesconhecido()}/pdf`)).status
    }
    expect(ultimo).toBe(429)
  })
})

describe('comprovante público (GET /api/publico/orcamento/:token/comprovante)', () => {
  it('quando o cliente aprovou, então responde 200 com application/pdf e os bytes do comprovante', async () => {
    const c = await criarCenario()
    const { orcamento, versao } = await criarEnviado(c)
    expect((await aprovar(versao.tokenPublico)).status).toBe(201)

    const resposta = await comprovante(versao.tokenPublico, (t) => t.responseType('blob'))

    expect(resposta.status).toBe(200)
    expect(resposta.headers['content-type']).toMatch(/^application\/pdf/)
    expect(resposta.headers['cache-control']).toBe('private, no-store')
    const esperado = await bytesNoDisco(c.tenant.id, orcamento.numero, 1, '-aceite')
    expect(bytesDaResposta(resposta.body).equals(esperado)).toBe(true)
  })

  it('quando o orçamento ainda não foi aprovado, então responde 404', async () => {
    const c = await criarCenario()
    const { versao } = await criarEnviado(c)
    expect((await comprovante(versao.tokenPublico)).status).toBe(404)
  })

  it('quando o token é desconhecido, então responde 404', async () => {
    expect((await comprovante(tokenDesconhecido())).status).toBe(404)
  })

  it('quando o HMAC do token foi adulterado, então responde 404', async () => {
    const c = await criarCenario()
    const { versao } = await criarEnviado(c)
    await aprovar(versao.tokenPublico)
    const adulterado = `${versao.tokenPublico.split('.')[0]}.${'0'.repeat(64)}`
    expect((await comprovante(adulterado)).status).toBe(404)
  })

  it('quando o cliente aprova, então a resposta traz comprovanteUrl apontando para a rota pública e nenhum caminho de disco', async () => {
    const c = await criarCenario()
    const { versao } = await criarEnviado(c)

    const resposta = await aprovar(versao.tokenPublico)

    expect(resposta.status).toBe(201)
    expect(resposta.body.comprovanteUrl).toBe(
      `/api/publico/orcamento/${versao.tokenPublico}/comprovante`,
    )
  })

  it('quando o cliente reprova, então comprovanteUrl é nulo', async () => {
    const c = await criarCenario()
    const { versao } = await criarEnviado(c)
    const resposta = await request(await novoApp())
      .post(`/api/publico/orcamento/${versao.tokenPublico}/reprovar`)
      .send({})
    expect(resposta.status).toBe(201)
    expect(resposta.body.comprovanteUrl).toBeNull()
  })
})
