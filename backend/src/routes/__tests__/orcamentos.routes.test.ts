import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import cookieParser from 'cookie-parser'
import { criarOrcamentosRouter } from '../orcamentos.routes.js'
import { errorHandler } from '../../middlewares/error-handler.js'
import { AppError } from '../../errors/app-error.js'
import type { AuthService } from '../../services/auth.service.js'
import type { OrcamentoService } from '../../services/orcamento.service.js'
import type { VersionamentoService, VersaoEnviada } from '../../services/versionamento.service.js'
import type { AceiteService, AceiteRegistrado } from '../../services/aceite.service.js'
import type { OrcamentoComItens, ListaOrcamentos } from '../../repositories/orcamento.repository.js'
import type { UsuarioPublico } from '../../repositories/usuario.repository.js'
import type { SessaoAtiva } from '../../repositories/sessao.repository.js'

const CLIENTE_ID = '11111111-1111-1111-1111-111111111111'

const usuarioPublicoMock: UsuarioPublico = {
  id: 'user-1',
  tenantId: 'tenant-1',
  nome: 'Ana Costa',
  email: 'ana@exemplo.com',
  papel: 'admin',
  ativo: true,
  criadoEm: new Date('2024-01-01'),
}

const sessaoMock: SessaoAtiva = {
  id: 'sessao-id-1',
  usuarioId: 'user-1',
  expiraEm: new Date(Date.now() + 8 * 60 * 60 * 1000),
  ultimaAtividade: new Date(),
}

const orcamentoComItensMock: OrcamentoComItens = {
  id: 'orcamento-1',
  tenantId: 'tenant-1',
  numero: 'ORC-2024-0001',
  clienteId: CLIENTE_ID,
  empresaClienteId: null,
  usuarioId: 'user-1',
  titulo: 'Projeto X',
  descricao: null,
  status: 'rascunho',
  dataEmissao: new Date('2024-01-01'),
  validadeDias: 30,
  descontoGlobalTipo: null,
  descontoGlobalValor: null,
  subtotal: 100,
  total: 100,
  versaoAtual: 1,
  observacoes: null,
  condicoesPagamento: null,
  criadoEm: new Date('2024-01-01'),
  atualizadoEm: new Date('2024-01-01'),
  itens: [
    {
      id: 'item-1',
      ordem: 1,
      nome: 'Serviço A',
      descricao: null,
      quantidade: 1,
      unidade: 'un',
      valorUnitario: 100,
      descontoTipo: null,
      descontoValor: null,
      total: 100,
      responsavelId: null,
    },
  ],
}

const listaOrcamentosMock: ListaOrcamentos = {
  itens: [
    {
      id: 'orcamento-1',
      numero: 'ORC-2024-0001',
      titulo: 'Projeto X',
      status: 'rascunho',
      clienteId: CLIENTE_ID,
      subtotal: 100,
      total: 100,
      versaoAtual: 1,
      dataEmissao: new Date('2024-01-01'),
      criadoEm: new Date('2024-01-01'),
    },
  ],
  total: 1,
  pagina: 1,
  tamanhoPagina: 20,
}

const versaoEnviadaMock: VersaoEnviada = {
  id: 'versao-1',
  orcamentoId: 'orcamento-1',
  versao: 1,
  tokenPublico: 'token-publico-1',
  templateId: 'template-1',
  pdfPath: null,
  pdfHash: null,
  enviadoEm: new Date('2024-01-01'),
  expiraEm: null,
}

const bodyValido = {
  clienteId: CLIENTE_ID,
  titulo: 'Projeto X',
  itens: [{ nome: 'Serviço A', quantidade: 1, valorUnitario: 100 }],
}

function makeAuthService(overrides?: Partial<AuthService>): AuthService {
  return {
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    validarSessao: vi.fn().mockResolvedValue({ usuario: usuarioPublicoMock, sessao: sessaoMock }),
    ...overrides,
  }
}

