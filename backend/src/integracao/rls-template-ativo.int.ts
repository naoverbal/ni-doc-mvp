import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { URL_APP_TESTE } from './config-banco.js'
import {
  adminPool,
  criarTenant,
  encerrarConexoes,
  limparDados,
  type TenantCriado,
} from './helpers.js'

const { Pool } = pg

// RLS de tenants_template_ativo (achado B-2). Usa o papel de aplicação (sem
// BYPASSRLS) direto no banco, SEM filtro `WHERE tenant_id`, para provar que o
// isolamento vale no banco e não só na aplicação.
const appPool = new Pool({ connectionString: URL_APP_TESTE, max: 2 })

let a: TenantCriado
let b: TenantCriado

beforeAll(async () => {
  a = await criarTenant()
  b = await criarTenant()
})

afterAll(async () => {
  await limparDados()
  await appPool.end()
  await encerrarConexoes()
})

// Executa `fn` numa transação do papel de aplicação, com (ou sem) tenant no GUC.
async function comTenant<T>(
  tenantId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect()
  try {
    await client.query('BEGIN')
    if (tenantId !== null) {
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId])
    }
    const resultado = await fn(client)
    await client.query('ROLLBACK')
    return resultado
  } finally {
    client.release()
  }
}

describe('RLS em tenants_template_ativo', () => {
  it('quando consulta o catálogo, então a tabela tem RLS habilitado e forçado', async () => {
    const { rows } = await adminPool.query<{ ligado: boolean; forcado: boolean }>(
      `SELECT relrowsecurity AS ligado, relforcerowsecurity AS forcado
       FROM pg_class WHERE oid = 'public.tenants_template_ativo'::regclass`,
    )
    expect(rows[0]).toEqual({ ligado: true, forcado: true })
  })

  it('quando o tenant A consulta sem filtro, então só enxerga o próprio template ativo', async () => {
    const linhas = await comTenant(a.id, async (c) => {
      const r = await c.query<{ tenant_id: string }>('SELECT tenant_id FROM tenants_template_ativo')
      return r.rows
    })
    const ids = linhas.map((l) => l.tenant_id)
    expect(ids).toContain(a.id)
    expect(ids).not.toContain(b.id)
  })

  it('quando não há tenant no contexto, então nenhuma linha retorna', async () => {
    const linhas = await comTenant(null, async (c) => {
      const r = await c.query('SELECT 1 FROM tenants_template_ativo')
      return r.rows
    })
    expect(linhas).toHaveLength(0)
  })

  it('quando o tenant A tenta reapontar o template do tenant B, então nada é alterado', async () => {
    const afetadas = await comTenant(a.id, async (c) => {
      const r = await c.query(
        'UPDATE tenants_template_ativo SET template_id = $1 WHERE tenant_id = $2',
        [a.templateId, b.id],
      )
      return r.rowCount
    })
    expect(afetadas).toBe(0)
    const { rows } = await adminPool.query<{ template_id: string }>(
      'SELECT template_id FROM tenants_template_ativo WHERE tenant_id = $1',
      [b.id],
    )
    expect(rows[0]?.template_id).toBe(b.templateId)
  })

  it('quando o tenant A tenta inserir linha para o tenant B, então o banco rejeita', async () => {
    const novo = await criarTenant({ comTemplate: false })
    await expect(
      comTenant(a.id, (c) =>
        c.query('INSERT INTO tenants_template_ativo (tenant_id, template_id) VALUES ($1, $2)', [
          novo.id,
          a.templateId,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i)
  })
})
