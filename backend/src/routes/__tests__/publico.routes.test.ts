import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { criarPublicoRouter } from '../publico.routes.js'
import { errorHandler } from '../../middlewares/error-handler.js'
import { AppError } from '../../errors/app-error.js'
import type { AceiteService } from '../../services/aceite.service.js'

// -----------------------------------------------------------------------------
// Testes das rotas públicas (RF-019). São rotas SEM autenticação/tenant: o
// token público (uuid.hmac) é a credencial. O serviço de aceite é mockado via
// vi.fn() (mesma convenção de clientes.routes.test). Cobre os seis
// comportamentos: GET snapshot, 404 token inválido, 410 expirado, POST aprovar,
// 409 duplicado e POST reprovar.
// -----------------------------------------------------------------------------

const TOKEN = 'uuid-valido.hmac'

const visualizacaoMock = {
  numero: 'ORC-2026-0001',
  versao: 1,
  snapshot: { cliente: { id: 'cliente-1' }, itens: [] },
  integro: true,
  pdfUrl: `/api/publico/orcamento/${TOKEN}/pdf`,
}

const aceiteRegistradoMock = {
  id: 'aceite-1',
  versaoId: 'versao-1',
  orcamentoId: 'orc-1',
  metodo: 'cliente' as const,
  hashDocumento: 'a'.repeat(64),
  comprovantePdfPath: '/pdfs/ORC-2026-0001-aceite-v1.pdf',
  comprovantePdfHash: 'comprovante-hash',
  criadoEm: new Date('2026-02-01'),
}

function makeAceiteService(overrides?: Partial<AceiteService>): AceiteService {
  return {
    aprovarViaCliente: vi.fn().mockResolvedValue(aceiteRegistradoMock),
    aceiteManual: vi.fn().mockResolvedValue(aceiteRegistradoMock),
    visualizarPorToken: vi.fn().mockResolvedValue(visualizacaoMock),
    reprovarViaCliente: vi.fn().mockResolvedValue(aceiteRegistradoMock),
    obterPdfPorToken: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
    obterComprovantePorToken: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
    ...overrides,
  }
}

function makeApp(aceiteService: AceiteService) {
  const app = express()
  app.use(express.json())
  app.use('/api/publico', criarPublicoRouter(aceiteService))
  app.use(errorHandler)
  return app
}

describe('GET /api/publico/orcamento/:token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 com o snapshot, flag de integridade e URL do PDF', async () => {
    const aceiteService = makeAceiteService()
    const app = makeApp(aceiteService)

    const res = await request(app).get(`/api/publico/orcamento/${TOKEN}`)

    expect(res.status).toBe(200)
    expect(res.body.numero).toBe('ORC-2026-0001')
    expect(res.body.snapshot).toEqual({ cliente: { id: 'cliente-1' }, itens: [] })
    expect(res.body.integro).toBe(true)
    expect(res.body.pdfUrl).toContain(TOKEN)
    expect(aceiteService.visualizarPorToken).toHaveBeenCalledWith(TOKEN)
  })

  it('retorna 404 quando o token é inválido/desconhecido', async () => {
    const aceiteService = makeAceiteService({
      visualizarPorToken: vi.fn().mockRejectedValue(new AppError(404, 'Orçamento não encontrado')),
    })
    const app = makeApp(aceiteService)

    const res = await request(app).get(`/api/publico/orcamento/${TOKEN}`)

    expect(res.status).toBe(404)
  })

  it('retorna 410 quando a versão está expirada', async () => {
    const aceiteService = makeAceiteService({
      visualizarPorToken: vi.fn().mockRejectedValue(new AppError(410, 'Link expirado')),
    })
    const app = makeApp(aceiteService)

    const res = await request(app).get(`/api/publico/orcamento/${TOKEN}`)

    expect(res.status).toBe(410)
  })
})

describe('POST /api/publico/orcamento/:token/aprovar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 201 e registra o aceite com IP, user agent e método cliente', async () => {
    const aceiteService = makeAceiteService()
    const app = makeApp(aceiteService)

    const res = await request(app)
      .post(`/api/publico/orcamento/${TOKEN}/aprovar`)
      .set('User-Agent', 'navegador-cliente')
      .send({})

    expect(res.status).toBe(201)
    expect(res.body.metodo).toBe('cliente')
    expect(aceiteService.aprovarViaCliente).toHaveBeenCalledWith(
      expect.objectContaining({
        token: TOKEN,
        userAgent: 'navegador-cliente',
      }),
    )
  })

  it('retorna 409 quando o orçamento já foi aprovado (duplicado)', async () => {
    const aceiteService = makeAceiteService({
      aprovarViaCliente: vi.fn().mockRejectedValue(new AppError(409, 'Orçamento já aprovado')),
    })
    const app = makeApp(aceiteService)

    const res = await request(app).post(`/api/publico/orcamento/${TOKEN}/aprovar`).send({})

    expect(res.status).toBe(409)
  })

  it('retorna 404 quando o token é inválido', async () => {
    const aceiteService = makeAceiteService({
      aprovarViaCliente: vi.fn().mockRejectedValue(new AppError(404, 'Orçamento não encontrado')),
    })
    const app = makeApp(aceiteService)

    const res = await request(app).post(`/api/publico/orcamento/${TOKEN}/aprovar`).send({})

    expect(res.status).toBe(404)
  })
})

