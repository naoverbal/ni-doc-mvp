import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminPool,
  criarTenant,
  criarUsuario,
  encerrarConexoes,
  entrar,
  limparDados,
  novoApp,
  type UsuarioCriado,
} from './helpers.js'

// Request specs de autenticação: rotas reais, banco real, RLS ativo.

let operador: UsuarioCriado

beforeAll(async () => {
  const tenant = await criarTenant()
  operador = await criarUsuario(tenant.id, 'operador')
})

afterAll(async () => {
  await limparDados()
  await encerrarConexoes()
})

function cookieDaSessao(cookies: string[]): string {
  const sessao = cookies.find((c) => c.startsWith('session='))
  expect(sessao).toBeDefined()
  return sessao ?? ''
}

describe('POST /api/auth/login', () => {
  it('quando recebe email e senha corretos, então responde 200, devolve o usuário e grava o cookie de sessão httpOnly', async () => {
    const resposta = await request(await novoApp())
      .post('/api/auth/login')
      .send({ email: operador.email, senha: operador.senha })

    expect(resposta.status).toBe(200)
    expect(resposta.body.usuario).toEqual({
      id: operador.id,
      nome: operador.nome,
      papel: 'operador',
    })
    const cookies = resposta.headers['set-cookie'] as unknown as string[]
    const sessao = cookieDaSessao(cookies)
    expect(sessao).toMatch(/HttpOnly/i)

    const idSessao = sessao.split(';')[0]?.replace('session=', '')
    const { rows } = await adminPool.query('SELECT usuario_id FROM sessoes WHERE id = $1', [
      idSessao,
    ])
    expect(rows[0]?.usuario_id).toBe(operador.id)
  })

  it('quando o login dá certo, então registra o evento de auditoria "login" do usuário', async () => {
    await entrar(operador)

    const { rows } = await adminPool.query(
      `SELECT 1 FROM eventos_auditoria WHERE usuario_id = $1 AND acao = 'login'`,
      [operador.id],
    )
    expect(rows.length).toBeGreaterThan(0)
  })

  it('quando a senha está errada, então responde 401 e não grava cookie', async () => {
    const resposta = await request(await novoApp())
      .post('/api/auth/login')
      .send({ email: operador.email, senha: 'senha-errada-qualquer' })

    expect(resposta.status).toBe(401)
    expect(resposta.headers['set-cookie']).toBeUndefined()
  })

  it('quando o email não existe, então responde 401 com a mesma mensagem de senha errada', async () => {
    const app = await novoApp()
    const senhaErrada = await request(app)
      .post('/api/auth/login')
      .send({ email: operador.email, senha: 'senha-errada-qualquer' })
    const emailInexistente = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ninguem@inexistente.dev', senha: 'qualquer-senha-123' })

    expect(emailInexistente.status).toBe(401)
    expect(emailInexistente.body.erro).toBe(senhaErrada.body.erro)
    expect(emailInexistente.headers['set-cookie']).toBeUndefined()
  })

  it('quando o usuário está inativo, então responde 401 e não grava cookie nem sessão', async () => {
    const tenant = await criarTenant()
    const inativo = await criarUsuario(tenant.id, 'operador', { ativo: false })

    const resposta = await request(await novoApp())
      .post('/api/auth/login')
      .send({ email: inativo.email, senha: inativo.senha })

    expect(resposta.status).toBe(401)
    expect(resposta.headers['set-cookie']).toBeUndefined()
    const { rowCount } = await adminPool.query('SELECT 1 FROM sessoes WHERE usuario_id = $1', [
      inativo.id,
    ])
    expect(rowCount).toBe(0)
  })

  it('quando falta email ou senha no corpo, então responde 400 e não cria sessão', async () => {
    const app = await novoApp()
    const semSenha = await request(app).post('/api/auth/login').send({ email: operador.email })
    const semEmail = await request(app).post('/api/auth/login').send({ senha: operador.senha })

    expect(semSenha.status).toBe(400)
    expect(semEmail.status).toBe(400)
    expect(semSenha.headers['set-cookie']).toBeUndefined()
  })

  it('quando excede o limite de tentativas na janela, então responde 429', async () => {
    const app = await novoApp()
    const tentativas = []
    for (let i = 0; i < 5; i += 1) {
      tentativas.push(
        await request(app)
          .post('/api/auth/login')
          .send({ email: operador.email, senha: 'senha-errada-qualquer' }),
      )
    }
    expect(tentativas.every((t) => t.status === 401)).toBe(true)

    const sexta = await request(app)
      .post('/api/auth/login')
      .send({ email: operador.email, senha: operador.senha })
    expect(sexta.status).toBe(429)
    expect(sexta.headers['set-cookie']).toBeUndefined()
  })

  it('quando dois logins do mesmo usuário chegam ao mesmo tempo, então ambos entram, com sessões distintas', async () => {
    const [a, b] = await Promise.all([
      request(await novoApp())
        .post('/api/auth/login')
        .send({ email: operador.email, senha: operador.senha }),
      request(await novoApp())
        .post('/api/auth/login')
        .send({ email: operador.email, senha: operador.senha }),
    ])

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    const sessaoA = cookieDaSessao(a.headers['set-cookie'] as unknown as string[])
    const sessaoB = cookieDaSessao(b.headers['set-cookie'] as unknown as string[])
    expect(sessaoA).not.toBe(sessaoB)
  })
})

