import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Guarda estática (auditoria B-12): migrations rodam em TODO ambiente, inclusive
// produção, então não podem carregar dados de demonstração. Esses dados vivem em
// `seed-dev.sql`, executado só por `npm run seed`.

const dirDb = join(dirname(fileURLToPath(import.meta.url)), '..')
const dirMigrations = join(dirDb, 'migrations')

function migrations(): { nome: string; sql: string }[] {
  return readdirSync(dirMigrations)
    .filter((nome) => nome.endsWith('.sql'))
    .sort()
    .map((nome) => ({ nome, sql: readFileSync(join(dirMigrations, nome), 'utf-8') }))
}

// Remove comentários `--` para não confundir o texto explicativo com SQL.
function semComentarios(sql: string): string {
  return sql
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n')
}

describe('migrations', () => {
  it('quando as migrations são lidas, então nenhuma insere tenants, usuários ou clientes', () => {
    for (const { nome, sql } of migrations()) {
      const codigo = semComentarios(sql)
      expect(codigo, nome).not.toMatch(/INSERT\s+INTO\s+(tenants|usuarios|clientes)\b/i)
    }
  })

  it('quando as migrations são lidas, então nenhuma contém os UUIDs fixos dos tenants de demonstração', () => {
    for (const { nome, sql } of migrations()) {
      expect(semComentarios(sql), nome).not.toMatch(/[ab]0000000-0000-0000-0000-00000000000[12]/)
    }
  })

  it('quando lê a 003, então ela continua existindo (nome registrado em bancos já migrados) e é inócua', () => {
    const tres = migrations().find((m) => m.nome === '003_seed_dev.sql')
    expect(tres).toBeDefined()
    expect(semComentarios(tres?.sql ?? '').trim()).toBe('SELECT 1;')
  })

  it('quando procura o seed de desenvolvimento, então ele existe fora de migrations/ com os tenants de demonstração', () => {
    const caminho = join(dirDb, 'seed-dev.sql')
    expect(existsSync(caminho)).toBe(true)
    expect(readFileSync(caminho, 'utf-8')).toMatch(/INSERT\s+INTO\s+tenants\b/i)
  })
})
