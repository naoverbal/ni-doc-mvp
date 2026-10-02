import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import { criarApp } from '../../app.js'
import { AppError } from '../../errors/app-error.js'
import { errorHandler } from '../../middlewares/error-handler.js'

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
