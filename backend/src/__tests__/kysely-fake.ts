import {
  Kysely,
  PostgresDialect,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
  type CompiledQuery,
} from 'kysely'
import type { Database } from '../types/database.js'

// -----------------------------------------------------------------------------
// Fake executor do Kysely para testes de repositório que usam `sql`...`.execute(db)`
// (template raw) chamando funções SECURITY DEFINER do Postgres.
//
// Em vez de mockar `db` como objeto literal (`{ insertInto, selectFrom, ... }`),
// que quebra em `sql.execute(db)` porque o literal não tem `getExecutor()`, este
// helper instancia um `Kysely<Database>` REAL sobre um dialeto baseado no
// `PostgresDialect`. Só o DRIVER é falso: o compiler/adapter/introspector reais
// compilam o SQL de verdade, permitindo asserir o SQL e os parâmetros gerados.
//
// Serve tanto para `sql` raw quanto para o builder fluente e para transações
// (`db.transaction().execute(cb)`), roteando o `trx` para o mesmo executor.
// -----------------------------------------------------------------------------

export interface ChamadaSql {
  sql: string
  parameters: readonly unknown[]
}

// `rows` fixo para todas as queries, ou uma função que decide por chamada
// (recebe a query compilada e o índice 0-based da chamada no escopo do fake).
export type RowsResolver =
  | readonly unknown[]
  | ((compiled: CompiledQuery, chamadaIndex: number) => readonly unknown[])

export interface KyselyFake {
  db: Kysely<Database>
  // SQL compilado + parâmetros de cada query executada, na ordem de execução.
  sqlExecutado: ChamadaSql[]
}

export interface CriarKyselyFakeOpts {
  // Linhas devolvidas por `executeQuery`. Default: nenhuma linha (`[]`).
  rows?: RowsResolver
}

class ConexaoFake implements DatabaseConnection {
  constructor(
    private readonly sqlExecutado: ChamadaSql[],
    private readonly rows: RowsResolver,
  ) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const chamadaIndex = this.sqlExecutado.length
    this.sqlExecutado.push({ sql: compiled.sql, parameters: compiled.parameters })

    const rows = typeof this.rows === 'function' ? this.rows(compiled, chamadaIndex) : this.rows

    return { rows: rows as R[] }
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('streamQuery não é suportado no fake de teste')
  }
}

class DriverFake implements Driver {
  constructor(
    private readonly sqlExecutado: ChamadaSql[],
    private readonly rows: RowsResolver,
  ) {}

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new ConexaoFake(this.sqlExecutado, this.rows)
  }

  // Transações reutilizam a mesma conexão fixada (o roteamento para o `trx`
  // acontece pelo próprio Kysely); begin/commit/rollback são no-ops aqui.
  async beginTransaction(): Promise<void> {}
  async commitTransaction(): Promise<void> {}
  async rollbackTransaction(): Promise<void> {}
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
}

/**
 * Cria um `Kysely<Database>` falso cujo driver captura o SQL/parâmetros
 * compilados em `sqlExecutado` e resolve as `rows` conforme `opts`. Mantém o
 * compiler/adapter reais do Postgres, então o SQL gerado é verificável.
 */
export function criarKyselyFake(opts: CriarKyselyFakeOpts = {}): KyselyFake {
  const sqlExecutado: ChamadaSql[] = []
  const rows: RowsResolver = opts.rows ?? []

  const dialetoBase = new PostgresDialect({
    // O pool não é usado: o driver falso nunca delega ao Postgres.
    pool: {} as never,
  })

  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => dialetoBase.createAdapter(),
      createDriver: () => new DriverFake(sqlExecutado, rows),
      createIntrospector: (database) => dialetoBase.createIntrospector(database),
      createQueryCompiler: () => dialetoBase.createQueryCompiler(),
    },
  })

  return { db, sqlExecutado }
}
