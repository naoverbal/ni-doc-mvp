import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminPool,
  contarVersoes,
  corpoOrcamento,
  criarCenario,
  criarEnviado,
  criarRascunho,
  encerrarConexoes,
  limparDados,
  statusNoBanco,
  type Cenario,
  type OrcamentoCriado,
  type VersaoCriada,
} from './helpers.js'

// Acesso indevido: um usuário do tenant A tentando ler ou alterar dados do
// tenant B. O isolamento vem do RLS do Postgres (papel ni_doc_app, sem
// BYPASSRLS) somado ao filtro por tenant na aplicação; aqui os dois rodam de
// verdade. Convenção esperada: recurso de outro tenant "não existe" (404).

let a: Cenario
let b: Cenario
let rascunhoB: OrcamentoCriado
let enviadoB: { orcamento: OrcamentoCriado; versao: VersaoCriada }
let empresaB: { id: string }
let responsavelB: { id: string }

beforeAll(async () => {
  a = await criarCenario()
  b = await criarCenario()
  rascunhoB = await criarRascunho(b)
  enviadoB = await criarEnviado(b)

  const empresa = await request(b.app)
    .post('/api/empresas')
    .set('Cookie', b.cookieOperador)
    .send({ tipo: 'cliente_pj', razaoSocial: 'Razão Exclusiva do Tenant B Ltda' })
  expect(empresa.status).toBe(201)
  empresaB = empresa.body as { id: string }

  const responsavel = await request(b.app)
    .post('/api/responsaveis')
    .set('Cookie', b.cookieOperador)
    .send({ nome: 'Responsável Exclusivo do Tenant B' })
  expect(responsavel.status).toBe(201)
  responsavelB = responsavel.body as { id: string }
})

afterAll(async () => {
  await limparDados()
  await encerrarConexoes()
})

async function contarOrcamentos(tenantId: string): Promise<number> {
  const { rows } = await adminPool.query<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM orcamentos WHERE tenant_id = $1',
    [tenantId],
  )
  return Number(rows[0]?.n ?? 0)
}

describe('orçamentos de outro tenant', () => {
  it('quando o usuário do tenant A busca um orçamento do tenant B pelo id, então responde 404', async () => {
    const resposta = await request(a.app)
      .get(`/api/orcamentos/${rascunhoB.id}`)
      .set('Cookie', a.cookieOperador)

    expect(resposta.status).toBe(404)
    expect(JSON.stringify(resposta.body)).not.toContain(rascunhoB.numero)
  })

  it('quando o usuário do tenant A tenta editar um orçamento do tenant B, então responde 404 e o orçamento de B não muda', async () => {
    const resposta = await request(a.app)
      .put(`/api/orcamentos/${rascunhoB.id}`)
      .set('Cookie', a.cookieAdmin)
      .send({ titulo: 'Invadido', itens: [{ nome: 'X', quantidade: 1, valorUnitario: 1 }] })

    expect(resposta.status).toBe(404)
    const { rows } = await adminPool.query(
      'SELECT titulo, total::float AS total FROM orcamentos WHERE id = $1',
      [rascunhoB.id],
    )
    expect(rows[0]).toEqual({ titulo: rascunhoB.titulo, total: 200 })
  })

  it('quando o usuário do tenant A tenta excluir um orçamento do tenant B, então responde 404 e o orçamento continua existindo', async () => {
    const resposta = await request(a.app)
      .delete(`/api/orcamentos/${rascunhoB.id}`)
      .set('Cookie', a.cookieAdmin)

    expect(resposta.status).toBe(404)
    expect(await statusNoBanco(rascunhoB.id)).toBe('rascunho')
  })

  it('quando o usuário do tenant A tenta enviar um orçamento do tenant B, então responde 404 e nada é versionado', async () => {
    const alvo = await criarRascunho(b)

    const resposta = await request(a.app)
      .post(`/api/orcamentos/${alvo.id}/enviar`)
      .set('Cookie', a.cookieOperador)

    expect(resposta.status).toBe(404)
    expect(await statusNoBanco(alvo.id)).toBe('rascunho')
    expect(await contarVersoes(alvo.id)).toBe(0)
  })

  it('quando o usuário do tenant A tenta aceite manual em orçamento do tenant B, então responde 404 e o status de B não muda', async () => {
    const resposta = await request(a.app)
      .post(`/api/orcamentos/${enviadoB.orcamento.id}/aceite-manual`)
      .set('Cookie', a.cookieOperador)
      .send({ justificativa: 'Tentativa de invasão' })

    expect(resposta.status).toBe(404)
    expect(await statusNoBanco(enviadoB.orcamento.id)).toBe('enviado')
    const { rowCount } = await adminPool.query(
      'SELECT 1 FROM orcamento_aceites WHERE versao_id = $1',
      [enviadoB.versao.id],
    )
    expect(rowCount).toBe(0)
  })

  it('quando o usuário do tenant A lista orçamentos, então só aparecem os do tenant A', async () => {
    const meu = await criarRascunho(a)

    const resposta = await request(a.app).get('/api/orcamentos').set('Cookie', a.cookieOperador)

    expect(resposta.status).toBe(200)
    const ids = (resposta.body.itens as { id: string }[]).map((o) => o.id)
    expect(ids).toContain(meu.id)
    expect(ids).not.toContain(rascunhoB.id)
    expect(ids).not.toContain(enviadoB.orcamento.id)
  })

  it('quando o usuário do tenant A cria orçamento usando um cliente do tenant B, então responde 409 e nada é criado', async () => {
    const antes = await contarOrcamentos(a.tenant.id)

    const resposta = await request(a.app)
      .post('/api/orcamentos')
      .set('Cookie', a.cookieOperador)
      .send(corpoOrcamento(b.cliente.id))

    expect(resposta.status).toBe(409)
    expect(await contarOrcamentos(a.tenant.id)).toBe(antes)
  })

  it('quando o usuário do tenant A cria orçamento com item de responsável do tenant B, então responde 409 e nada é criado', async () => {
    const antes = await contarOrcamentos(a.tenant.id)

    const resposta = await request(a.app)
      .post('/api/orcamentos')
      .set('Cookie', a.cookieOperador)
      .send(
        corpoOrcamento(a.cliente.id, {
          itens: [
            { nome: 'Item', quantidade: 1, valorUnitario: 10, responsavelId: responsavelB.id },
          ],
        }),
      )

    expect(resposta.status).toBe(409)
    expect(await contarOrcamentos(a.tenant.id)).toBe(antes)
  })

  it('quando o usuário do tenant A cria orçamento com empresa-cliente do tenant B, então responde 409 e nada é criado', async () => {
    const antes = await contarOrcamentos(a.tenant.id)

    const resposta = await request(a.app)
      .post('/api/orcamentos')
      .set('Cookie', a.cookieOperador)
      .send(corpoOrcamento(a.cliente.id, { empresaClienteId: empresaB.id }))

    expect(resposta.status).toBe(409)
    expect(await contarOrcamentos(a.tenant.id)).toBe(antes)
  })
})

