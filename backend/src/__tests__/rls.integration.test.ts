import type { Express } from 'express'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { criptografar, hashDocumento } from '../lib/crypto.js'

const { Pool } = pg

// -----------------------------------------------------------------------------
// Teste de integração: ativação do RLS por request (RF-002 — tarefa 56)
// -----------------------------------------------------------------------------
//
// Prova, contra um PostgreSQL REAL e usando o papel de aplicação NÃO
// privilegiado (`ni_doc_app`, sem BYPASSRLS e não-owner), que as policies da
// migration 002 isolam os tenants no banco quando o GUC `app.current_tenant` é
// setado pela conexão-por-request (`executarComTenant`). São quatro garantias:
//
//   (a) com o GUC setado, só o tenant corrente enxerga suas linhas;
//   (b) sem o GUC, nenhuma linha retorna;
//   (c) acesso cross-tenant falha no banco mesmo SEM o filtro aplicacional
//       `WHERE tenant_id` (consulta direta sem a cláusula de tenant);
//   (d) acessar recurso de outro tenant resulta em 404 na API (RF-002, crit. 4).
//
// O banco é o serviço do docker-compose (ou um Postgres equivalente com as
// migrations aplicadas e o papel `ni_doc_app` criado). URLs configuráveis por
// ambiente; default aponta para o compose local. Se o banco não estiver
// acessível/preparado, a suíte é PULADA (não quebra o CI unitário sem DB).

const URL_ADMIN =
  process.env['TEST_DATABASE_URL_ADMIN'] ?? 'postgresql://postgres:postgres@localhost:5432/nidoc'
const URL_APP =
  process.env['TEST_DATABASE_URL_APP'] ?? 'postgresql://ni_doc_app:ni_doc_app@localhost:5432/nidoc'

// Dados de duas tenants, com UUIDs aleatórios para não colidir com seed/outras
// execuções e permitir limpeza determinística ao final.
const tenantA = randomUUID()
const tenantB = randomUUID()
const clienteA = randomUUID()
const clienteB = randomUUID()
const usuarioA = randomUUID()
const senhaUsuarioA = 'integ_rls_senha_segura_123'

// Documentos de clientes (não precisam ser CPF/CNPJ válidos — não há validação
// no banco; a validação é aplicacional).
const docA = '111_rls_integ_A'
const docB = '222_rls_integ_B'

/**
 * Verifica se o banco está acessível e preparado (migrations + papel app).
 * Em caso negativo, a suíte é pulada.
 */
