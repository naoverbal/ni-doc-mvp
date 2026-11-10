import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminPool,
  criarCenario,
  criarEnviado,
  criarRascunho,
  encerrarConexoes,
  limparDados,
  novoApp,
  SENHA_PADRAO,
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

describe('GET /api/dashboard/enviados e /aprovados', () => {
  let s: Cenario

  const manual = (c: Cenario, id: string) =>
    request(c.app)
      .post(`/api/orcamentos/${id}/aceite-manual`)
      .set('Cookie', c.cookieOperador)
      .send({ justificativa: 'Aprovou por telefone' })

  const cancelar = (c: Cenario, id: string) =>
    request(c.app)
      .post(`/api/orcamentos/${id}/cancelar`)
      .set('Cookie', c.cookieOperador)
      .send({ senha: SENHA_PADRAO, justificativa: 'Cliente desistiu' })

  // Ajusta as datas direto no banco (papel privilegiado): a imutabilidade das
  // versões e dos aceites é por privilégio do papel de aplicação.
  async function datarEnvio(id: string, versao: number, quando: string): Promise<void> {
    await adminPool.query(
      'UPDATE orcamento_versoes SET enviado_em = $3 WHERE orcamento_id = $1 AND versao = $2',
      [id, versao, quando],
    )
  }

  async function datarAceite(id: string, versao: number, quando: string): Promise<void> {
    await adminPool.query(
      `UPDATE orcamento_aceites SET criado_em = $3
       WHERE versao_id = (SELECT id FROM orcamento_versoes WHERE orcamento_id = $1 AND versao = $2)`,
      [id, versao, quando],
    )
  }

  beforeAll(async () => {
    s = await criarCenario()

    // e1: enviado e ainda aguardando.
    const e1 = await criarEnviado(s)
    await datarEnvio(e1.orcamento.id, 1, '2025-03-10T15:00:00Z')

    // e2: enviado em março e cancelado depois.
    const e2 = await criarEnviado(s)
    expect((await cancelar(s, e2.orcamento.id)).status).toBe(200)
    await datarEnvio(e2.orcamento.id, 1, '2025-03-12T15:00:00Z')

    // e3: enviado em março, aprovado em abril.
    const e3 = await criarEnviado(s)
    expect((await manual(s, e3.orcamento.id)).status).toBe(201)
    await datarEnvio(e3.orcamento.id, 1, '2025-03-05T15:00:00Z')
    await datarAceite(e3.orcamento.id, 1, '2025-04-02T15:00:00Z')

    // e4: enviado em março, aprovado em abril e cancelado depois.
    const e4 = await criarEnviado(s)
    expect((await manual(s, e4.orcamento.id)).status).toBe(201)
    expect((await cancelar(s, e4.orcamento.id)).status).toBe(200)
    await datarEnvio(e4.orcamento.id, 1, '2025-03-20T15:00:00Z')
    await datarAceite(e4.orcamento.id, 1, '2025-04-10T15:00:00Z')

    // e5: rascunho, fora das duas séries.
    await criarRascunho(s)

    // e6: reprovado na v1, reaberto, reenviado (v2) e aprovado na v2. Conta uma
    // única vez, pela versão vigente.
    const e6 = await criarEnviado(s)
    const reprovacao = await request(await novoApp())
      .post(`/api/publico/orcamento/${e6.versao.tokenPublico}/reprovar`)
      .set('User-Agent', 'vitest-int')
      .send({})
    expect(reprovacao.status).toBe(201)
    const reabertura = await request(s.app)
      .post(`/api/orcamentos/${e6.orcamento.id}/reabrir`)
      .set('Cookie', s.cookieOperador)
      .send({ senha: SENHA_PADRAO, justificativa: 'Cliente pediu nova proposta' })
    expect(reabertura.status).toBe(200)
    const reenvio = await request(s.app)
      .post(`/api/orcamentos/${e6.orcamento.id}/enviar`)
      .set('Cookie', s.cookieOperador)
    expect(reenvio.status).toBe(201)
    expect((await manual(s, e6.orcamento.id)).status).toBe(201)
    await datarEnvio(e6.orcamento.id, 1, '2025-03-01T15:00:00Z')
    await datarAceite(e6.orcamento.id, 1, '2025-03-02T15:00:00Z')
    await datarEnvio(e6.orcamento.id, 2, '2025-03-25T15:00:00Z')
    await datarAceite(e6.orcamento.id, 2, '2025-04-20T15:00:00Z')
  })

  it('enviados: mantém no mês do envio o que foi cancelado depois e detalha pelo status atual', async () => {
    const resposta = await get(s, '/enviados?granularidade=mes')

    expect(resposta.status).toBe(200)
    const pontos = resposta.body as Array<{
      chave: string
      rotulo: string
      quantidade: number
      valor: number
      porStatus: Record<string, { quantidade: number; valor: number }>
    }>
    // e5 (rascunho) fica de fora; e6 conta uma vez (v2). Cada orçamento vale 200.
    expect(pontos).toHaveLength(1)
    expect(pontos[0]).toMatchObject({
      chave: '2025-03',
      rotulo: '03/2025',
      quantidade: 5,
      valor: 1000,
    })
    expect(pontos[0]?.porStatus['enviado']).toEqual({ quantidade: 1, valor: 200 })
    expect(pontos[0]?.porStatus['aprovado']).toEqual({ quantidade: 2, valor: 400 })
    expect(pontos[0]?.porStatus['cancelado']).toEqual({ quantidade: 2, valor: 400 })
    expect(pontos[0]?.porStatus['rascunho']).toEqual({ quantidade: 0, valor: 0 })
  })

  it('aprovados: mantém no mês da aprovação o aprovado cancelado depois e ignora a reprovação anterior', async () => {
    const resposta = await get(s, '/aprovados?granularidade=mes')

    expect(resposta.status).toBe(200)
    const pontos = resposta.body as Array<{
      chave: string
      quantidade: number
      valor: number
      porStatus: Record<string, { quantidade: number; valor: number }>
    }>
    // Só abril: a reprovação da v1 do e6 (março) não conta; e2 não tem aceite.
    expect(pontos).toHaveLength(1)
    expect(pontos[0]).toMatchObject({ chave: '2025-04', quantidade: 3, valor: 600 })
    expect(pontos[0]?.porStatus['aprovado']).toEqual({ quantidade: 2, valor: 400 })
    expect(pontos[0]?.porStatus['cancelado']).toEqual({ quantidade: 1, valor: 200 })
    expect(pontos[0]?.porStatus['reprovado']).toEqual({ quantidade: 0, valor: 0 })
  })

  it('filtra pelo intervalo da data do evento (envio / aceite)', async () => {
    const enviados = await get(s, '/enviados?de=2025-03-15&ate=2025-03-31')
    expect((enviados.body as Array<{ quantidade: number }>)[0]?.quantidade).toBe(2) // e4 e e6

    const aprovados = await get(s, '/aprovados?de=2025-04-05&ate=2025-04-30')
    expect((aprovados.body as Array<{ quantidade: number }>)[0]?.quantidade).toBe(2) // e4 e e6

    const vazio = await get(s, '/aprovados?de=2025-05-01&ate=2025-05-31')
    expect(vazio.body).toEqual([])
  })

  it('agrupa por semana ISO com rótulo AAAA-Sww', async () => {
    const resposta = await get(s, '/aprovados?granularidade=semana')

    const pontos = resposta.body as Array<{ chave: string; rotulo: string }>
    // 02/04 = W14, 10/04 = W15, 20/04 (domingo) = W16.
    expect(pontos.map((p) => p.chave)).toEqual(['2025-W14', '2025-W15', '2025-W16'])
    expect(pontos.map((p) => p.rotulo)).toEqual(['2025-S14', '2025-S15', '2025-S16'])
  })

  it('não enxerga dados de outro tenant', async () => {
    const outro = await criarCenario()

    expect((await get(outro, '/enviados')).body).toEqual([])
    expect((await get(outro, '/aprovados')).body).toEqual([])
  })

  it.each(['enviados', 'aprovados'])('%s: intervalo invertido responde 400', async (rota) => {
    const resposta = await get(s, `/${rota}?de=2025-05-01&ate=2025-04-01`)

    expect(resposta.status).toBe(400)
  })
})
