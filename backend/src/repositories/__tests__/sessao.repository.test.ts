import { describe, it, expect, beforeEach, vi } from 'vitest'
import { criarSessaoRepository } from '../sessao.repository.js'
import { criarKyselyFake } from '../../__tests__/kysely-fake.js'

// Os quatro métodos de sessão usam `sql`...`.execute(db)` chamando funções
// SECURITY DEFINER (fluxo de bootstrap, sem tenant no contexto). Por isso o
// mock usa um `Kysely<Database>` real com driver falso (ver kysely-fake.ts), em
// vez de objeto literal: `sql.execute(db)` precisa de um `getExecutor()` real.

const expiraEm = new Date('2024-06-01T20:00:00Z')
const sessaoRow = {
  id: 'sessao-id-1',
  usuario_id: 'user-1',
  expira_em: expiraEm,
  ultima_atividade: new Date('2024-06-01T12:00:00Z'),
}

describe('SessaoRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('criar()', () => {
    it('insere a sessão (rls_criar_sessao) e retorna id e expiraEm', async () => {
      const { db, sqlExecutado } = criarKyselyFake({
        rows: [{ id: 'sessao-id-1', expira_em: expiraEm }],
      })

      const repo = criarSessaoRepository(db)
      const result = await repo.criar({
        usuarioId: 'user-1',
        ip: '10.0.0.1',
        userAgent: 'vitest',
        expiraEm,
      })

      expect(sqlExecutado).toHaveLength(1)
      expect(sqlExecutado[0]?.sql).toContain('rls_criar_sessao')
      expect(sqlExecutado[0]?.parameters).toEqual(['user-1', '10.0.0.1', 'vitest', expiraEm])
      expect(result).toEqual({ id: 'sessao-id-1', expiraEm })
    })

    it('usa null para ip e userAgent ausentes', async () => {
      const { db, sqlExecutado } = criarKyselyFake({
        rows: [{ id: 'sessao-id-2', expira_em: expiraEm }],
      })

      const repo = criarSessaoRepository(db)
      await repo.criar({ usuarioId: 'user-1', expiraEm })

      expect(sqlExecutado[0]?.parameters).toEqual(['user-1', null, null, expiraEm])
    })
  })

  describe('buscarPorId()', () => {
    it('retorna null quando a sessão não existe', async () => {
      const { db } = criarKyselyFake({ rows: [] })

      const repo = criarSessaoRepository(db)
      const result = await repo.buscarPorId('inexistente')

      expect(result).toBeNull()
    })

    it('mapeia a linha (rls_sessao_por_id) para SessaoAtiva', async () => {
      const { db, sqlExecutado } = criarKyselyFake({ rows: [sessaoRow] })

      const repo = criarSessaoRepository(db)
      const result = await repo.buscarPorId('sessao-id-1')

      expect(sqlExecutado[0]?.sql).toContain('rls_sessao_por_id')
      expect(sqlExecutado[0]?.parameters).toEqual(['sessao-id-1'])
      expect(result).toEqual({
        id: 'sessao-id-1',
        usuarioId: 'user-1',
        expiraEm,
        ultimaAtividade: sessaoRow.ultima_atividade,
      })
    })
  })

  describe('invalidar()', () => {
    it('invalida a sessão pelo id (rls_invalidar_sessao)', async () => {
      const { db, sqlExecutado } = criarKyselyFake({ rows: [] })

      const repo = criarSessaoRepository(db)
      await repo.invalidar('sessao-id-1')

      expect(sqlExecutado[0]?.sql).toContain('rls_invalidar_sessao')
      expect(sqlExecutado[0]?.parameters).toEqual(['sessao-id-1'])
    })
  })

  describe('atualizarAtividade()', () => {
    it('atualiza a atividade da sessão (rls_tocar_sessao)', async () => {
      const { db, sqlExecutado } = criarKyselyFake({ rows: [] })

      const repo = criarSessaoRepository(db)
      await repo.atualizarAtividade('sessao-id-1')

      expect(sqlExecutado[0]?.sql).toContain('rls_tocar_sessao')
      expect(sqlExecutado[0]?.parameters).toEqual(['sessao-id-1'])
    })
  })
})
