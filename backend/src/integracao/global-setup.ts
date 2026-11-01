import { execFileSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import pg from 'pg'
import {
  PDFS_DIR_TESTE,
  URL_ADMIN_TESTE,
  garantirBancoDeTeste,
  nomeDoBanco,
} from './config-banco.js'

const { Client } = pg

// Executa uma vez antes de todos os arquivos de integração:
//  1. garante (de novo) que o alvo é um database `*_test`;
//  2. cria o database se não existir;
//  3. aplica as migrations (idempotente, via o mesmo `migrate.ts` do projeto);
//  4. recria o diretório temporário de PDFs.
export async function setup(): Promise<void> {
  garantirBancoDeTeste(URL_ADMIN_TESTE)
  const nome = nomeDoBanco(URL_ADMIN_TESTE)

  const urlServidor = new URL(URL_ADMIN_TESTE)
  urlServidor.pathname = '/postgres'
  const servidor = new Client({ connectionString: urlServidor.toString() })
  try {
    await servidor.connect()
  } catch (erro) {
    throw new Error(
      'PostgreSQL de teste inacessível. Suba o banco com `docker compose up -d postgres` ' +
        `(erro: ${erro instanceof Error ? erro.message : String(erro)}).`,
    )
  }
  try {
    const existe = await servidor.query('SELECT 1 FROM pg_database WHERE datname = $1', [nome])
    if (existe.rowCount === 0) {
      // O nome já foi validado (`*_test`); identificadores não aceitam parâmetro.
      await servidor.query(`CREATE DATABASE "${nome.replace(/"/g, '')}"`)
    }
  } finally {
    await servidor.end()
  }

  execFileSync('npx', ['tsx', 'src/db/migrate.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: URL_ADMIN_TESTE,
      DATABASE_URL_ADMIN: URL_ADMIN_TESTE,
    },
    stdio: 'pipe',
  })

  await limparResiduos()

  await rm(PDFS_DIR_TESTE, { recursive: true, force: true })
  await mkdir(PDFS_DIR_TESTE, { recursive: true })
}

// Remove tenants criados por execuções anteriores que não terminaram a limpeza
// (ex.: processo interrompido). Só atinge nomes gerados pelos helpers
// (`Tenant <uuid>`), nunca os tenants do seed; o banco já foi validado como `*_test`.
async function limparResiduos(): Promise<void> {
  const admin = new Client({ connectionString: URL_ADMIN_TESTE })
  await admin.connect()
  try {
    const { rows } = await admin.query<{ id: string }>(
      `SELECT id FROM tenants WHERE nome ~ '^Tenant [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    )
    const ids = rows.map((r) => r.id)
    if (ids.length > 0) {
      await admin.query('DELETE FROM orcamentos WHERE tenant_id = ANY($1::uuid[])', [ids])
      await admin.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids])
    }
  } finally {
    await admin.end()
  }
}

export async function teardown(): Promise<void> {
  await rm(PDFS_DIR_TESTE, { recursive: true, force: true })
}
