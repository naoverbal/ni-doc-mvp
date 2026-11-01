import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, executarComTenant } from '../config/database.js'
import { criarAuditoriaRepository } from '../repositories/auditoria.repository.js'
import { criarClienteRepository } from '../repositories/cliente.repository.js'
import { criarAuditoriaService } from '../services/auditoria.service.js'
import { criarClienteService } from '../services/cliente.service.js'
import { adminPool, criarCenario, encerrarConexoes, limparDados, type Cenario } from './helpers.js'

// Cadastros únicos sob requisições simultâneas: só uma tem efeito; a outra
// recebe 409 (nunca 500 nem duplicata no banco).
//
// Por que há um caso com BARREIRA: pelo HTTP (supertest) as requisições chegam
// com alguns ms de diferença, mais que a janela entre "checar" e "inserir"; o
// teste HTTP passaria mesmo sem a proteção no banco. A barreira segura cada
// chamada logo após a checagem de duplicidade até que todas tenham checado,
// reproduzindo de forma determinística o pior caso (todas veem "não existe"
// e todas tentam inserir). Repositório, serviço, RLS e banco são os reais.

/** Barreira: cada chamada espera até `n` chamadas terem chegado. */
function criarBarreira(n: number): () => Promise<void> {
  let chegaram = 0
  let liberar: () => void = () => undefined
  const todas = new Promise<void>((resolve) => {
    liberar = resolve
  })
  return async () => {
    chegaram += 1
    if (chegaram >= n) liberar()
    await todas
  }
}

/** Status HTTP que o error handler daria ao erro (AppError → statusCode; resto → 500). */
async function statusDe(promessa: Promise<unknown>): Promise<number> {
  try {
    await promessa
    return 201
  } catch (erro) {
    const codigo = (erro as { statusCode?: unknown }).statusCode
    return typeof codigo === 'number' ? codigo : 500
  }
}

let c: Cenario

beforeAll(async () => {
  c = await criarCenario()
})

afterAll(async () => {
  await limparDados()
  await encerrarConexoes()
})

async function contarClientes(nome: string): Promise<number> {
  const { rows } = await adminPool.query<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM clientes WHERE tenant_id = $1 AND nome = $2',
    [c.tenant.id, nome],
  )
  return Number(rows[0]?.n ?? 0)
}

describe('cliente com o mesmo documento', () => {
  it('quando dois cadastros iguais passam juntos pela checagem de duplicidade, então um cria (201), o outro recebe 409 e só um cliente existe', async () => {
    const repoReal = criarClienteRepository(db)
    const esperarTodos = criarBarreira(2)
    const clienteRepo = {
      ...repoReal,
      async buscarPorDocumentoHash(tenantId: string, hash: string) {
        const achado = await repoReal.buscarPorDocumentoHash(tenantId, hash)
        await esperarTodos()
        return achado
      },
    }
    const servico = criarClienteService({
      clienteRepo,
      auditoriaService: criarAuditoriaService(criarAuditoriaRepository(db)),
    })
    const dados = {
      tipoPessoa: 'PF' as const,
      nome: 'Cliente Barreira',
      documento: '111.444.777-35',
    }
    const criar = () =>
      statusDe(
        executarComTenant(c.tenant.id, () =>
          servico.criar({ tenantId: c.tenant.id, usuarioId: c.operador.id }, dados),
        ),
      )

    const status = await Promise.all([criar(), criar()])

    expect(status.sort()).toEqual([201, 409])
    expect(await contarClientes('Cliente Barreira')).toBe(1)
  })

  it('quando dois POST /api/clientes iguais chegam ao mesmo tempo, então um responde 201, o outro 409', async () => {
    const corpo = { tipoPessoa: 'PF', nome: 'Cliente Corrida', documento: '529.982.247-25' }
    const criar = () =>
      request(c.app).post('/api/clientes').set('Cookie', c.cookieOperador).send(corpo)

    const [a, b] = await Promise.all([criar(), criar()])

    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect(await contarClientes('Cliente Corrida')).toBe(1)
  })
})