function makeOrcamentoService(overrides?: Partial<OrcamentoService>): OrcamentoService {
  return {
    criar: vi.fn().mockResolvedValue(orcamentoComItensMock),
    buscarPorId: vi.fn().mockResolvedValue(orcamentoComItensMock),
    listar: vi.fn().mockResolvedValue(listaOrcamentosMock),
    atualizar: vi.fn().mockResolvedValue(orcamentoComItensMock),
    deletar: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makeVersionamentoService(overrides?: Partial<VersionamentoService>): VersionamentoService {
  return {
    enviar: vi.fn().mockResolvedValue(versaoEnviadaMock),
    ...overrides,
  }
}

const aceiteRegistradoMock: AceiteRegistrado = {
  id: 'aceite-1',
  versaoId: 'versao-1',
  orcamentoId: 'orcamento-1',
  metodo: 'operador',
  hashDocumento: 'a'.repeat(64),
  comprovantePdfPath: '/pdfs/ORC-2024-0001-aceite-v1.pdf',
  comprovantePdfHash: 'b'.repeat(64),
  criadoEm: new Date('2024-01-02'),
}

function makeAceiteService(overrides?: Partial<AceiteService>): AceiteService {
  return {
    aprovarViaCliente: vi.fn().mockResolvedValue(aceiteRegistradoMock),
    reprovarViaCliente: vi.fn().mockResolvedValue(aceiteRegistradoMock),
    visualizarPorToken: vi.fn().mockResolvedValue(undefined),
    aceiteManual: vi.fn().mockResolvedValue(aceiteRegistradoMock),
    ...overrides,
  }
}

function makeApp(
  orcamentoService: OrcamentoService,
  authService: AuthService,
  versionamentoService: VersionamentoService = makeVersionamentoService(),
  aceiteService: AceiteService = makeAceiteService(),
) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use(
    '/api/orcamentos',
    criarOrcamentosRouter(orcamentoService, versionamentoService, aceiteService, authService),
  )
  app.use(errorHandler)
  return app
}

describe('POST /api/orcamentos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 201 e o orçamento criado com body válido', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .post('/api/orcamentos')
      .set('Cookie', 'session=sessao-id-1')
      .send(bodyValido)

    expect(res.status).toBe(201)
    expect(res.body.id).toBe('orcamento-1')
    expect(res.body.itens).toHaveLength(1)
    expect(orcamentoService.criar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      bodyValido,
    )
  })

  it('retorna 400 sem titulo (Zod) e não chama o service', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .post('/api/orcamentos')
      .set('Cookie', 'session=sessao-id-1')
      .send({ clienteId: CLIENTE_ID, itens: [{ nome: 'A', quantidade: 1, valorUnitario: 10 }] })

    expect(res.status).toBe(400)
    expect(orcamentoService.criar).not.toHaveBeenCalled()
  })

  it('retorna 400 com itens vazio', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .post('/api/orcamentos')
      .set('Cookie', 'session=sessao-id-1')
      .send({ clienteId: CLIENTE_ID, titulo: 'Projeto X', itens: [] })

    expect(res.status).toBe(400)
    expect(orcamentoService.criar).not.toHaveBeenCalled()
  })

  it('retorna 400 com clienteId ausente', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .post('/api/orcamentos')
      .set('Cookie', 'session=sessao-id-1')
      .send({ titulo: 'Projeto X', itens: [{ nome: 'A', quantidade: 1, valorUnitario: 10 }] })

    expect(res.status).toBe(400)
    expect(orcamentoService.criar).not.toHaveBeenCalled()
  })

  it('propaga AppError 400 do service (Cliente é obrigatório)', async () => {
    const orcamentoService = makeOrcamentoService({
      criar: vi.fn().mockRejectedValue(new AppError(400, 'Cliente é obrigatório')),
    })
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .post('/api/orcamentos')
      .set('Cookie', 'session=sessao-id-1')
      .send(bodyValido)

    expect(res.status).toBe(400)
  })

  it('retorna 401 sem cookie session', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app).post('/api/orcamentos').send(bodyValido)

    expect(res.status).toBe(401)
  })
})

describe('GET /api/orcamentos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e a lista sem filtros', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app).get('/api/orcamentos').set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(res.body.itens).toHaveLength(1)
    expect(res.body.total).toBe(1)
    expect(orcamentoService.listar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      {},
    )
  })

  it('retorna 200 e filtra por status', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .get('/api/orcamentos')
      .query({ status: 'enviado' })
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(orcamentoService.listar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      { status: 'enviado' },
    )
  })

  it('retorna 200 e repassa paginação', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .get('/api/orcamentos')
      .query({ pagina: '2', tamanhoPagina: '10' })
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(orcamentoService.listar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      { pagina: 2, tamanhoPagina: 10 },
    )
  })

  it('retorna 400 com status fora do enum e não chama o service', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .get('/api/orcamentos')
      .query({ status: 'xpto' })
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(400)
    expect(orcamentoService.listar).not.toHaveBeenCalled()
  })

  it('retorna 401 sem cookie session', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app).get('/api/orcamentos')

    expect(res.status).toBe(401)
  })
})

describe('GET /api/orcamentos/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e o orçamento com itens', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .get('/api/orcamentos/orcamento-1')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('orcamento-1')
    expect(res.body.itens).toHaveLength(1)
    expect(orcamentoService.buscarPorId).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      'orcamento-1',
    )
  })

  it('propaga AppError 404 do service', async () => {
    const orcamentoService = makeOrcamentoService({
      buscarPorId: vi.fn().mockRejectedValue(new AppError(404, 'Orçamento não encontrado')),
    })
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .get('/api/orcamentos/inexistente')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(404)
  })

  it('retorna 401 sem cookie session', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app).get('/api/orcamentos/orcamento-1')

    expect(res.status).toBe(401)
  })
})

