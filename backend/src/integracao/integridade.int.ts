import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminPool,
  corpoOrcamento,
  criarCenario,
  criarRascunho,
  encerrarConexoes,
  limparDados,
  type Cenario,
} from './helpers.js'

// Integridade de entrada: ids malformados nas rotas /:id (sempre 400, nunca 500)
// e referências cruzadas entre tenants na edição (PUT) de orçamentos.

let a: Cenario
let b: Cenario
let empresaB: { id: string }
let responsavelB: { id: string }

beforeAll(async () => {
  a = await criarCenario()
  b = await criarCenario()

  const empresa = await request(b.app)
    .post('/api/empresas')
    .set('Cookie', b.cookieOperador)
    .send({ tipo: 'cliente_pj', razaoSocial: 'Empresa do Tenant B Ltda' })
  expect(empresa.status).toBe(201)
  empresaB = empresa.body as { id: string }

  const responsavel = await request(b.app)
    .post('/api/responsaveis')
    .set('Cookie', b.cookieOperador)
    .send({ nome: 'Responsável do Tenant B' })
  expect(responsavel.status).toBe(201)
  responsavelB = responsavel.body as { id: string }
})

afterAll(async () => {
  await limparDados()
  await encerrarConexoes()
})

const ID_MALFORMADO = 'isto-nao-e-um-uuid'

describe('id malformado nas rotas /:id', () => {
  it('quando o id de cliente é malformado, então GET e PUT respondem 400', async () => {
    const ler = await request(a.app)
      .get(`/api/clientes/${ID_MALFORMADO}`)
      .set('Cookie', a.cookieOperador)
    const editar = await request(a.app)
      .put(`/api/clientes/${ID_MALFORMADO}`)
      .set('Cookie', a.cookieOperador)
      .send({ nome: 'Novo nome' })

    expect(ler.status).toBe(400)
    expect(editar.status).toBe(400)
  })

  it('quando o id de empresa é malformado, então GET e PUT respondem 400', async () => {
    const ler = await request(a.app)
      .get(`/api/empresas/${ID_MALFORMADO}`)
      .set('Cookie', a.cookieOperador)
    const editar = await request(a.app)
      .put(`/api/empresas/${ID_MALFORMADO}`)
      .set('Cookie', a.cookieOperador)
      .send({ razaoSocial: 'Nova razão' })

    expect(ler.status).toBe(400)
    expect(editar.status).toBe(400)
  })

  it('quando o id de responsável é malformado, então GET e PUT respondem 400', async () => {
    const ler = await request(a.app)
      .get(`/api/responsaveis/${ID_MALFORMADO}`)
      .set('Cookie', a.cookieOperador)
    const editar = await request(a.app)
      .put(`/api/responsaveis/${ID_MALFORMADO}`)
      .set('Cookie', a.cookieOperador)
      .send({ nome: 'Novo nome' })

    expect(ler.status).toBe(400)
    expect(editar.status).toBe(400)
  })

  it('quando o id de orçamento é malformado, então PUT, DELETE, enviar e aceite manual respondem 400', async () => {
    const base = `/api/orcamentos/${ID_MALFORMADO}`
    const itens = [{ nome: 'X', quantidade: 1, valorUnitario: 1 }]

    const editar = await request(a.app)
      .put(base)
      .set('Cookie', a.cookieOperador)
      .send({ titulo: 'Novo', itens })
    const excluir = await request(a.app).delete(base).set('Cookie', a.cookieOperador)
    const enviar = await request(a.app).post(`${base}/enviar`).set('Cookie', a.cookieOperador)
    const aceite = await request(a.app)
      .post(`${base}/aceite-manual`)
      .set('Cookie', a.cookieOperador)
      .send({ justificativa: 'Aceite por telefone' })

    expect([editar.status, excluir.status, enviar.status, aceite.status]).toEqual([
      400, 400, 400, 400,
    ])
  })
})

describe('PUT /api/orcamentos/:id com referência de outro tenant', () => {
  const itens = [{ nome: 'Item', quantidade: 1, valorUnitario: 10 }]

  async function tituloNoBanco(id: string): Promise<string | undefined> {
    const { rows } = await adminPool.query<{ titulo: string }>(
      'SELECT titulo FROM orcamentos WHERE id = $1',
      [id],
    )
    return rows[0]?.titulo
  }

  it('quando o PUT usa um cliente do tenant B, então responde 409 e o orçamento não muda', async () => {
    const rascunho = await criarRascunho(a)

    const resposta = await request(a.app)
      .put(`/api/orcamentos/${rascunho.id}`)
      .set('Cookie', a.cookieOperador)
      .send({ clienteId: b.cliente.id, titulo: 'Alterado', itens })

    expect(resposta.status).toBe(409)
    expect(await tituloNoBanco(rascunho.id)).toBe(rascunho.titulo)
  })

  it('quando o PUT usa uma empresa-cliente do tenant B, então responde 409 e o orçamento não muda', async () => {
    const rascunho = await criarRascunho(a)

    const resposta = await request(a.app)
      .put(`/api/orcamentos/${rascunho.id}`)
      .set('Cookie', a.cookieOperador)
      .send({ empresaClienteId: empresaB.id, titulo: 'Alterado', itens })

    expect(resposta.status).toBe(409)
    expect(await tituloNoBanco(rascunho.id)).toBe(rascunho.titulo)
  })

  it('quando o PUT usa item com responsável do tenant B, então responde 409 e os itens não mudam', async () => {
    const rascunho = await criarRascunho(a)

    const resposta = await request(a.app)
      .put(`/api/orcamentos/${rascunho.id}`)
      .set('Cookie', a.cookieOperador)
      .send({
        titulo: 'Alterado',
        itens: [{ nome: 'Item', quantidade: 1, valorUnitario: 10, responsavelId: responsavelB.id }],
      })

    expect(resposta.status).toBe(409)
    expect(await tituloNoBanco(rascunho.id)).toBe(rascunho.titulo)
    const { rows } = await adminPool.query(
      'SELECT 1 FROM orcamento_itens WHERE orcamento_id = $1 AND responsavel_id IS NOT NULL',
      [rascunho.id],
    )
    expect(rows).toHaveLength(0)
  })

  it('quando o PUT usa referências do próprio tenant, então responde 200', async () => {
    const rascunho = await criarRascunho(a)

    const resposta = await request(a.app)
      .put(`/api/orcamentos/${rascunho.id}`)
      .set('Cookie', a.cookieOperador)
      .send({ clienteId: a.cliente.id, titulo: 'Alterado', itens })

    expect(resposta.status).toBe(200)
  })
})

describe('defesa no banco contra referência de outro tenant', () => {
  it('quando um INSERT direto referencia um cliente de outro tenant, então o banco rejeita', async () => {
    const corpo = corpoOrcamento(a.cliente.id)
    const insercao = adminPool.query(
      `INSERT INTO orcamentos (tenant_id, numero, cliente_id, usuario_id, titulo)
       VALUES ($1, $2, $3, $4, $5)`,
      [a.tenant.id, `ORC-9999-${Date.now() % 10000}`, b.cliente.id, a.operador.id, corpo['titulo']],
    )

    await expect(insercao).rejects.toThrow(/outro tenant/i)
  })
})