describe('clientes, empresas e responsáveis de outro tenant', () => {
  it('quando o tenant A busca ou edita um cliente do tenant B, então responde 404 e o cliente de B não muda', async () => {
    const ler = await request(a.app)
      .get(`/api/clientes/${b.cliente.id}`)
      .set('Cookie', a.cookieOperador)
    const editar = await request(a.app)
      .put(`/api/clientes/${b.cliente.id}`)
      .set('Cookie', a.cookieOperador)
      .send({ nome: 'Invadido' })

    expect(ler.status).toBe(404)
    expect(editar.status).toBe(404)
    const { rows } = await adminPool.query('SELECT nome FROM clientes WHERE id = $1', [
      b.cliente.id,
    ])
    expect(rows[0]?.nome).toBe(b.cliente.nome)
  })

  it('quando o tenant A busca clientes pelo nome de um cliente do tenant B, então a lista vem vazia', async () => {
    const resposta = await request(a.app)
      .get('/api/clientes')
      .query({ q: b.cliente.nome })
      .set('Cookie', a.cookieOperador)

    expect(resposta.status).toBe(200)
    expect(resposta.body).toEqual([])
  })

  it('quando o tenant A busca ou edita uma empresa do tenant B, então responde 404 e a empresa de B não muda', async () => {
    const ler = await request(a.app)
      .get(`/api/empresas/${empresaB.id}`)
      .set('Cookie', a.cookieOperador)
    const editar = await request(a.app)
      .put(`/api/empresas/${empresaB.id}`)
      .set('Cookie', a.cookieOperador)
      .send({ razaoSocial: 'Invadida' })

    expect(ler.status).toBe(404)
    expect(editar.status).toBe(404)
    const { rows } = await adminPool.query('SELECT razao_social FROM empresas WHERE id = $1', [
      empresaB.id,
    ])
    expect(rows[0]?.razao_social).toBe('Razão Exclusiva do Tenant B Ltda')
  })

  it('quando o tenant A busca empresas pela razão social de uma empresa do tenant B, então a lista vem vazia', async () => {
    const resposta = await request(a.app)
      .get('/api/empresas')
      .query({ q: 'Exclusiva do Tenant B' })
      .set('Cookie', a.cookieOperador)

    expect(resposta.status).toBe(200)
    expect(resposta.body).toEqual([])
  })

  it('quando o tenant A busca ou edita um responsável do tenant B, então responde 404 e o responsável de B não muda', async () => {
    const ler = await request(a.app)
      .get(`/api/responsaveis/${responsavelB.id}`)
      .set('Cookie', a.cookieOperador)
    const editar = await request(a.app)
      .put(`/api/responsaveis/${responsavelB.id}`)
      .set('Cookie', a.cookieOperador)
      .send({ nome: 'Invadido' })

    expect(ler.status).toBe(404)
    expect(editar.status).toBe(404)
    const { rows } = await adminPool.query('SELECT nome FROM responsaveis_tecnicos WHERE id = $1', [
      responsavelB.id,
    ])
    expect(rows[0]?.nome).toBe('Responsável Exclusivo do Tenant B')
  })

  it('quando o tenant A busca responsáveis pelo nome de um responsável do tenant B, então a lista vem vazia', async () => {
    const resposta = await request(a.app)
      .get('/api/responsaveis')
      .query({ q: 'Exclusivo do Tenant B' })
      .set('Cookie', a.cookieOperador)

    expect(resposta.status).toBe(200)
    expect(resposta.body).toEqual([])
  })
})

describe('mesmo tenant, outro usuário', () => {
  it('quando o operador e o admin do mesmo tenant acessam o mesmo orçamento, então ambos enxergam (o isolamento é por tenant)', async () => {
    const criado = await criarRascunho(a)

    const comoAdmin = await request(a.app)
      .get(`/api/orcamentos/${criado.id}`)
      .set('Cookie', a.cookieAdmin)

    expect(comoAdmin.status).toBe(200)
    expect(comoAdmin.body.id).toBe(criado.id)
  })
})
