import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { URL_ADMIN_TESTE, URL_APP_TESTE, garantirBancoDeTeste } from './config-banco.js'
import { adminPool, encerrarConexoes, removerTenants } from './helpers.js'

// `npm run seed` (achado B-12): os dados de demonstração saíram das migrations e
// agora só o seed os cria. Roda o script de verdade contra o banco de teste e
// limpa os tenants de demonstração ao final, para não afetar as demais suítes.

const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const BETA = 'b0000000-0000-0000-0000-000000000002'

function rodarSeed(): void {
  garantirBancoDeTeste(URL_ADMIN_TESTE)
  execFileSync('npx', ['tsx', 'src/db/seed.ts'], {
    env: {
      ...process.env,
      DATABASE_URL: URL_APP_TESTE,
      DATABASE_URL_ADMIN: URL_ADMIN_TESTE,
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  })
}

async function contagens(): Promise<Record<string, number>> {
  const consulta = async (sql: string): Promise<number> => {
    const { rows } = await adminPool.query<{ n: string }>(sql, [[ALPHA, BETA]])
    return Number(rows[0]?.n ?? 0)
  }
  return {
    tenants: await consulta('SELECT COUNT(*)::text AS n FROM tenants WHERE id = ANY($1::uuid[])'),
    usuarios: await consulta(
      'SELECT COUNT(*)::text AS n FROM usuarios WHERE tenant_id = ANY($1::uuid[])',
    ),
    responsaveis: await consulta(
      'SELECT COUNT(*)::text AS n FROM responsaveis_tecnicos WHERE tenant_id = ANY($1::uuid[])',
    ),
    templatesAtivos: await consulta(
      'SELECT COUNT(*)::text AS n FROM tenants_template_ativo WHERE tenant_id = ANY($1::uuid[])',
    ),
    clientes: await consulta(
      'SELECT COUNT(*)::text AS n FROM clientes WHERE tenant_id = ANY($1::uuid[])',
    ),
    orcamentos: await consulta(
      'SELECT COUNT(*)::text AS n FROM orcamentos WHERE tenant_id = ANY($1::uuid[])',
    ),
  }
}

beforeAll(async () => {
  await removerTenants(adminPool, [ALPHA, BETA])
})

afterAll(async () => {
  await removerTenants(adminPool, [ALPHA, BETA])
  await encerrarConexoes()
})

describe('seed de desenvolvimento (npm run seed)', () => {
  it('quando o seed roda, então cria os tenants Alpha e Beta, os 4 usuários e os dados de demonstração', async () => {
    rodarSeed()

    const primeira = await contagens()

    expect(primeira['tenants']).toBe(2)
    expect(primeira['usuarios']).toBe(4)
    expect(primeira['responsaveis']).toBe(4)
    expect(primeira['templatesAtivos']).toBe(2)
    expect(primeira['clientes']).toBeGreaterThan(0)
    expect(primeira['orcamentos']).toBeGreaterThan(0)
  })

  it('quando o seed roda duas vezes, então não duplica nada', async () => {
    const antes = await contagens()

    rodarSeed()

    expect(await contagens()).toEqual(antes)
  })
})