describe('sessão (GET /api/auth/me e POST /api/auth/logout)', () => {
  it('quando acessa /me com cookie de sessão válido, então responde 200 com o usuário', async () => {
    const cookie = await entrar(operador)

    const resposta = await request(await novoApp())
      .get('/api/auth/me')
      .set('Cookie', cookie)

    expect(resposta.status).toBe(200)
    expect(resposta.body.usuario.id).toBe(operador.id)
    expect(resposta.body.usuario.tenantId).toBe(operador.tenantId)
  })

  it('quando acessa /me sem cookie, então responde 401', async () => {
    const resposta = await request(await novoApp()).get('/api/auth/me')

    expect(resposta.status).toBe(401)
  })

  it('quando acessa /me com um id de sessão que não existe, então responde 401', async () => {
    const resposta = await request(await novoApp())
      .get('/api/auth/me')
      .set('Cookie', 'session=00000000-0000-4000-8000-000000000000')

    expect(resposta.status).toBe(401)
  })

  it('quando acessa /me com a sessão expirada, então responde 401 e limpa o cookie', async () => {
    const cookie = await entrar(operador)
    const idSessao = cookieDaSessao(cookie).split(';')[0]?.replace('session=', '')
    await adminPool.query(
      `UPDATE sessoes SET expira_em = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [idSessao],
    )

    const resposta = await request(await novoApp())
      .get('/api/auth/me')
      .set('Cookie', cookie)

    expect(resposta.status).toBe(401)
    const limpou = (resposta.headers['set-cookie'] as unknown as string[] | undefined) ?? []
    expect(limpou.some((c) => c.startsWith('session=;'))).toBe(true)
  })

  it('quando faz logout com sessão válida, então responde 200, invalida a sessão e o /me seguinte dá 401', async () => {
    const cookie = await entrar(operador)
    const idSessao = cookieDaSessao(cookie).split(';')[0]?.replace('session=', '')

    const logout = await request(await novoApp())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
    expect(logout.status).toBe(200)

    const { rows } = await adminPool.query('SELECT 1 FROM sessoes WHERE id = $1', [idSessao])
    expect(rows).toHaveLength(0)
    const me = await request(await novoApp())
      .get('/api/auth/me')
      .set('Cookie', cookie)
    expect(me.status).toBe(401)
  })

  it('quando faz logout duas vezes seguidas, então a segunda também responde 200', async () => {
    const cookie = await entrar(operador)
    const app = await novoApp()

    const primeiro = await request(app).post('/api/auth/logout').set('Cookie', cookie)
    const segundo = await request(app).post('/api/auth/logout').set('Cookie', cookie)

    expect(primeiro.status).toBe(200)
    expect(segundo.status).toBe(200)
  })

  it('quando dois logouts da mesma sessão chegam ao mesmo tempo, então nenhum dá erro', async () => {
    const cookie = await entrar(operador)

    const [a, b] = await Promise.all([
      request(await novoApp())
        .post('/api/auth/logout')
        .set('Cookie', cookie),
      request(await novoApp())
        .post('/api/auth/logout')
        .set('Cookie', cookie),
    ])

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
  })
})
