import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminPool,
  criarCenario,
  criarEnviado,
  encerrarConexoes,
  limparDados,
  type Cenario,
} from './helpers.js'

// Permissão por papel: só admin altera o template do tenant. O template é global
// por tenant (MVP), então a alteração também não pode atravessar tenants.

let a: Cenario
let b: Cenario

const layoutNovo = {
  formato: 'A4',
  orientacao: 'paisagem',
  secoes: [{ tipo: 'cabecalho' }, { tipo: 'itens' }],
}

beforeAll(async () => {
  a = await criarCenario()
  b = await criarCenario()
})

afterAll(async () => {
  await limparDados()
  await encerrarConexoes()
})

async function versoesDoTemplate(tenantId: string): Promise<number> {
  const { rows } = await adminPool.query<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM templates WHERE tenant_id = $1',
    [tenantId],
  )
  return Number(rows[0]?.n ?? 0)
}

describe('template (GET/PUT /api/templates/atual)', () => {
  it('quando qualquer usuário do tenant lê o template atual, então responde 200', async () => {
    const operador = await request(a.app)
      .get('/api/templates/atual')
      .set('Cookie', a.cookieOperador)
    const admin = await request(a.app).get('/api/templates/atual').set('Cookie', a.cookieAdmin)

    expect(operador.status).toBe(200)
    expect(admin.status).toBe(200)
  })

  it('quando um admin salva o template, então responde 200 e persiste uma nova versão', async () => {
    const antes = await versoesDoTemplate(a.tenant.id)

    const resposta = await request(a.app)
      .put('/api/templates/atual')
      .set('Cookie', a.cookieAdmin)
      .send({ layoutJson: layoutNovo })

    expect(resposta.status).toBe(200)
    expect(await versoesDoTemplate(a.tenant.id)).toBe(antes + 1)
    const { rows } = await adminPool.query(
      `SELECT t.layout_json FROM tenants_template_ativo ta
       JOIN templates t ON t.id = ta.template_id WHERE ta.tenant_id = $1`,
      [a.tenant.id],
    )
    expect(rows[0]?.layout_json).toEqual(layoutNovo)
  })

  it('quando um operador tenta salvar o template, então responde 403 e nada é persistido', async () => {
    const antes = await versoesDoTemplate(a.tenant.id)

    const resposta = await request(a.app)
      .put('/api/templates/atual')
      .set('Cookie', a.cookieOperador)
      .send({ layoutJson: layoutNovo })

    expect(resposta.status).toBe(403)
    expect(await versoesDoTemplate(a.tenant.id)).toBe(antes)
  })

  it('quando um operador envia corpo inválido, então responde 403 (o papel é checado antes do corpo)', async () => {
    const resposta = await request(a.app)
      .put('/api/templates/atual')
      .set('Cookie', a.cookieOperador)
      .send({ layoutJson: 'isto-nao-e-um-objeto' })

    expect(resposta.status).toBe(403)
  })

  it('quando um admin envia corpo inválido, então responde 400 e nada é persistido', async () => {
    const antes = await versoesDoTemplate(a.tenant.id)

    const resposta = await request(a.app)
      .put('/api/templates/atual')
      .set('Cookie', a.cookieAdmin)
      .send({ layoutJson: 'isto-nao-e-um-objeto' })

    expect(resposta.status).toBe(400)
    expect(await versoesDoTemplate(a.tenant.id)).toBe(antes)
  })

  it('quando não está autenticado, então ler e salvar o template respondem 401', async () => {
    const ler = await request(a.app).get('/api/templates/atual')
    const salvar = await request(a.app).put('/api/templates/atual').send({ layoutJson: layoutNovo })

    expect(ler.status).toBe(401)
    expect(salvar.status).toBe(401)
  })

  it('quando o admin do tenant A salva o template, então o template do tenant B não muda', async () => {
    const antesB = await versoesDoTemplate(b.tenant.id)
    const ativoAntes = await adminPool.query(
      'SELECT template_id FROM tenants_template_ativo WHERE tenant_id = $1',
      [b.tenant.id],
    )

    await request(a.app)
      .put('/api/templates/atual')
      .set('Cookie', a.cookieAdmin)
      .send({ layoutJson: layoutNovo })

    expect(await versoesDoTemplate(b.tenant.id)).toBe(antesB)
    const ativoDepois = await adminPool.query(
      'SELECT template_id FROM tenants_template_ativo WHERE tenant_id = $1',
      [b.tenant.id],
    )
    expect(ativoDepois.rows[0]?.template_id).toBe(ativoAntes.rows[0]?.template_id)
  })

  it('quando um orçamento já enviado existe e o admin troca o template, então a versão enviada continua apontando para o template antigo', async () => {
    const { versao } = await criarEnviado(a)
    const antes = await adminPool.query<{ template_id: string }>(
      'SELECT template_id FROM orcamento_versoes WHERE id = $1',
      [versao.id],
    )

    await request(a.app)
      .put('/api/templates/atual')
      .set('Cookie', a.cookieAdmin)
      .send({ layoutJson: { ...layoutNovo, formato: 'A3' } })

    const depois = await adminPool.query<{ template_id: string }>(
      'SELECT template_id FROM orcamento_versoes WHERE id = $1',
      [versao.id],
    )
    expect(depois.rows[0]?.template_id).toBe(antes.rows[0]?.template_id)
  })
})
