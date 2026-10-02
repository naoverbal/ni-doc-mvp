import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { Database } from '../types/database.js'
import { env } from './env.js'

const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 })
export const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
