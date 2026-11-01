import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { criarApp } from '../../app.js'
import { AppError } from '../../errors/app-error.js'
import { errorHandler } from '../../middlewares/error-handler.js'
import { _resetEnvCache } from '../../config/env.js'

describe('GET /health', () => {
  it('retorna 200 com status ok', async () => {
    const app = criarApp()
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok' })
  })

  it('retorna NODE_ENV no body', async () => {
    const app = criarApp()
    const res = await request(app).get('/health')
    expect(res.body).toHaveProperty('env')
  })
})

describe('trust proxy (auditoria B-6)', () => {
  afterEach(() => {
    delete process.env['TRUST_PROXY']
    _resetEnvCache()
  })

  it('não confia em nenhum proxy por padrão', () => {
    _resetEnvCache()
    expect(criarApp().get('trust proxy')).toBe(0)
  })

  it('usa o número de proxies configurado em TRUST_PROXY', () => {
    process.env['TRUST_PROXY'] = '1'
    _resetEnvCache()
    expect(criarApp().get('trust proxy')).toBe(1)
  })

  it('expõe o IP de X-Forwarded-For como req.ip só quando há proxy confiável', async () => {
    const ipVisto = async (confiar: string | undefined): Promise<string> => {
      if (confiar === undefined) delete process.env['TRUST_PROXY']
      else process.env['TRUST_PROXY'] = confiar
      _resetEnvCache()
      const app = criarApp()
      // Rota de sonda registrada ANTES do errorHandler não existe; monta um app
      // que herda apenas a configuração de proxy do app real.
      const sonda = express()
      sonda.set('trust proxy', app.get('trust proxy'))
      sonda.get('/ip', (req, res) => {
        res.json({ ip: req.ip })
      })
      const res = await request(sonda).get('/ip').set('X-Forwarded-For', '203.0.113.9')
      return (res.body as { ip: string }).ip
    }

    expect(await ipVisto(undefined)).not.toBe('203.0.113.9')
    expect(await ipVisto('1')).toBe('203.0.113.9')
  })
})

describe('Error handler', () => {
  it('captura AppError e retorna JSON com statusCode correto', async () => {
    // Montar app isolado com rota de teste + error handler
    const app = express()
    app.use(express.json())
    app.get('/test-error', () => {
      throw new AppError(422, 'Erro de teste', { campo: 'valor' })
    })
    app.use(errorHandler)

    const res = await request(app).get('/test-error')
    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({ erro: 'Erro de teste', detalhes: { campo: 'valor' } })
  })

  it('captura erro genérico e retorna 500', async () => {
    const app = express()
    app.use(express.json())
    app.get('/test-generic-error', () => {
      throw new Error('algo quebrou')
    })
    app.use(errorHandler)

    const res = await request(app).get('/test-generic-error')
    expect(res.status).toBe(500)
    expect(res.body).toHaveProperty('erro')
  })
})
