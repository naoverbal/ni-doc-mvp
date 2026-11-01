import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, executarComTenant } from '../config/database.js'
import { criarAuditoriaRepository } from '../repositories/auditoria.repository.js'
import { criarClienteRepository } from '../repositories/cliente.repository.js'
import { criarEmpresaRepository } from '../repositories/empresa.repository.js'
import {
  criarOrcamentoRepository,
  type OrcamentoRepository,
} from '../repositories/orcamento.repository.js'
import { criarResponsavelRepository } from '../repositories/responsavel.repository.js'
import {
  criarOrcamentoVersaoRepository,
  type OrcamentoVersaoRepository,
} from '../repositories/orcamento-versao.repository.js'
import { criarTemplateRepository } from '../repositories/template.repository.js'
import { env } from '../config/env.js'
import { criarAuditoriaService } from '../services/auditoria.service.js'
import { criarHtmlRendererService } from '../services/html-renderer.service.js'
import { criarOrcamentoService } from '../services/orcamento.service.js'
import { criarPdfService } from '../services/pdf.service.js'
import { criarSnapshotService } from '../services/snapshot.service.js'
import { criarVersionamentoService } from '../services/versionamento.service.js'
import {
  adminPool,
  contarVersoes,
  corpoOrcamento,
  criarCenario,
  criarRascunho,
  encerrarConexoes,
  limparDados,
  statusNoBanco,
  type Cenario,
} from './helpers.js'

// Corridas entre a CHECAGEM de status feita pelo serviço (sem lock) e a GRAVAÇÃO
// no repositório. Pelo HTTP a janela é curta demais para ser atingida de forma
// confiável; aqui o repositório real é instrumentado para executar a operação
// concorrente (pelas rotas reais) exatamente nesse intervalo. Banco, RLS,
// serviço e repositório são os reais.

let c: Cenario

beforeAll(async () => {
  c = await criarCenario()
})

afterAll(async () => {
  await limparDados()
  await encerrarConexoes()
})

/** Status HTTP que o error handler daria ao erro (AppError → statusCode; resto → 500). */
async function statusDe(promessa: Promise<unknown>): Promise<number> {
  try {
    await promessa
    return 200
  } catch (erro) {
    const codigo = (erro as { statusCode?: unknown }).statusCode
    return typeof codigo === 'number' ? codigo : 500
  }
}

/**
 * Serviço de orçamento cujo `buscarPorId` (a checagem do serviço) executa
 * `concorrente` uma única vez, logo após ler o orçamento e antes da gravação.
 */
function servicoComIntervalo(concorrente: () => Promise<void>) {
  const repoReal = criarOrcamentoRepository({ db })
  let executado = false
  const orcamentoRepo: OrcamentoRepository = {
    ...repoReal,
    async buscarPorId(tenantId, id) {
      const lido = await repoReal.buscarPorId(tenantId, id)
      if (!executado) {
        executado = true
        await concorrente()
      }
      return lido
    },
  }
  return criarOrcamentoService({
    orcamentoRepo,
    clienteRepo: criarClienteRepository(db),
    empresaRepo: criarEmpresaRepository(db),
    responsavelRepo: criarResponsavelRepository(db),
    auditoriaService: criarAuditoriaService(criarAuditoriaRepository(db)),
  })
}

function editar(servico: ReturnType<typeof servicoComIntervalo>, id: string) {
  return statusDe(
    executarComTenant(c.tenant.id, () =>
      servico.atualizar({ tenantId: c.tenant.id, usuarioId: c.operador.id }, id, {
        titulo: 'Título editado',
        itens: [{ nome: 'Item editado', quantidade: 1, valorUnitario: 1 }],
      }),
    ),
  )
}

async function nomesDosItens(orcamentoId: string): Promise<string[]> {
  const { rows } = await adminPool.query<{ nome: string }>(
    'SELECT nome FROM orcamento_itens WHERE orcamento_id = $1 ORDER BY ordem',
    [orcamentoId],
  )
  return rows.map((r) => r.nome)
}

async function nomesDosItensDoSnapshot(orcamentoId: string): Promise<string[]> {
  const { rows } = await adminPool.query<{ nome: string }>(
    `SELECT item->>'nome' AS nome
     FROM orcamento_versoes v, jsonb_array_elements(v.snapshot->'itens') AS item
     WHERE v.orcamento_id = $1 AND v.versao = 1`,
    [orcamentoId],
  )
  return rows.map((r) => r.nome)
}