describe('PUT /api/orcamentos/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 200 e o orçamento atualizado com body válido', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const body = {
      titulo: 'Projeto Atualizado',
      itens: [{ nome: 'Serviço B', quantidade: 2, valorUnitario: 50 }],
    }

    const res = await request(app)
      .put('/api/orcamentos/orcamento-1')
      .set('Cookie', 'session=sessao-id-1')
      .send(body)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('orcamento-1')
    expect(orcamentoService.atualizar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      'orcamento-1',
      body,
    )
  })

  it('retorna 400 com body inválido (itens vazio)', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .put('/api/orcamentos/orcamento-1')
      .set('Cookie', 'session=sessao-id-1')
      .send({ titulo: 'Projeto', itens: [] })

    expect(res.status).toBe(400)
    expect(orcamentoService.atualizar).not.toHaveBeenCalled()
  })

  it('retorna 409 quando o orçamento não é rascunho (service lança)', async () => {
    const orcamentoService = makeOrcamentoService({
      atualizar: vi
        .fn()
        .mockRejectedValue(new AppError(409, 'Só é possível editar orçamentos em rascunho')),
    })
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .put('/api/orcamentos/orcamento-1')
      .set('Cookie', 'session=sessao-id-1')
      .send({ itens: [{ nome: 'A', quantidade: 1, valorUnitario: 10 }] })

    expect(res.status).toBe(409)
  })

  it('propaga AppError 404 do service', async () => {
    const orcamentoService = makeOrcamentoService({
      atualizar: vi.fn().mockRejectedValue(new AppError(404, 'Orçamento não encontrado')),
    })
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .put('/api/orcamentos/inexistente')
      .set('Cookie', 'session=sessao-id-1')
      .send({ itens: [{ nome: 'A', quantidade: 1, valorUnitario: 10 }] })

    expect(res.status).toBe(404)
  })

  it('retorna 401 sem cookie session', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .put('/api/orcamentos/orcamento-1')
      .send({ itens: [{ nome: 'A', quantidade: 1, valorUnitario: 10 }] })

    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/orcamentos/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 204 sem corpo em rascunho', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .delete('/api/orcamentos/orcamento-1')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(204)
    expect(res.body).toEqual({})
    expect(orcamentoService.deletar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      'orcamento-1',
    )
  })

  it('retorna 409 quando o orçamento não é rascunho (service lança)', async () => {
    const orcamentoService = makeOrcamentoService({
      deletar: vi
        .fn()
        .mockRejectedValue(new AppError(409, 'Só é possível excluir orçamentos em rascunho')),
    })
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .delete('/api/orcamentos/orcamento-1')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(409)
  })

  it('propaga AppError 404 do service', async () => {
    const orcamentoService = makeOrcamentoService({
      deletar: vi.fn().mockRejectedValue(new AppError(404, 'Orçamento não encontrado')),
    })
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app)
      .delete('/api/orcamentos/inexistente')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(404)
  })

  it('retorna 401 sem cookie session', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const app = makeApp(orcamentoService, authService)

    const res = await request(app).delete('/api/orcamentos/orcamento-1')

    expect(res.status).toBe(401)
  })
})

describe('POST /api/orcamentos/:id/enviar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 201 e a versão criada em caso de sucesso', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const versionamentoService = makeVersionamentoService()
    const app = makeApp(orcamentoService, authService, versionamentoService)

    const res = await request(app)
      .post('/api/orcamentos/orcamento-1/enviar')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(201)
    expect(res.body.id).toBe('versao-1')
    expect(res.body.versao).toBe(1)
    expect(res.body.tokenPublico).toBe('token-publico-1')
    expect(res.body.pdfPath).toBeNull()
    expect(versionamentoService.enviar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1' }),
      'orcamento-1',
    )
  })

  it('retorna 400 quando o rascunho não tem itens (service lança)', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const versionamentoService = makeVersionamentoService({
      enviar: vi.fn().mockRejectedValue(new AppError(400, 'Orçamento deve ter ao menos um item')),
    })
    const app = makeApp(orcamentoService, authService, versionamentoService)

    const res = await request(app)
      .post('/api/orcamentos/orcamento-1/enviar')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(400)
  })

  it('retorna 409 quando o orçamento não é rascunho (service lança)', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const versionamentoService = makeVersionamentoService({
      enviar: vi
        .fn()
        .mockRejectedValue(new AppError(409, 'Só é possível enviar orçamentos em rascunho')),
    })
    const app = makeApp(orcamentoService, authService, versionamentoService)

    const res = await request(app)
      .post('/api/orcamentos/orcamento-1/enviar')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(409)
  })

  it('propaga AppError 404 do service', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const versionamentoService = makeVersionamentoService({
      enviar: vi.fn().mockRejectedValue(new AppError(404, 'Orçamento não encontrado')),
    })
    const app = makeApp(orcamentoService, authService, versionamentoService)

    const res = await request(app)
      .post('/api/orcamentos/inexistente/enviar')
      .set('Cookie', 'session=sessao-id-1')

    expect(res.status).toBe(404)
  })

  it('retorna 401 sem cookie session', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const versionamentoService = makeVersionamentoService()
    const app = makeApp(orcamentoService, authService, versionamentoService)

    const res = await request(app).post('/api/orcamentos/orcamento-1/enviar')

    expect(res.status).toBe(401)
    expect(versionamentoService.enviar).not.toHaveBeenCalled()
  })
})

