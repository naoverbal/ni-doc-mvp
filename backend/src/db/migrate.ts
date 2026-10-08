import pg from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const { Pool } = pg

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) {
  console.error('DATABASE_URL não definido')
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL })

async function runMigrations(): Promise<void> {
  const client = await pool.connect()
  try {
    // Criar tabela de controle de migrations se não existir
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        executado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    // Descobrir diretório das migrations
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const migrationsDir = join(__dirname, 'migrations')

    // Listar arquivos .sql em ordem alfabética
    const allFiles = await readdir(migrationsDir)
    const sqlFiles = allFiles.filter((f) => f.endsWith('.sql')).sort()

    // Buscar migrations já executadas
    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM _migrations ORDER BY filename',
    )
    const executed = new Set(rows.map((r) => r.filename))

    // Executar apenas as pendentes
    for (const filename of sqlFiles) {
      if (executed.has(filename)) {
        console.log(`[skip] ${filename}`)
        continue
      }

      const filePath = join(migrationsDir, filename)
      const sql = await readFile(filePath, 'utf-8')

      console.log(`[run]  ${filename}`)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [filename])
        await client.query('COMMIT')
        console.log(`[ok]   ${filename}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }

    console.log('Migrations concluídas.')
  } finally {
    client.release()
    await pool.end()
  }
}

runMigrations().catch((err: unknown) => {
  console.error('Erro nas migrations:', err)
  process.exit(1)
})