describe('editar orçamento concorrente com outra transição', () => {
  it('quando o envio é concluído entre a checagem de status e a gravação da edição, então a edição responde 409 e os itens no banco continuam iguais ao snapshot da versão 1', async () => {
    const rascunho = await criarRascunho(c)
    const servico = servicoComIntervalo(async () => {
      const envio = await request(c.app)
        .post(`/api/orcamentos/${rascunho.id}/enviar`)
        .set('Cookie', c.cookieOperador)
      expect(envio.status).toBe(201)
    })

    expect(await editar(servico, rascunho.id)).toBe(409)

    expect(await statusNoBanco(rascunho.id)).toBe('enviado')
    expect(await contarVersoes(rascunho.id)).toBe(1)
    const snapshot = await nomesDosItensDoSnapshot(rascunho.id)
    expect(snapshot.length).toBeGreaterThan(0)
    expect(await nomesDosItens(rascunho.id)).toEqual(snapshot)
  })

  it('quando o orçamento é excluído entre a checagem e a gravação da edição, então a edição responde 404', async () => {
    const rascunho = await criarRascunho(c)
    const servico = servicoComIntervalo(async () => {
      const exclusao = await request(c.app)
        .delete(`/api/orcamentos/${rascunho.id}`)
        .set('Cookie', c.cookieOperador)
      expect(exclusao.status).toBe(204)
    })

    expect(await editar(servico, rascunho.id)).toBe(404)

    expect(await statusNoBanco(rascunho.id)).toBeUndefined()
  })
})

/**
 * Serviço de envio cujo repositório de versões executa `concorrente` uma única
 * vez, DEPOIS de o serviço ter lido o orçamento/template e montado o snapshot e
 * ANTES da transação que grava a versão.
 */
function envioComIntervalo(concorrente: () => Promise<void>) {
  const repoReal = criarOrcamentoVersaoRepository({ db })
  let executado = false
  const orcamentoVersaoRepo: OrcamentoVersaoRepository = {
    ...repoReal,
    async criarVersaoEnviar(input) {
      if (!executado) {
        executado = true
        await concorrente()
      }
      return repoReal.criarVersaoEnviar(input)
    },
  }
  return criarVersionamentoService({
    orcamentoRepo: criarOrcamentoRepository({ db }),
    orcamentoVersaoRepo,
    clienteRepo: criarClienteRepository(db),
    empresaRepo: criarEmpresaRepository(db),
    responsavelRepo: criarResponsavelRepository(db),
    snapshotService: criarSnapshotService(),
    auditoriaService: criarAuditoriaService(criarAuditoriaRepository(db)),
    pdfService: criarPdfService({ pdfsDir: env.PDFS_DIR }),
    htmlRenderer: criarHtmlRendererService(),
    templateRepo: criarTemplateRepository({ db }),
  })
}

function enviar(servico: ReturnType<typeof envioComIntervalo>, id: string) {
  return statusDe(
    executarComTenant(c.tenant.id, () =>
      servico.enviar({ tenantId: c.tenant.id, usuarioId: c.operador.id }, id),
    ),
  )
}

describe('enviar orçamento com dados lidos antes do lock', () => {
  it('quando o orçamento é editado entre a leitura do envio e a gravação da versão, então o envio responde 409, nenhuma versão é criada e o orçamento continua rascunho', async () => {
    const rascunho = await criarRascunho(c)
    const servico = envioComIntervalo(async () => {
      const edicao = await request(c.app)
        .put(`/api/orcamentos/${rascunho.id}`)
        .set('Cookie', c.cookieOperador)
        .send(corpoOrcamento(c.cliente.id))
      expect(edicao.status).toBe(200)
    })

    expect(await enviar(servico, rascunho.id)).toBe(409)

    expect(await contarVersoes(rascunho.id)).toBe(0)
    expect(await statusNoBanco(rascunho.id)).toBe('rascunho')
  })

  it('quando o template ativo muda entre a leitura do envio e a gravação da versão, então o envio responde 409 e nenhuma versão é criada', async () => {
    const rascunho = await criarRascunho(c)
    const servico = envioComIntervalo(async () => {
      const troca = await request(c.app)
        .put('/api/templates/atual')
        .set('Cookie', c.cookieAdmin)
        .send({ layoutJson: { formato: 'A4', orientacao: 'paisagem', secoes: [] } })
      expect(troca.status).toBe(200)
    })

    expect(await enviar(servico, rascunho.id)).toBe(409)

    expect(await contarVersoes(rascunho.id)).toBe(0)
    expect(await statusNoBanco(rascunho.id)).toBe('rascunho')
  })
})
