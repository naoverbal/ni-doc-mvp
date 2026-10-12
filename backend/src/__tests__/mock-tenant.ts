import type { Kysely } from 'kysely'
import type { Database } from '../types/database.js'

// -----------------------------------------------------------------------------
// Stub de `../config/database.js` para os testes de ROTA.
//
// Os routers de domínio aplicam `setTenant()` (middleware de tenant), que chama
// `executarComTenant(tenantId, fn)` — função que, em produção, fixa uma conexão
// `pg` e roda `set_config('app.current_tenant', ...)`. Sem Postgres no teste,
// essa chamada falha e o errorHandler responde 500.
//
// Este factory, usado via `vi.mock('../../config/database.js', () =>
// fakeDatabaseModule())`, neutraliza APENAS o efeito de I/O do banco:
// `executarComTenant` vira passthrough (executa `fn()` direto, equivalente ao
// caminho "escopo já ativo" de produção), sem tocar no pool. O middleware
// `tenant.ts` real permanece no caminho de teste — ainda exercita a leitura de
// `req.usuario.tenantId` e a propagação do contexto para os services.
//
// NÃO reproduz o comportamento de RLS de produção; serve só para os testes.
// -----------------------------------------------------------------------------
export function fakeDatabaseModule(): {
  executarComTenant: <T>(tenantId: string, fn: () => Promise<T>) => Promise<T>
  db: Kysely<Database>
} {
  return {
    executarComTenant: <T>(_tenantId: string, fn: () => Promise<T>): Promise<T> => fn(),
    // `db` nunca é usado pelos testes de rota (eles injetam services mockados),
    // mas o módulo real o exporta; um stub inócuo satisfaz qualquer import.
    db: {} as Kysely<Database>,
  }
}
