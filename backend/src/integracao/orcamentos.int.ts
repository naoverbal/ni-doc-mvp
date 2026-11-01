import { createHash, randomUUID } from 'node:crypto'
import { readFile, access } from 'node:fs/promises'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { emailsEnviados, estadoSmtp } from './espioes.js'
import {
  adminPool,
  contarVersoes,
  corpoOrcamento,
  criarCenario,
  criarCliente,
  criarEnviado,
  criarRascunho,
  criarTenant,
  criarUsuario,
  encerrarConexoes,
  entrar,
  limparDados,
  novoApp,
  statusNoBanco,
  type Cenario,
} from './helpers.js'

// Request specs do orçamento: o fluxo que mexe com valores. Rotas reais, banco
// real, RLS ativo. Só SMTP e Chromium são simulados (ver setup.ts).

let c: Cenario

beforeAll(async () => {
  c = await criarCenario()
})

afterAll(async () => {
  await limparDados()
  await encerrarConexoes()
})

async function contarOrcamentosDoTenant(tenantId: string): Promise<number> {
  const { rows } = await adminPool.query<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM orcamentos WHERE tenant_id = $1',
    [tenantId],
  )
  return Number(rows[0]?.n ?? 0)
}

describe('criar orçamento (POST /api/orcamentos)', () => {
  it('quando recebe cliente, título e ao menos um item, então responde 201, cria em rascunho e calcula subtotal/total no banco', async () => {
    const resposta = await request(c.app)
      .post('/api/orcamentos')
      .set('Cookie', c.cookieOperador)
      .send(corpoOrcamento(c.cliente.id))

    expect(resposta.status).toBe(201)
    expect(resposta.body.status).toBe('rascunho')
    expect(resposta.body.subtotal).toBe(200)
    expect(resposta.body.total).toBe(200)

    const { rows } = await adminPool.query(
      'SELECT status, subtotal::float AS subtotal, total::float AS total, usuario_id FROM orcamentos WHERE id = $1',
      [resposta.body.id],
    )
    expect(rows[0]).toMatchObject({
      status: 'rascunho',
      subtotal: 200,
      total: 200,
      usuario_id: c.operador.id,
    })
    const itens = await adminPool.query('SELECT 1 FROM orcamento_itens WHERE orcamento_id = $1', [
      resposta.body.id,
    ])
    expect(itens.rowCount).toBe(1)
  })

  it('quando aplica desconto por item e global, então o total persistido reflete o cálculo', async () => {
    // item 1: 3 x 100 com 10% = 270 | item 2: 1 x 50 com R$10 fixo = 40
    // subtotal 310 | desconto global fixo 10 => total 300
    const resposta = await request(c.app)
      .post('/api/orcamentos')
      .set('Cookie', c.cookieOperador)
      .send(
        corpoOrcamento(c.cliente.id, {
          itens: [
            {
              nome: 'Item com percentual',
              quantidade: 3,
              valorUnitario: 100,
              descontoTipo: 'percentual',
              descontoValor: 10,
            },
            {
              nome: 'Item com desconto fixo',
              quantidade: 1,
              valorUnitario: 50,
              descontoTipo: 'fixo',
              descontoValor: 10,
            },
          ],
          descontoGlobalTipo: 'fixo',
          descontoGlobalValor: 10,
        }),
      )

    expect(resposta.status).toBe(201)
    const { rows } = await adminPool.query(
      'SELECT subtotal::float AS subtotal, total::float AS total FROM orcamentos WHERE id = $1',
      [resposta.body.id],
    )
    expect(rows[0]).toEqual({ subtotal: 310, total: 300 })
  })

  it('quando o desconto global zera o total, então aceita e persiste total = 0', async () => {
    const resposta = await request(c.app)
      .post('/api/orcamentos')
      .set('Cookie', c.cookieOperador)
      .send(
        corpoOrcamento(c.cliente.id, {
          descontoGlobalTipo: 'percentual',
          descontoGlobalValor: 100,
        }),
      )

    expect(resposta.status).toBe(201)
    expect(resposta.body.total).toBe(0)
    const { rows } = await adminPool.query(
      'SELECT total::float AS total FROM orcamentos WHERE id = $1',
      [resposta.body.id],
    )
    expect(rows[0]?.total).toBe(0)
  })

  it('quando o desconto global é maior que o subtotal, então o total fica em 0 e nunca negativo', async () => {
    const resposta = await request(c.app)
      .post('/api/orcamentos')
      .set('Cookie', c.cookieOperador)
      .send(
        corpoOrcamento(c.cliente.id, { descontoGlobalTipo: 'fixo', descontoGlobalValor: 99999 }),
      )

    expect(resposta.status).toBe(201)
    expect(resposta.body.total).toBe(0)
  })

  it('quando um item tem valor unitário zero, então aceita e o total do orçamento é 0', async () => {
    const resposta = await request(c.app)
      .post('/api/orcamentos')
      .set('Cookie', c.cookieOperador)
      .send(
        corpoOrcamento(c.cliente.id, {
          itens: [{ nome: 'Cortesia', quantidade: 1, valorUnitario: 0 }],
        }),
      )

    expect(resposta.status).toBe(201)
    expect(resposta.body.total).toBe(0)
  })

  it('quando envia itens vazios, então responde 400 e não cria nada', async () => {
    const antes = await contarOrcamentosDoTenant(c.tenant.id)

    const resposta = await request(c.app)
      .post('/api/orcamentos')
      .set('Cookie', c.cookieOperador)
      .send(corpoOrcamento(c.cliente.id, { itens: [] }))

    expect(resposta.status).toBe(400)
    expect(await contarOrcamentosDoTenant(c.tenant.id)).toBe(antes)
  })

  it('quando falta clienteId ou título, então responde 400 e não cria nada', async () => {
    const antes = await contarOrcamentosDoTenant(c.tenant.id)
    const itens = [{ nome: 'A', quantidade: 1, valorUnitario: 10 }]

    const semCliente = await request(c.app)
      .post('/api/orcamentos')
      .set('Cookie', c.cookieOperador)
      .send({ titulo: 'Sem cliente', itens })
    const semTitulo = await request(c.app)
      .post('/api/orcamentos')
      .set('Cookie', c.cookieOperador)
      .send({ clienteId: c.cliente.id, itens })

    expect(semCliente.status).toBe(400)
    expect(semTitulo.status).toBe(400)
    expect(await contarOrcamentosDoTenant(c.tenant.id)).toBe(antes)
  })

  it('quando um item tem quantidade zero ou negativa, então responde 400', async () => {
    const enviar = (quantidade: number) =>
      request(c.app)
        .post('/api/orcamentos')
        .set('Cookie', c.cookieOperador)
        .send(
          corpoOrcamento(c.cliente.id, { itens: [{ nome: 'A', quantidade, valorUnitario: 10 }] }),
        )

    expect((await enviar(0)).status).toBe(400)
    expect((await enviar(-1)).status).toBe(400)
  })

  it('quando um item tem valor unitário negativo, então responde 400', async () => {
    const resposta = await request(c.app)
      .post('/api/orcamentos')
      .set('Cookie', c.cookieOperador)
      .send(
        corpoOrcamento(c.cliente.id, {
          itens: [{ nome: 'A', quantidade: 1, valorUnitario: -10 }],
        }),
      )

    expect(resposta.status).toBe(400)
  })

  it('quando a soma dos percentuais das condições de pagamento não é 100, então responde 400', async () => {
    const resposta = await request(c.app)
      .post('/api/orcamentos')
      .set('Cookie', c.cookieOperador)
      .send(
        corpoOrcamento(c.cliente.id, {
          condicoesPagamento: [
            { descricao: 'Entrada', percentual: 30, formaPagamento: 'PIX' },
            { descricao: 'Final', percentual: 50, formaPagamento: 'Boleto' },
          ],
        }),
      )

    expect(resposta.status).toBe(400)
  })

  it('quando a soma dos percentuais das condições de pagamento é 100, então responde 201', async () => {
    const resposta = await request(c.app)
      .post('/api/orcamentos')
      .set('Cookie', c.cookieOperador)
      .send(
        corpoOrcamento(c.cliente.id, {
          condicoesPagamento: [
            { descricao: 'Entrada', percentual: 40, formaPagamento: 'PIX' },
            { descricao: 'Final', percentual: 60, formaPagamento: 'Boleto' },
          ],
        }),
      )

    expect(resposta.status).toBe(201)
  })

  it('quando não está autenticado, então responde 401 e não cria nada', async () => {
    const antes = await contarOrcamentosDoTenant(c.tenant.id)

    const resposta = await request(c.app).post('/api/orcamentos').send(corpoOrcamento(c.cliente.id))

    expect(resposta.status).toBe(401)
    expect(await contarOrcamentosDoTenant(c.tenant.id)).toBe(antes)
  })

  it('quando dois orçamentos diferentes são criados ao mesmo tempo, então ambos respondem 201 com números distintos', async () => {
    const [a, b] = await Promise.all([
      request(c.app)
        .post('/api/orcamentos')
        .set('Cookie', c.cookieOperador)
        .send(corpoOrcamento(c.cliente.id)),
      request(c.app)
        .post('/api/orcamentos')
        .set('Cookie', c.cookieOperador)
        .send(corpoOrcamento(c.cliente.id)),
    ])

    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(a.body.numero).not.toBe(b.body.numero)
  })
})