describe('POST /api/publico/orcamento/:token/reprovar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 201 e registra a reprovação com a justificativa opcional', async () => {
    const aceiteService = makeAceiteService()
    const app = makeApp(aceiteService)

    const res = await request(app)
      .post(`/api/publico/orcamento/${TOKEN}/reprovar`)
      .set('User-Agent', 'navegador-cliente')
      .send({ justificativa: 'preço acima do orçado' })

    expect(res.status).toBe(201)
    expect(aceiteService.reprovarViaCliente).toHaveBeenCalledWith(
      expect.objectContaining({
        token: TOKEN,
        userAgent: 'navegador-cliente',
        justificativa: 'preço acima do orçado',
      }),
    )
  })

  it('retorna 201 sem justificativa (campo opcional)', async () => {
    const aceiteService = makeAceiteService()
    const app = makeApp(aceiteService)

    const res = await request(app).post(`/api/publico/orcamento/${TOKEN}/reprovar`).send({})

    expect(res.status).toBe(201)
    expect(aceiteService.reprovarViaCliente).toHaveBeenCalledWith(
      expect.objectContaining({ token: TOKEN, justificativa: undefined }),
    )
  })

  it('retorna 400 quando a justificativa não é string', async () => {
    const aceiteService = makeAceiteService()
    const app = makeApp(aceiteService)

    const res = await request(app)
      .post(`/api/publico/orcamento/${TOKEN}/reprovar`)
      .send({ justificativa: 123 })

    expect(res.status).toBe(400)
    expect(aceiteService.reprovarViaCliente).not.toHaveBeenCalled()
  })

  it('retorna 409 quando o orçamento já foi decidido', async () => {
    const aceiteService = makeAceiteService({
      reprovarViaCliente: vi.fn().mockRejectedValue(new AppError(409, 'Orçamento já decidido')),
    })
    const app = makeApp(aceiteService)

    const res = await request(app).post(`/api/publico/orcamento/${TOKEN}/reprovar`).send({})

    expect(res.status).toBe(409)
  })
})

describe('GET /api/publico/orcamento/:token/pdf e /comprovante', () => {
  it('retorna 200 com application/pdf, Cache-Control private, no-store e os bytes do serviço', async () => {
    const aceiteService = makeAceiteService()
    const res = await request(makeApp(aceiteService))
      .get('/api/publico/orcamento/token-x/pdf')
      .responseType('blob')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^application\/pdf/)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.headers['content-disposition']).toBe('inline; filename="orcamento.pdf"')
    expect(Buffer.from(res.body as Buffer).toString()).toBe('%PDF-1.4 mock')
    expect(aceiteService.obterPdfPorToken).toHaveBeenCalledWith('token-x')
  })

  it('retorna 200 no comprovante com o nome de arquivo próprio', async () => {
    const aceiteService = makeAceiteService()
    const res = await request(makeApp(aceiteService))
      .get('/api/publico/orcamento/token-x/comprovante')
      .responseType('blob')

    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toBe('inline; filename="comprovante-aceite.pdf"')
    expect(aceiteService.obterComprovantePorToken).toHaveBeenCalledWith('token-x')
  })

  it.each([
    ['pdf', 404, 'obterPdfPorToken'],
    ['pdf', 410, 'obterPdfPorToken'],
    ['comprovante', 404, 'obterComprovantePorToken'],
  ] as const)('propaga o erro %s %i do serviço', async (rota, status, metodo) => {
    const aceiteService = makeAceiteService({
      [metodo]: vi.fn().mockRejectedValue(new AppError(status, 'erro do serviço')),
    })
    const res = await request(makeApp(aceiteService)).get(`/api/publico/orcamento/token-x/${rota}`)

    expect(res.status).toBe(status)
  })

  it('inclui comprovanteUrl na aprovação e nulo quando não há comprovante', async () => {
    const comComprovante = await request(makeApp(makeAceiteService())).post(
      '/api/publico/orcamento/token-x/aprovar',
    )
    expect(comComprovante.status).toBe(201)
    expect(comComprovante.body.comprovanteUrl).toBe('/api/publico/orcamento/token-x/comprovante')
    // O caminho de disco do servidor nunca sai na resposta pública.
    expect(comComprovante.body.comprovantePdfPath).toBeUndefined()
    expect(JSON.stringify(comComprovante.body)).not.toContain('/pdfs/')

    const semComprovante = await request(
      makeApp(
        makeAceiteService({
          reprovarViaCliente: vi
            .fn()
            .mockResolvedValue({ ...aceiteRegistradoMock, comprovantePdfPath: null }),
        }),
      ),
    )
      .post('/api/publico/orcamento/token-x/reprovar')
      .send({})
    expect(semComprovante.body.comprovanteUrl).toBeNull()
  })
})
