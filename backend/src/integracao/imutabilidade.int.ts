import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { URL_APP_TESTE } from './config-banco.js'
import {
  criarCenario,
  criarEnviado,
  encerrarConexoes,
  limparDados,
  type Cenario,
  type VersaoCriada,
} from './helpers.js'

const { Pool } = pg

// Imutabilidade dos registros probatórios (achado B-3). Usa o papel de
// aplicação (sem superusuário) direto no banco: os privilégios é que impedem a
// reescrita, não o código da aplicação.
const appPool = new Pool({ connectionString: URL_APP_TESTE, max: 2 })

let a: Cenario
let versao: VersaoCriada

beforeAll(async () => {
  a = await criarCenario()
  versao = (await criarEnviado(a)).versao
})

afterAll(async () => {
  await limparDados()
  await appPool.end()
  await encerrarConexoes()
})

// Roda a query numa transação do papel de aplicação, com o tenant no contexto, e
// sempre desfaz (nada persiste).
async function comoApp(sql: string, params: unknown[] = []): Promise<pg.QueryResult> {
  const client = await appPool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [a.tenant.id])
    return await client.query(sql, params)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
}

const PERMISSAO_NEGADA = /permission denied/i

describe('imutabilidade de eventos_auditoria', () => {
  it('quando o app tenta alterar a auditoria, então o banco nega', async () => {
    await expect(comoApp("UPDATE eventos_auditoria SET acao = 'adulterada'")).rejects.toThrow(
      PERMISSAO_NEGADA,
    )
  })

  it('quando o app tenta apagar a auditoria, então o banco nega', async () => {
    await expect(comoApp('DELETE FROM eventos_auditoria')).rejects.toThrow(PERMISSAO_NEGADA)
  })

  it('quando o app lê a auditoria, então continua permitido', async () => {
    const r = await comoApp('SELECT 1 FROM eventos_auditoria LIMIT 1')
    expect(r.rowCount).toBeGreaterThan(0)
  })
})

describe('imutabilidade de orcamento_aceites', () => {
  it('quando o app tenta alterar um aceite, então o banco nega', async () => {
    await expect(comoApp("UPDATE orcamento_aceites SET justificativa = 'x'")).rejects.toThrow(
      PERMISSAO_NEGADA,
    )
  })

  it('quando o app tenta apagar um aceite, então o banco nega', async () => {
    await expect(comoApp('DELETE FROM orcamento_aceites')).rejects.toThrow(PERMISSAO_NEGADA)
  })
})

describe('imutabilidade de orcamento_versoes', () => {
  it('quando o app tenta apagar uma versão, então o banco nega', async () => {
    await expect(
      comoApp('DELETE FROM orcamento_versoes WHERE id = $1', [versao.id]),
    ).rejects.toThrow(PERMISSAO_NEGADA)
  })

  it('quando o app tenta trocar o snapshot ou o token, então o banco nega', async () => {
    await expect(
      comoApp(`UPDATE orcamento_versoes SET snapshot = '{}'::jsonb WHERE id = $1`, [versao.id]),
    ).rejects.toThrow(PERMISSAO_NEGADA)
    await expect(
      comoApp(`UPDATE orcamento_versoes SET token_publico = 'forjado' WHERE id = $1`, [versao.id]),
    ).rejects.toThrow(PERMISSAO_NEGADA)
  })

  it('quando o app limpa pdf_path e pdf_hash (job de limpeza), então continua permitido', async () => {
    const r = await comoApp(
      'UPDATE orcamento_versoes SET pdf_path = NULL, pdf_hash = NULL WHERE id = $1',
      [versao.id],
    )
    expect(r.rowCount).toBe(1)
  })
})
