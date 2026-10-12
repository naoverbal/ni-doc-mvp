import { AsyncLocalStorage } from 'node:async_hooks'
import {
  CompiledQuery,
  Kysely,
  PostgresDialect,
  type DatabaseConnection,
  type Driver,
  type TransactionSettings,
} from 'kysely'
import pg from 'pg'
import type { Database } from '../types/database.js'
import { env } from './env.js'

// `pg` é CommonJS: em ESM o export nomeado `Pool` não é detectável.
// Importa o default e desestrutura (mesmo padrão usado em db/seed.ts).
const { Pool } = pg

// -----------------------------------------------------------------------------
// Escopo de conexão por request (ativação do RLS — RF-002)
// -----------------------------------------------------------------------------
//
// O isolamento por tenant no banco depende do GUC `app.current_tenant`, lido
// pelas policies de RLS (migration 002). Para que o valor persista por TODAS as
// queries de um request, elas precisam rodar na MESMA conexão do pool — caso
// contrário o `pg` entrega uma conexão arbitrária a cada statement e o GUC não
// sobrevive à próxima query.
//
// Estratégia:
//   1. Um `AsyncLocalStorage` guarda a conexão fixada do request corrente.
//   2. Um `Driver` customizado devolve essa conexão quando há escopo ativo e
//      não a devolve ao pool a cada query (apenas no fim do escopo).
//   3. `executarComTenant` abre o escopo: fixa uma conexão, roda `set_config`
//      nela e a mantém presa até o fim do request.
//
// Com isso os repositórios NÃO mudam: continuam recebendo o `db` global, mas as
// queries herdam a conexão/tenant do request de forma transparente, e o filtro
// aplicacional `WHERE tenant_id` permanece como defesa em profundidade.

const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 })

interface EscopoRequest {
  conexao: DatabaseConnection
}

const armazenamentoConexao = new AsyncLocalStorage<EscopoRequest>()

/**
 * Driver que embrulha o `PostgresDialect`. Quando há um escopo de request ativo
 * (`armazenamentoConexao`), `acquireConnection` retorna a conexão fixada do
 * escopo e `releaseConnection` vira no-op para essa conexão — a liberação real
 * acontece no fim do escopo (`executarComTenant`). Fora de escopo, delega
 * integralmente ao driver interno (comportamento normal de pool).
 */
class ConexaoPorRequestDriver implements Driver {
  constructor(private readonly interno: Driver) {}

  async init(): Promise<void> {
    await this.interno.init()
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const escopo = armazenamentoConexao.getStore()
    if (escopo) {
      return escopo.conexao
    }
    return this.interno.acquireConnection()
  }

  async beginTransaction(
    connection: DatabaseConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    await this.interno.beginTransaction(connection, settings)
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await this.interno.commitTransaction(connection)
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await this.interno.rollbackTransaction(connection)
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    const escopo = armazenamentoConexao.getStore()
    if (escopo && escopo.conexao === connection) {
      return
    }
    await this.interno.releaseConnection(connection)
  }

  async destroy(): Promise<void> {
    await this.interno.destroy()
  }
}

const dialetoBase = new PostgresDialect({ pool })
const driverInterno = dialetoBase.createDriver()
const driverPorRequest = new ConexaoPorRequestDriver(driverInterno)

export const db = new Kysely<Database>({
  dialect: {
    createAdapter: () => dialetoBase.createAdapter(),
    createDriver: () => driverPorRequest,
    createIntrospector: (database) => dialetoBase.createIntrospector(database),
    createQueryCompiler: () => dialetoBase.createQueryCompiler(),
  },
})

/**
 * Fixa uma conexão para o escopo de `fn`, define `app.current_tenant = tenantId`
 * nessa conexão e executa `fn`. Todas as queries disparadas por `db` dentro de
 * `fn` (direta ou indiretamente, via repositórios) usam a MESMA conexão, com o
 * GUC ativo — habilitando as policies de RLS a filtrarem por tenant no banco.
 *
 * O GUC é aplicado com escopo de sessão (`is_local = false`) na conexão
 * dedicada do request e revertido no fim do escopo, antes de devolver a conexão
 * ao pool — evitando vazamento de tenant entre requests que reaproveitem a
 * mesma conexão física.
 */
export async function executarComTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  // Reentrância: se já existe um escopo ativo (ex.: request de domínio que já
  // passou pelo `setTenant`), reaproveita-o em vez de fixar outra conexão — o
  // GUC já está definido. Evita escopos aninhados com conexões divergentes.
  if (armazenamentoConexao.getStore()) {
    return fn()
  }

  await driverInterno.init()
  const conexao = await driverInterno.acquireConnection()

  try {
    await conexao.executeQuery(
      CompiledQuery.raw("SELECT set_config('app.current_tenant', $1, false)", [tenantId]),
    )

    return await armazenamentoConexao.run({ conexao }, fn)
  } finally {
    // Reseta o GUC antes de devolver a conexão ao pool (defesa contra reuso).
    try {
      await conexao.executeQuery(CompiledQuery.raw('RESET app.current_tenant'))
    } finally {
      await driverInterno.releaseConnection(conexao)
    }
  }
}