describe('POST /api/orcamentos/:id/aceite-manual', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna 201 e registra o operador e a justificativa (status vira aprovado no service)', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const versionamentoService = makeVersionamentoService()
    const aceiteService = makeAceiteService()
    const app = makeApp(orcamentoService, authService, versionamentoService, aceiteService)

    const res = await request(app)
      .post('/api/orcamentos/orcamento-1/aceite-manual')
      .set('Cookie', 'session=sessao-id-1')
      .send({ justificativa: 'Cliente aprovou por telefone' })

    expect(res.status).toBe(201)
    expect(res.body.id).toBe('aceite-1')
    expect(res.body.metodo).toBe('operador')
    expect(aceiteService.aceiteManual).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        orcamentoId: 'orcamento-1',
        usuarioId: 'user-1',
        justificativa: 'Cliente aprovou por telefone',
      }),
    )
  })

  it('retorna 400 sem justificativa (Zod) e não chama o service', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const versionamentoService = makeVersionamentoService()
    const aceiteService = makeAceiteService()
    const app = makeApp(orcamentoService, authService, versionamentoService, aceiteService)

    const res = await request(app)
      .post('/api/orcamentos/orcamento-1/aceite-manual')
      .set('Cookie', 'session=sessao-id-1')
      .send({})

    expect(res.status).toBe(400)
    expect(aceiteService.aceiteManual).not.toHaveBeenCalled()
  })

  it('retorna 400 com justificativa só de espaços (Zod trim) e não chama o service', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const versionamentoService = makeVersionamentoService()
    const aceiteService = makeAceiteService()
    const app = makeApp(orcamentoService, authService, versionamentoService, aceiteService)

    const res = await request(app)
      .post('/api/orcamentos/orcamento-1/aceite-manual')
      .set('Cookie', 'session=sessao-id-1')
      .send({ justificativa: '   ' })

    expect(res.status).toBe(400)
    expect(aceiteService.aceiteManual).not.toHaveBeenCalled()
  })

  it('propaga AppError 404 do service', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const versionamentoService = makeVersionamentoService()
    const aceiteService = makeAceiteService({
      aceiteManual: vi.fn().mockRejectedValue(new AppError(404, 'Orçamento não encontrado')),
    })
    const app = makeApp(orcamentoService, authService, versionamentoService, aceiteService)

    const res = await request(app)
      .post('/api/orcamentos/inexistente/aceite-manual')
      .set('Cookie', 'session=sessao-id-1')
      .send({ justificativa: 'Cliente aprovou por telefone' })

    expect(res.status).toBe(404)
  })

  it('propaga AppError 409 do service (orçamento sem versão enviada)', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const versionamentoService = makeVersionamentoService()
    const aceiteService = makeAceiteService({
      aceiteManual: vi.fn().mockRejectedValue(new AppError(409, 'Orçamento sem versão enviada')),
    })
    const app = makeApp(orcamentoService, authService, versionamentoService, aceiteService)

    const res = await request(app)
      .post('/api/orcamentos/orcamento-1/aceite-manual')
      .set('Cookie', 'session=sessao-id-1')
      .send({ justificativa: 'Cliente aprovou por telefone' })

    expect(res.status).toBe(409)
  })

  it('retorna 401 sem cookie session e não chama o service', async () => {
    const orcamentoService = makeOrcamentoService()
    const authService = makeAuthService()
    const versionamentoService = makeVersionamentoService()
    const aceiteService = makeAceiteService()
    const app = makeApp(orcamentoService, authService, versionamentoService, aceiteService)

    const res = await request(app)
      .post('/api/orcamentos/orcamento-1/aceite-manual')
      .send({ justificativa: 'Cliente aprovou por telefone' })

    expect(res.status).toBe(401)
    expect(aceiteService.aceiteManual).not.toHaveBeenCalled()
  })
})
