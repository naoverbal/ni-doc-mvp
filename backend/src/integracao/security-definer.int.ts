import { afterAll, describe, expect, it } from 'vitest'
import { adminPool, encerrarConexoes } from './helpers.js'

// Hardening das funções SECURITY DEFINER (achado B-7): todas devem ter
// search_path fixo e manter row_security desligado (o contorno de RLS dos
// lookups de credencial depende disso).

afterAll(async () => {
  await encerrarConexoes()
})

interface FuncaoDefiner {
  nome: string
  config: string[] | null
}

async function funcoesDefiner(): Promise<FuncaoDefiner[]> {
  const { rows } = await adminPool.query<FuncaoDefiner>(
    `SELECT p.proname AS nome, p.proconfig AS config
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
     ORDER BY p.proname`,
  )
  return rows
}

describe('funções SECURITY DEFINER', () => {
  it('quando lista as funções do schema public, então existem as 10 esperadas', async () => {
    const nomes = (await funcoesDefiner()).map((f) => f.nome)
    expect(nomes).toEqual([
      'rls_criar_sessao',
      'rls_expirar_orcamentos_vencidos',
      'rls_invalidar_sessao',
      'rls_limpar_sessoes_expiradas',
      'rls_listar_pdfs_expirados',
      'rls_sessao_por_id',
      'rls_tocar_sessao',
      'rls_usuario_por_email_hash',
      'rls_usuario_por_id',
      'rls_versao_por_token',
    ])
  })

  it('quando inspeciona a configuração, então todas fixam search_path com pg_temp por último', async () => {
    for (const funcao of await funcoesDefiner()) {
      expect(funcao.config, funcao.nome).toContain('search_path=public, pg_temp')
    }
  })

  it('quando inspeciona a configuração, então todas mantêm row_security desligado', async () => {
    for (const funcao of await funcoesDefiner()) {
      expect(funcao.config, funcao.nome).toContain('row_security=off')
    }
  })
})
