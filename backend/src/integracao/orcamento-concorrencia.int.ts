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
import { criarAuditoriaService } from '../services/auditoria.service.js'
import { criarOrcamentoService } from '../services/orcamento.service.js'
import {
  adminPool,
  contarVersoes,
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
