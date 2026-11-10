import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminPool,
  criarCenario,
  criarEnviado,
  criarRascunho,
  encerrarConexoes,
  limparDados,
  type Cenario,
} from './helpers.js'

// Rotas /api/dashboard contra o Postgres real (papel de aplicação, RLS ativo):
// valida o SQL das agregações, o fuso America/Sao_Paulo e o isolamento por tenant.

let a: Cenario
let b: Cenario
let primeiroEnviadoA: string
let segundoEnviadoA: string

// Cada orçamento tem 2 x R$ 100 = R$ 200 (ver `corpoOrcamento`).
beforeAll(async () => {
  a = await criarCenario()
  b = await criarCenario()

  await criarRascunho(a)
  primeiroEnviadoA = (await criarEnviado(a)).orcamento.id
  segundoEnviadoA = (await criarEnviado(a)).orcamento.id

  const aprovado = await criarEnviado(a)
  const aceite = await request(a.app)
    .post(`/api/orcamentos/${aprovado.orcamento.id}/aceite-manual`)
    .set('Cookie', a.cookieOperador)
    .send({ justificativa: 'Aprovou por telefone' })
  expect(aceite.status).toBe(201)

  // Tenant B: um enviado, que NÃO pode aparecer para A.
  await criarEnviado(b)
})

afterAll(async () => {
  await limparDados()
  await encerrarConexoes()
})

const get = (c: Cenario, caminho: string) =>
  request(c.app).get(`/api/dashboard${caminho}`).set('Cookie', c.cookieOperador)

describe('GET /api/dashboard/resumo', () => {
  it('quando há orçamentos em vários status, então agrega contagem e valor pelo status atual', async () => {
    const resposta = await get(a, '/resumo')

    expect(resposta.status).toBe(200)
    expect(resposta.body.porStatus.rascunho).toEqual({ quantidade: 1, valor: 200 })
    expect(resposta.body.porStatus.enviado).toEqual({ quantidade: 2, valor: 400 })
    expect(resposta.body.porStatus.aprovado).toEqual({ quantidade: 1, valor: 200 })
    expect(resposta.body.porStatus.reprovado).toEqual({ quantidade: 0, valor: 0 })
    expect(resposta.body.valorEmAberto).toBe(400)
    expect(resposta.body.valorEnviado).toBe(600)
    expect(resposta.body.valorAprovado).toBe(200)
    expect(resposta.body.taxaConversao).toBeCloseTo(1 / 3)
  })

  it('quando outro tenant tem orçamentos, então o resumo considera só o tenant do usuário', async () => {
    const resposta = await get(b, '/resumo')

    expect(resposta.status).toBe(200)
    expect(resposta.body.porStatus.enviado).toEqual({ quantidade: 1, valor: 200 })
    expect(resposta.body.porStatus.rascunho.quantidade).toBe(0)
    expect(resposta.body.taxaConversao).toBe(0)
  })

  it('quando não há sessão, então responde 401', async () => {
    const resposta = await request(a.app).get('/api/dashboard/resumo')

    expect(resposta.status).toBe(401)
  })
})

describe('GET /api/dashboard/recentes', () => {
  it('quando há orçamentos, então vêm do mais novo ao mais antigo com o nome do cliente', async () => {
    const resposta = await get(a, '/recentes?limite=3')

    expect(resposta.status).toBe(200)
    const itens = resposta.body as Array<{
      status: string
      clienteNome: string
      criadoEm: string
    }>
    expect(itens).toHaveLength(3)
    expect(itens[0]?.status).toBe('aprovado')
    expect(itens.every((i) => i.clienteNome === a.cliente.nome)).toBe(true)
    const datas = itens.map((i) => Date.parse(i.criadoEm))
    expect(datas).toEqual([...datas].sort((x, y) => y - x))
  })
})