// Regra: um mesmo usuário não cria o mesmo orçamento duas vezes. "Mesmo
// orçamento" = mesmo cliente, mesmo título e mesmos itens (conteúdo idêntico).
describe('orçamento duplicado (POST /api/orcamentos)', () => {
  async function contarIguais(cenario: Cenario, titulo: string): Promise<number> {
    const { rows } = await adminPool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM orcamentos
       WHERE tenant_id = $1 AND usuario_id = $2 AND cliente_id = $3 AND titulo = $4`,
      [cenario.tenant.id, cenario.operador.id, cenario.cliente.id, titulo],
    )
    return Number(rows[0]?.n ?? 0)
  }

  it('quando o mesmo usuário cria duas vezes o mesmo orçamento em sequência, então a segunda responde 409 e existe um só', async () => {
    const cenario = await criarCenario()
    const corpo = corpoOrcamento(cenario.cliente.id)
    const criar = () =>
      request(cenario.app).post('/api/orcamentos').set('Cookie', cenario.cookieOperador).send(corpo)

    const primeira = await criar()
    const segunda = await criar()

    expect(primeira.status).toBe(201)
    expect(segunda.status).toBe(409)
    expect(await contarIguais(cenario, corpo['titulo'] as string)).toBe(1)
  })

  it('quando o mesmo usuário envia o mesmo orçamento duas vezes ao mesmo tempo (clique duplo), então só um é criado e o outro responde 409', async () => {
    const cenario = await criarCenario()
    const corpo = corpoOrcamento(cenario.cliente.id)
    const criar = () =>
      request(cenario.app).post('/api/orcamentos').set('Cookie', cenario.cookieOperador).send(corpo)

    const [a, b] = await Promise.all([criar(), criar()])

    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect(await contarIguais(cenario, corpo['titulo'] as string)).toBe(1)
  })

  it('quando o mesmo usuário cria um orçamento com outro título, então responde 201', async () => {
    const cenario = await criarCenario()
    const primeiro = await criarRascunho(cenario)

    const segundo = await request(cenario.app)
      .post('/api/orcamentos')
      .set('Cookie', cenario.cookieOperador)
      .send(corpoOrcamento(cenario.cliente.id))

    expect(primeiro.titulo).not.toBe(segundo.body.titulo)
    expect(segundo.status).toBe(201)
  })

  it('quando outro usuário do mesmo tenant cria um orçamento com o mesmo conteúdo, então responde 201 (a regra é por usuário)', async () => {
    const cenario = await criarCenario()
    const corpo = corpoOrcamento(cenario.cliente.id)
    const doOperador = await request(cenario.app)
      .post('/api/orcamentos')
      .set('Cookie', cenario.cookieOperador)
      .send(corpo)

    const doAdmin = await request(cenario.app)
      .post('/api/orcamentos')
      .set('Cookie', cenario.cookieAdmin)
      .send(corpo)

    expect(doOperador.status).toBe(201)
    expect(doAdmin.status).toBe(201)
  })
})

describe('listar e buscar orçamentos', () => {
  it('quando lista com ?status=enviado, então só vêm os enviados do tenant', async () => {
    const cenario = await criarCenario()
    const rascunho = await criarRascunho(cenario)
    const { orcamento: enviado } = await criarEnviado(cenario)

    const resposta = await request(cenario.app)
      .get('/api/orcamentos')
      .query({ status: 'enviado' })
      .set('Cookie', cenario.cookieOperador)

    expect(resposta.status).toBe(200)
    const ids = (resposta.body.itens as { id: string; status: string }[]).map((o) => o.id)
    expect(ids).toContain(enviado.id)
    expect(ids).not.toContain(rascunho.id)
    expect((resposta.body.itens as { status: string }[]).every((o) => o.status === 'enviado')).toBe(
      true,
    )
  })

  it('quando lista com status fora da lista, então responde 400', async () => {
    const resposta = await request(c.app)
      .get('/api/orcamentos')
      .query({ status: 'xpto' })
      .set('Cookie', c.cookieOperador)

    expect(resposta.status).toBe(400)
  })

  it('quando lista com página inválida, então responde 400', async () => {
    const zero = await request(c.app)
      .get('/api/orcamentos')
      .query({ pagina: '0' })
      .set('Cookie', c.cookieOperador)
    const texto = await request(c.app)
      .get('/api/orcamentos')
      .query({ pagina: 'abc' })
      .set('Cookie', c.cookieOperador)

    expect(zero.status).toBe(400)
    expect(texto.status).toBe(400)
  })

  it('quando busca um orçamento do próprio tenant, então responde 200 com os itens', async () => {
    const criado = await criarRascunho(c)

    const resposta = await request(c.app)
      .get(`/api/orcamentos/${criado.id}`)
      .set('Cookie', c.cookieOperador)

    expect(resposta.status).toBe(200)
    expect(resposta.body.id).toBe(criado.id)
    expect(resposta.body.itens).toHaveLength(1)
  })

  it('quando o id não existe, então responde 404', async () => {
    const resposta = await request(c.app)
      .get(`/api/orcamentos/${randomUUID()}`)
      .set('Cookie', c.cookieOperador)

    expect(resposta.status).toBe(404)
  })

  it('quando o id é malformado, então responde 400', async () => {
    const resposta = await request(c.app)
      .get('/api/orcamentos/isto-nao-e-um-uuid')
      .set('Cookie', c.cookieOperador)

    expect(resposta.status).toBe(400)
  })
})

describe('editar e excluir orçamento (PUT/DELETE /api/orcamentos/:id)', () => {
  it('quando edita um rascunho, então responde 200 e persiste os novos itens e o novo total', async () => {
    const criado = await criarRascunho(c)

    const resposta = await request(c.app)
      .put(`/api/orcamentos/${criado.id}`)
      .set('Cookie', c.cookieOperador)
      .send({
        titulo: 'Título novo',
        itens: [
          { nome: 'Novo A', quantidade: 1, valorUnitario: 500 },
          { nome: 'Novo B', quantidade: 2, valorUnitario: 25 },
        ],
      })

    expect(resposta.status).toBe(200)
    const { rows } = await adminPool.query(
      'SELECT titulo, total::float AS total FROM orcamentos WHERE id = $1',
      [criado.id],
    )
    expect(rows[0]).toEqual({ titulo: 'Título novo', total: 550 })
    const itens = await adminPool.query(
      'SELECT nome FROM orcamento_itens WHERE orcamento_id = $1 ORDER BY ordem',
      [criado.id],
    )
    expect(itens.rows.map((r) => r.nome)).toEqual(['Novo A', 'Novo B'])
  })

  it('quando edita com itens vazios, então responde 400 e o orçamento não muda', async () => {
    const criado = await criarRascunho(c)

    const resposta = await request(c.app)
      .put(`/api/orcamentos/${criado.id}`)
      .set('Cookie', c.cookieOperador)
      .send({ itens: [] })

    expect(resposta.status).toBe(400)
    const { rows } = await adminPool.query(
      'SELECT total::float AS total FROM orcamentos WHERE id = $1',
      [criado.id],
    )
    expect(rows[0]?.total).toBe(200)
  })

  it('quando tenta editar um orçamento já enviado, então responde 409 e nada muda', async () => {
    const cenario = await criarCenario()
    const { orcamento } = await criarEnviado(cenario)

    const resposta = await request(cenario.app)
      .put(`/api/orcamentos/${orcamento.id}`)
      .set('Cookie', cenario.cookieOperador)
      .send({ titulo: 'Tentativa', itens: [{ nome: 'X', quantidade: 1, valorUnitario: 1 }] })

    expect(resposta.status).toBe(409)
    const { rows } = await adminPool.query(
      'SELECT titulo, total::float AS total FROM orcamentos WHERE id = $1',
      [orcamento.id],
    )
    expect(rows[0]).toEqual({ titulo: orcamento.titulo, total: 200 })
  })

  it('quando exclui um rascunho, então responde 204 e o orçamento some do banco', async () => {
    const criado = await criarRascunho(c)

    const resposta = await request(c.app)
      .delete(`/api/orcamentos/${criado.id}`)
      .set('Cookie', c.cookieOperador)

    expect(resposta.status).toBe(204)
    expect(await statusNoBanco(criado.id)).toBeUndefined()
  })

  it('quando tenta excluir um orçamento já enviado, então responde 409 e ele continua no banco', async () => {
    const cenario = await criarCenario()
    const { orcamento } = await criarEnviado(cenario)

    const resposta = await request(cenario.app)
      .delete(`/api/orcamentos/${orcamento.id}`)
      .set('Cookie', cenario.cookieOperador)

    expect(resposta.status).toBe(409)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
  })

  it('quando o id não existe, então editar e excluir respondem 404', async () => {
    const id = randomUUID()

    const editar = await request(c.app)
      .put(`/api/orcamentos/${id}`)
      .set('Cookie', c.cookieOperador)
      .send({ itens: [{ nome: 'X', quantidade: 1, valorUnitario: 1 }] })
    const excluir = await request(c.app)
      .delete(`/api/orcamentos/${id}`)
      .set('Cookie', c.cookieOperador)

    expect(editar.status).toBe(404)
    expect(excluir.status).toBe(404)
  })

  it('quando exclui o mesmo rascunho duas vezes seguidas, então a segunda responde 404', async () => {
    const criado = await criarRascunho(c)

    const primeira = await request(c.app)
      .delete(`/api/orcamentos/${criado.id}`)
      .set('Cookie', c.cookieOperador)
    const segunda = await request(c.app)
      .delete(`/api/orcamentos/${criado.id}`)
      .set('Cookie', c.cookieOperador)

    expect(primeira.status).toBe(204)
    expect(segunda.status).toBe(404)
  })

  it('quando duas exclusões do mesmo rascunho chegam ao mesmo tempo, então nenhuma responde erro de servidor', async () => {
    const criado = await criarRascunho(c)

    const [a, b] = await Promise.all([
      request(c.app).delete(`/api/orcamentos/${criado.id}`).set('Cookie', c.cookieOperador),
      request(c.app).delete(`/api/orcamentos/${criado.id}`).set('Cookie', c.cookieOperador),
    ])

    expect(a.status).toBeLessThan(500)
    expect(b.status).toBeLessThan(500)
    expect([a.status, b.status]).toContain(204)
    expect(await statusNoBanco(criado.id)).toBeUndefined()
  })
})

describe('enviar orçamento (POST /api/orcamentos/:id/enviar)', () => {
  it('quando envia um rascunho válido com template ativo, então responde 201, cria a versão 1, gera o PDF e muda o status para enviado', async () => {
    const cenario = await criarCenario()
    const rascunho = await criarRascunho(cenario)

    const resposta = await request(cenario.app)
      .post(`/api/orcamentos/${rascunho.id}/enviar`)
      .set('Cookie', cenario.cookieOperador)

    expect(resposta.status).toBe(201)
    expect(resposta.body.versao).toBe(1)
    expect(resposta.body.tokenPublico).toEqual(expect.any(String))
    expect(resposta.body.pdfHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await statusNoBanco(rascunho.id)).toBe('enviado')
    const { rows } = await adminPool.query('SELECT versao_atual FROM orcamentos WHERE id = $1', [
      rascunho.id,
    ])
    expect(rows[0]?.versao_atual).toBe(1)
  })

  it('quando o orçamento é enviado, então o pdf_hash gravado é o SHA-256 do arquivo PDF em disco', async () => {
    const cenario = await criarCenario()
    const { versao } = await criarEnviado(cenario)

    const { rows } = await adminPool.query<{ pdf_path: string; pdf_hash: string }>(
      'SELECT pdf_path, pdf_hash FROM orcamento_versoes WHERE id = $1',
      [versao.id],
    )
    const caminho = rows[0]?.pdf_path ?? ''
    await access(caminho)
    const bytes = await readFile(caminho)
    expect(rows[0]?.pdf_hash).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('quando o orçamento é enviado e o cliente tem e-mail, então o cliente é notificado com o link público', async () => {
    const cenario = await criarCenario()
    const { versao } = await criarEnviado(cenario)

    expect(emailsEnviados).toHaveLength(1)
    expect(emailsEnviados[0]?.to).toBe('cliente@exemplo.com')
    const conteudo = `${emailsEnviados[0]?.text ?? ''}${emailsEnviados[0]?.html ?? ''}`
    expect(conteudo).toContain(versao.tokenPublico)
  })

  it('quando o SMTP está indisponível, então o envio ainda responde 201 e o orçamento fica enviado', async () => {
    const cenario = await criarCenario()
    const rascunho = await criarRascunho(cenario)
    estadoSmtp.falhar = true

    const resposta = await request(cenario.app)
      .post(`/api/orcamentos/${rascunho.id}/enviar`)
      .set('Cookie', cenario.cookieOperador)

    expect(resposta.status).toBe(201)
    expect(await statusNoBanco(rascunho.id)).toBe('enviado')
  })

  it('quando o tenant não tem template ativo, então responde 409 e nada é persistido', async () => {
    const tenant = await criarTenant({ comTemplate: false })
    const operador = await criarUsuario(tenant.id, 'operador')
    const cliente = await criarCliente(tenant.id)
    const cookie = await entrar(operador)
    const app = await novoApp()
    const criado = await request(app)
      .post('/api/orcamentos')
      .set('Cookie', cookie)
      .send(corpoOrcamento(cliente.id))
    expect(criado.status).toBe(201)

    const resposta = await request(app)
      .post(`/api/orcamentos/${criado.body.id}/enviar`)
      .set('Cookie', cookie)

    expect(resposta.status).toBe(409)
    expect(await statusNoBanco(criado.body.id)).toBe('rascunho')
    expect(await contarVersoes(criado.body.id)).toBe(0)
  })

  it('quando o rascunho não tem itens, então responde 400 e nada é persistido', async () => {
    const cenario = await criarCenario()
    const id = randomUUID()
    await adminPool.query(
      `INSERT INTO orcamentos (id, tenant_id, numero, cliente_id, usuario_id, titulo)
       VALUES ($1, $2, $3, $4, $5, 'Sem itens')`,
      [
        id,
        cenario.tenant.id,
        `SEM-ITENS-${id.slice(0, 8)}`,
        cenario.cliente.id,
        cenario.operador.id,
      ],
    )

    const resposta = await request(cenario.app)
      .post(`/api/orcamentos/${id}/enviar`)
      .set('Cookie', cenario.cookieOperador)

    expect(resposta.status).toBe(400)
    expect(await statusNoBanco(id)).toBe('rascunho')
    expect(await contarVersoes(id)).toBe(0)
  })

  it('quando o orçamento não existe, então responde 404', async () => {
    const resposta = await request(c.app)
      .post(`/api/orcamentos/${randomUUID()}/enviar`)
      .set('Cookie', c.cookieOperador)

    expect(resposta.status).toBe(404)
  })

  it('quando não está autenticado, então responde 401 e não envia', async () => {
    const cenario = await criarCenario()
    const rascunho = await criarRascunho(cenario)

    const resposta = await request(cenario.app).post(`/api/orcamentos/${rascunho.id}/enviar`)

    expect(resposta.status).toBe(401)
    expect(await statusNoBanco(rascunho.id)).toBe('rascunho')
  })

  it('quando envia o mesmo rascunho duas vezes em sequência, então a segunda responde 409 e existe uma só versão', async () => {
    const cenario = await criarCenario()
    const rascunho = await criarRascunho(cenario)
    const enviar = () =>
      request(cenario.app)
        .post(`/api/orcamentos/${rascunho.id}/enviar`)
        .set('Cookie', cenario.cookieOperador)

    const primeira = await enviar()
    const segunda = await enviar()

    expect(primeira.status).toBe(201)
    expect(segunda.status).toBe(409)
    expect(await contarVersoes(rascunho.id)).toBe(1)
  })

  it('quando dois envios do mesmo rascunho chegam ao mesmo tempo, então só um cria versão e o outro responde 409', async () => {
    const cenario = await criarCenario()
    const rascunho = await criarRascunho(cenario)
    const enviar = () =>
      request(cenario.app)
        .post(`/api/orcamentos/${rascunho.id}/enviar`)
        .set('Cookie', cenario.cookieOperador)

    const [a, b] = await Promise.all([enviar(), enviar()])

    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect(await contarVersoes(rascunho.id)).toBe(1)
    expect(await statusNoBanco(rascunho.id)).toBe('enviado')
  })
})
