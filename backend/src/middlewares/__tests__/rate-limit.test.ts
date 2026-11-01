import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { criarApp } from '../../app.js'
import { criarApiRateLimit } from '../rate-limit.js'

function montar(max: number): express.Express {
  const app = express()
  app.use('/api/dados', criarApiRateLimit(max))
  app.get('/api/dados', (_req, res) => {
    res.json({ ok: true })
  })
  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })
  return app
}

describe('criarApiRateLimit', () => {
  it('quando o IP excede o teto na janela, então responde 429 com mensagem em pt-BR', async () => {
    const app = montar(3)
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get('/api/dados')).status).toBe(200)
    }
    const bloqueada = await request(app).get('/api/dados')
    expect(bloqueada.status).toBe(429)
    expect(bloqueada.body).toEqual({ erro: 'Muitas requisições. Tente novamente em instantes.' })
  })

  it('quando bloqueia, então não afeta rotas fora do prefixo limitado', async () => {
    const app = montar(1)
    await request(app).get('/api/dados')
    expect((await request(app).get('/api/dados')).status).toBe(429)
    expect((await request(app).get('/health')).status).toBe(200)
  })

  it('quando cria duas instâncias, então a contagem não vaza entre elas', async () => {
    const a = montar(1)
    const b = montar(1)
    await request(a).get('/api/dados')
    expect((await request(a).get('/api/dados')).status).toBe(429)
    expect((await request(b).get('/api/dados')).status).toBe(200)
  })

  it('usa 300 requisições por minuto como teto padrão', async () => {
    const app = express()
    app.use(criarApiRateLimit())
    app.get('/', (_req, res) => {
      res.json({ ok: true })
    })
    const res = await request(app).get('/')
    expect(res.headers['ratelimit-limit']).toBe('300')
  })
})

describe('limite geral no app real', () => {
  const prefixos = [
    '/api/clientes',
    '/api/empresas',
    '/api/responsaveis',
    '/api/orcamentos',
    '/api/templates',
  ]

  it.each(prefixos)(
    'quando chama %s sem sessão, então a resposta já traz o limite',
    async (rota) => {
      const res = await request(criarApp()).get(rota)
      expect(res.status).toBe(401)
      expect(res.headers['ratelimit-limit']).toBe('300')
    },
  )

  it('quando chama /api/publico, então o limite é o próprio da rota pública (60)', async () => {
    const res = await request(criarApp()).get('/api/publico/orcamento/invalido')
    expect(res.headers['ratelimit-limit']).toBe('60')
  })
})