describe('GET /api/dashboard/pendentes', () => {
  it('quando há enviados, então lista só enviado, do envio mais antigo ao mais novo, com dias aguardando', async () => {
    const resposta = await get(a, '/pendentes')

    expect(resposta.status).toBe(200)
    const itens = resposta.body as Array<{
      id: string
      status: string
      diasAguardando: number
      enviadoEm: string
    }>
    expect(itens.map((i) => i.id)).toEqual([primeiroEnviadoA, segundoEnviadoA])
    expect(itens.every((i) => i.status === 'enviado')).toBe(true)
    expect(itens[0]?.diasAguardando).toBe(0)
    expect(itens[0]?.enviadoEm).toBeTruthy()
  })

  it('quando o limite é menor que o total, então respeita o limite', async () => {
    const resposta = await get(a, '/pendentes?limite=1')

    expect(resposta.status).toBe(200)
    expect((resposta.body as unknown[]).length).toBe(1)
  })
})

describe('GET /api/dashboard/criados', () => {
  let t: Cenario

  beforeAll(async () => {
    t = await criarCenario()
    const r1 = await criarRascunho(t)
    const r2 = await criarRascunho(t)
    const r3 = await criarRascunho(t)
    // 01:00 UTC de 01/03 = 22:00 de 28/02 em São Paulo (cai em fevereiro).
    const datas: Array<[string, string]> = [
      [r1.id, '2025-03-01T01:00:00Z'],
      [r2.id, '2025-03-15T12:00:00Z'],
      [r3.id, '2025-03-20T12:00:00Z'],
    ]
    for (const [id, quando] of datas) {
      await adminPool.query('UPDATE orcamentos SET criado_em = $2 WHERE id = $1', [id, quando])
    }
  })

  it('quando agrupa por mês, então usa o fuso de São Paulo e rótulos MM/AAAA', async () => {
    const resposta = await get(t, '/criados?granularidade=mes')

    expect(resposta.status).toBe(200)
    expect(resposta.body).toEqual([
      { chave: '2025-02', rotulo: '02/2025', quantidade: 1 },
      { chave: '2025-03', rotulo: '03/2025', quantidade: 2 },
    ])
  })

  it('quando agrupa por semana, então usa semana ISO com rótulo AAAA-Sww', async () => {
    const resposta = await get(t, '/criados?granularidade=semana')

    expect(resposta.body).toEqual([
      { chave: '2025-W09', rotulo: '2025-S09', quantidade: 1 },
      { chave: '2025-W11', rotulo: '2025-S11', quantidade: 1 },
      { chave: '2025-W12', rotulo: '2025-S12', quantidade: 1 },
    ])
  })

  it('quando agrupa por ano, então soma tudo no ano', async () => {
    const resposta = await get(t, '/criados?granularidade=ano')

    expect(resposta.body).toEqual([{ chave: '2025', rotulo: '2025', quantidade: 3 }])
  })

  it('quando informa o intervalo, então filtra pela data civil de São Paulo (inclusiva)', async () => {
    const marco = await get(t, '/criados?de=2025-03-01&ate=2025-03-31')
    expect(marco.body).toEqual([{ chave: '2025-03', rotulo: '03/2025', quantidade: 2 }])

    // O último dia do intervalo entra por inteiro.
    const ateDia15 = await get(t, '/criados?de=2025-03-01&ate=2025-03-15')
    expect(ateDia15.body).toEqual([{ chave: '2025-03', rotulo: '03/2025', quantidade: 1 }])

    const fevereiro = await get(t, '/criados?de=2025-02-28&ate=2025-02-28')
    expect(fevereiro.body).toEqual([{ chave: '2025-02', rotulo: '02/2025', quantidade: 1 }])
  })

  it('quando o intervalo está invertido, então responde 400', async () => {
    const resposta = await get(t, '/criados?de=2025-05-01&ate=2025-04-01')

    expect(resposta.status).toBe(400)
  })

  it('quando outro tenant consulta, então não enxerga os orçamentos deste', async () => {
    const resposta = await get(a, '/criados?granularidade=ano&de=2025-01-01&ate=2025-12-31')

    expect(resposta.status).toBe(200)
    expect(resposta.body).toEqual([])
  })
})