async function bancoDisponivel(): Promise<boolean> {
  const pool = new Pool({ connectionString: URL_ADMIN, connectionTimeoutMillis: 2000 })
  try {
    const { rows } = await pool.query<{ ok: boolean }>(
      `SELECT
         EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ni_doc_app')
         AND to_regclass('public.clientes') IS NOT NULL AS ok`,
    )
    return rows[0]?.ok === true
  } catch {
    return false
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const disponivel = await bancoDisponivel()
const descreve = disponivel ? describe : describe.skip

if (!disponivel) {
  // Mensagem visível no output do runner quando a suíte é pulada.
  console.warn(
    `[rls.integration] PostgreSQL real indisponível/não preparado (admin=${URL_ADMIN}). ` +
      'Suíte de integração de RLS pulada. Rode `docker compose up postgres` + `npm run migrate`.',
  )
}

descreve('RLS por request (integração, papel ni_doc_app)', () => {
  // Kysely/app recriados dinamicamente com o env apontando para o papel de
  // aplicação, exercitando o MESMO mecanismo de produção (ConexaoPorRequestDriver
  // + executarComTenant). Importados após ajustar o env (ver beforeAll).
  let db: typeof import('../config/database.js')['db']
  let executarComTenant: typeof import('../config/database.js')['executarComTenant']
  // App + hash de senha dependem de argon2 (binding nativo). Se o binding não
  // puder ser carregado no ambiente, o critério (d) é pulado; (a)(b)(c) — a
  // prova central do RLS no banco — não dependem de argon2 e sempre rodam.
  let app: Express | undefined
  const adminPool = new Pool({ connectionString: URL_ADMIN })

  beforeAll(async () => {
    // Hash de senha é opcional (depende de argon2); carregado dinamicamente para
    // não quebrar a coleta do arquivo em ambientes sem o binding nativo.
    let senhaHashUsuarioA: string | null = null
    try {
      const { hashSenha } = await import('../lib/senha.js')
      senhaHashUsuarioA = await hashSenha(senhaUsuarioA)
    } catch {
      senhaHashUsuarioA = null
    }

    // 1. Semear os dois tenants com o papel PRIVILEGIADO (row_security off),
    //    espelhando o que migrate/seed fazem.
    const client = await adminPool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL row_security = off')

      await client.query(`INSERT INTO tenants (id, nome) VALUES ($1, $2), ($3, $4)`, [
        tenantA,
        'Tenant A (RLS integ)',
        tenantB,
        'Tenant B (RLS integ)',
      ])

      // Usuário do tenant A, para login na checagem de API (critério d). Só
      // inserido quando o hash de senha pôde ser gerado (argon2 disponível).
      if (senhaHashUsuarioA !== null) {
        await client.query(
          `INSERT INTO usuarios (id, tenant_id, nome, email_hash, email_encrypted, senha_hash, papel)
           VALUES ($1, $2, $3, $4, $5, $6, 'operador')`,
          [
            usuarioA,
            tenantA,
            'Operador A',
            hashDocumento(`rls-integ-a-${tenantA}@teste.dev`),
            criptografar(`rls-integ-a-${tenantA}@teste.dev`),
            senhaHashUsuarioA,
          ],
        )
      }

      // Um cliente por tenant.
      await client.query(
        `INSERT INTO clientes (id, tenant_id, tipo_pessoa, nome, documento_hash, documento_encrypted)
         VALUES ($1, $2, 'PF', $3, $4, $5), ($6, $7, 'PF', $8, $9, $10)`,
        [
          clienteA,
          tenantA,
          'Cliente A',
          hashDocumento(docA),
          criptografar(docA),
          clienteB,
          tenantB,
          'Cliente B',
          hashDocumento(docB),
          criptografar(docB),
        ],
      )

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    // 2. Reconfigurar o env para o papel de aplicação e (re)importar os módulos
    //    que leem `env.DATABASE_URL` no load (database.ts, app.ts). A chave de
    //    cripto precisa ser estável entre semeadura e leitura — o setup de teste
    //    já define CRYPTO_KEY/SESSION_SECRET; aqui só trocamos a conexão.
    process.env['DATABASE_URL'] = URL_APP
    process.env['DATABASE_URL_ADMIN'] = URL_ADMIN

    // Força o reimport de database.ts/app.ts para que o pool seja criado com o
    // env recém-ajustado (papel de aplicação), e não com o cache do load inicial
    // (que apontava para a URL de teste do vitest.config). Após o reset, o env é
    // reimportado e seu cache limpo antes de ser lido por database.ts.
    vi.resetModules()
    const envMod = await import('../config/env.js')
    envMod._resetEnvCache()

    const database = await import('../config/database.js')
    db = database.db
    executarComTenant = database.executarComTenant

    // O app importa argon2 (via auth.service → senha.ts); se o binding não
    // carregar, o app fica indisponível e o critério (d) é pulado.
    if (senhaHashUsuarioA !== null) {
      try {
        const appMod = await import('../app.js')
        app = appMod.criarApp()
      } catch {
        app = undefined
      }
    }
  })

  afterAll(async () => {
    // Limpeza determinística pelos UUIDs semeados (ON DELETE CASCADE remove
    // usuários/clientes dos tenants).
    const client = await adminPool.connect()
    try {
      await client.query('SET row_security = off')
      await client.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[tenantA, tenantB]])
    } finally {
      client.release()
      await adminPool.end().catch(() => undefined)
    }
  })

  it('(a) com o GUC setado, só o tenant corrente enxerga suas linhas', async () => {
    const vistosA = await executarComTenant(tenantA, () =>
      db.selectFrom('clientes').select(['id', 'tenant_id']).execute(),
    )
    const idsA = vistosA.map((r) => r.id)
    expect(idsA).toContain(clienteA)
    expect(idsA).not.toContain(clienteB)
    expect(vistosA.every((r) => r.tenant_id === tenantA)).toBe(true)

    const vistosB = await executarComTenant(tenantB, () =>
      db.selectFrom('clientes').select(['id', 'tenant_id']).execute(),
    )
    const idsB = vistosB.map((r) => r.id)
    expect(idsB).toContain(clienteB)
    expect(idsB).not.toContain(clienteA)
  })

  it('(b) sem o GUC setado, nenhuma linha retorna', async () => {
    // Fora de `executarComTenant` não há `app.current_tenant`; a policy compara
    // `tenant_id = NULL` → NULL → linha negada. Nenhuma linha de clientes.
    const linhas = await db.selectFrom('clientes').select('id').execute()
    expect(linhas).toHaveLength(0)
  })

  it('(c) acesso cross-tenant falha no banco mesmo sem o filtro aplicacional', async () => {
    // Consulta o cliente do tenant B pelo id, SEM `WHERE tenant_id` (simula um
    // repositório que esqueceu o filtro). Escopo = tenant A. O RLS barra: a
    // linha de B não é visível.
    const achouBComoA = await executarComTenant(tenantA, () =>
      db.selectFrom('clientes').select('id').where('id', '=', clienteB).executeTakeFirst(),
    )
    expect(achouBComoA).toBeUndefined()

    // E o próprio cliente de A continua visível (sanidade: a query está correta).
    const achouAComoA = await executarComTenant(tenantA, () =>
      db.selectFrom('clientes').select('id').where('id', '=', clienteA).executeTakeFirst(),
    )
    expect(achouAComoA?.id).toBe(clienteA)
  })

  it('(d) acessar recurso de outro tenant resulta em 404 na API', async (contexto) => {
    if (app === undefined) {
      // Ambiente sem argon2 (binding nativo): a API não pôde ser montada.
      // Os critérios (a)(b)(c) já provam o isolamento no banco; (d) é a mesma
      // garantia na borda HTTP e roda em ambiente completo (CI/docker).
      contexto.skip()
      return
    }
    const { default: request } = await import('supertest')

    // Login como operador do tenant A para obter o cookie de sessão.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: `rls-integ-a-${tenantA}@teste.dev`, senha: senhaUsuarioA })
    expect(login.status).toBe(200)

    const setCookie = login.headers['set-cookie'] as string[] | undefined
    expect(setCookie).toBeDefined()
    const cookie: string[] = setCookie ?? []

    // Buscar o cliente do tenant B pela API autenticada como A → 404 (o service
    // recebe null do repositório, pois o RLS esconde a linha de B).
    const resp = await request(app).get(`/api/clientes/${clienteB}`).set('Cookie', cookie)
    expect(resp.status).toBe(404)

    // Sanidade: o cliente do próprio tenant A é acessível (200).
    const respA = await request(app).get(`/api/clientes/${clienteA}`).set('Cookie', cookie)
    expect(respA.status).toBe(200)
    expect(respA.body.id).toBe(clienteA)
  })
})
