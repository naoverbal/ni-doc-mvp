import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from '../types/database.js'
import { env } from './env.js'

// `pg` é CommonJS: em ESM o export nomeado `Pool` não é detectável.
// Importa o default e desestrutura (mesmo padrão usado em db/seed.ts).
const { Pool } = pg

const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 })
export const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
