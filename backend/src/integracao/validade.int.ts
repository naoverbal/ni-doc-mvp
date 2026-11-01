import request from 'supertest'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { criarExpirarOrcamentosJobPadrao } from '../jobs/expirar-orcamentos.js'
import {
  adminPool,
  contarVersoes,
  criarCenario,
  criarEnviado,
  criarRascunho,
  encerrarConexoes,
  limparDados,
  novoApp,
  statusNoBanco,
  type Cenario,
} from './helpers.js'

// Request specs de validade e expiração automática (RF-009.5):
//   validade = data_emissao + validade_dias; o orçamento vale o dia do vencimento
//   inteiro e expira às 00:00 do dia seguinte, no fuso America/Sao_Paulo.
// Rotas reais, banco real, RLS ativo. O job roda contra o mesmo banco.

afterEach(() => {
  vi.useRealTimers()
})

afterAll(async () => {
  await limparDados()
  await encerrarConexoes()
})

const UA = 'Agente-de-Teste/1.0'

const publico = {
  aprovar: (token: string) =>
    request(novoApp()).post(`/api/publico/orcamento/${token}/aprovar`).set('User-Agent', UA),
  reprovar: (token: string) =>
    request(novoApp())
      .post(`/api/publico/orcamento/${token}/reprovar`)
      .set('User-Agent', UA)
      .send({}),
}

const manual = (c: Cenario, orcamentoId: string) =>
  request(c.app)
    .post(`/api/orcamentos/${orcamentoId}/aceite-manual`)
    .set('Cookie', c.cookieOperador)
    .send({ justificativa: 'Aprovou por telefone' })

/** Oráculo independente: 00:00 (America/Sao_Paulo) do dia seguinte ao vencimento. */
async function expiracaoEsperada(orcamentoId: string): Promise<Date> {
  const { rows } = await adminPool.query<{ expira: Date }>(
    `SELECT ((data_emissao + validade_dias + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo') AS expira
     FROM orcamentos WHERE id = $1`,
    [orcamentoId],
  )
  return (rows[0] as { expira: Date }).expira
}

async function expiraEmDaVersao(orcamentoId: string): Promise<Date | null> {
  const { rows } = await adminPool.query<{ expira_em: Date | null }>(
    'SELECT expira_em FROM orcamento_versoes WHERE orcamento_id = $1 ORDER BY versao DESC LIMIT 1',
    [orcamentoId],
  )
  return rows[0]?.expira_em ?? null
}

/** Recua a emissão e a expiração gravada, simulando um orçamento cuja validade passou. */
async function vencer(orcamentoId: string): Promise<void> {
  await adminPool.query(
    `UPDATE orcamentos SET data_emissao = data_emissao - (validade_dias + 10) WHERE id = $1`,
    [orcamentoId],
  )
  await adminPool.query(
    `UPDATE orcamento_versoes SET expira_em = NOW() - INTERVAL '1 day' WHERE orcamento_id = $1`,
    [orcamentoId],
  )
}

async function contarAuditoria(orcamentoId: string, acao: string): Promise<number> {
  const { rowCount } = await adminPool.query(
    'SELECT 1 FROM eventos_auditoria WHERE entidade_id = $1 AND acao = $2',
    [orcamentoId, acao],
  )
  return rowCount ?? 0
}

describe('validade no envio', () => {
  it('quando o rascunho tem validade vencida, então enviar responde erro e nada é persistido', async () => {
    const c = await criarCenario()
    const rascunho = await criarRascunho(c, { validadeDias: 5 })
    await adminPool.query(`UPDATE orcamentos SET data_emissao = data_emissao - 30 WHERE id = $1`, [
      rascunho.id,
    ])

    const resposta = await request(c.app)
      .post(`/api/orcamentos/${rascunho.id}/enviar`)
      .set('Cookie', c.cookieOperador)

    expect(resposta.status).toBe(400)
    expect(await statusNoBanco(rascunho.id)).toBe('rascunho')
    expect(await contarVersoes(rascunho.id)).toBe(0)
    expect(await contarAuditoria(rascunho.id, 'enviar')).toBe(0)
  })

  it('quando o orçamento é enviado, então expira_em é 00:00 do dia seguinte ao vencimento em America/Sao_Paulo', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c, { validadeDias: 10 })

    const gravado = await expiraEmDaVersao(orcamento.id)

    expect(gravado).not.toBeNull()
    expect((gravado as Date).toISOString()).toBe(
      (await expiracaoEsperada(orcamento.id)).toISOString(),
    )
    // Meia-noite em São Paulo (UTC-3) = 03:00Z.
    expect((gravado as Date).toISOString().slice(11)).toBe('03:00:00.000Z')
  })

  it('quando a validade vence hoje, então ainda é possível enviar (vale o dia inteiro)', async () => {
    const c = await criarCenario()
    const rascunho = await criarRascunho(c, { validadeDias: 5 })
    // Vencimento = hoje (data civil em São Paulo).
    await adminPool.query(
      `UPDATE orcamentos SET data_emissao = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 5
       WHERE id = $1`,
      [rascunho.id],
    )

    const resposta = await request(c.app)
      .post(`/api/orcamentos/${rascunho.id}/enviar`)
      .set('Cookie', c.cookieOperador)

    expect(resposta.status).toBe(201)
  })
})

describe('job de expiração automática', () => {
  it('quando o orçamento enviado atinge a data de validade e o job roda, então vira expirado', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c, { validadeDias: 10 })
    await vencer(orcamento.id)

    const resultado = await criarExpirarOrcamentosJobPadrao().executar()

    expect(resultado.expirados).toContain(orcamento.id)
    expect(await statusNoBanco(orcamento.id)).toBe('expirado')
    expect(await contarAuditoria(orcamento.id, 'expirar')).toBe(1)
    const { rows } = await adminPool.query(
      `SELECT tenant_id, estado_anterior, estado_novo FROM eventos_auditoria
       WHERE entidade_id = $1 AND acao = 'expirar'`,
      [orcamento.id],
    )
    expect(rows[0]).toEqual({
      tenant_id: c.tenant.id,
      estado_anterior: { status: 'enviado' },
      estado_novo: { status: 'expirado' },
    })
  })

  it('quando o relógio do job está 1s antes da expiração, então não expira; no instante exato, expira', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c, { validadeDias: 10 })
    const expira = (await expiraEmDaVersao(orcamento.id)) as Date

    await criarExpirarOrcamentosJobPadrao(() => new Date(expira.getTime() - 1000)).executar()
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')

    await criarExpirarOrcamentosJobPadrao(() => expira).executar()
    expect(await statusNoBanco(orcamento.id)).toBe('expirado')
  })

  it('quando o job roda duas vezes (ou duas instâncias ao mesmo tempo), então a segunda não altera nada e não duplica auditoria', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c, { validadeDias: 10 })
    await vencer(orcamento.id)

    const [a, b] = await Promise.all([
      criarExpirarOrcamentosJobPadrao().executar(),
      criarExpirarOrcamentosJobPadrao().executar(),
    ])
    const marcados = [a, b].filter((r) => r.expirados.includes(orcamento.id))
    expect(marcados).toHaveLength(1)

    const terceira = await criarExpirarOrcamentosJobPadrao().executar()
    expect(terceira.expirados).not.toContain(orcamento.id)
    expect(await statusNoBanco(orcamento.id)).toBe('expirado')
    expect(await contarAuditoria(orcamento.id, 'expirar')).toBe(1)
  })

  it('quando o orçamento aprovado/reprovado passou da validade, então o job não o altera', async () => {
    const c = await criarCenario()
    const aprovado = await criarEnviado(c, { validadeDias: 10 })
    const reprovado = await criarEnviado(c, { validadeDias: 10 })
    expect((await publico.aprovar(aprovado.versao.tokenPublico)).status).toBe(201)
    expect((await publico.reprovar(reprovado.versao.tokenPublico)).status).toBe(201)
    await vencer(aprovado.orcamento.id)
    await vencer(reprovado.orcamento.id)

    const resultado = await criarExpirarOrcamentosJobPadrao().executar()

    expect(resultado.expirados).not.toContain(aprovado.orcamento.id)
    expect(resultado.expirados).not.toContain(reprovado.orcamento.id)
    expect(await statusNoBanco(aprovado.orcamento.id)).toBe('aprovado')
    expect(await statusNoBanco(reprovado.orcamento.id)).toBe('reprovado')
    expect(await contarAuditoria(aprovado.orcamento.id, 'expirar')).toBe(0)
    expect(await contarAuditoria(reprovado.orcamento.id, 'expirar')).toBe(0)
  })
})

describe('decisão no momento do aceite', () => {
  it('quando o orçamento enviado já passou da validade mas o job ainda não rodou, então aprovar e reprovar são recusados', async () => {
    const c = await criarCenario()
    const { orcamento, versao } = await criarEnviado(c, { validadeDias: 10 })
    await vencer(orcamento.id)

    const aprovar = await publico.aprovar(versao.tokenPublico)
    const reprovar = await publico.reprovar(versao.tokenPublico)
    const aceiteManual = await manual(c, orcamento.id)

    expect(aprovar.status).toBe(410)
    expect(reprovar.status).toBe(410)
    expect(aceiteManual.status).toBe(410)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
  })

  it('quando o orçamento está expirado, então aprovar/reprovar pelo cliente e aceite manual são recusados e o status continua expirado', async () => {
    const c = await criarCenario()
    const { orcamento, versao } = await criarEnviado(c, { validadeDias: 10 })
    await vencer(orcamento.id)
    await criarExpirarOrcamentosJobPadrao().executar()
    expect(await statusNoBanco(orcamento.id)).toBe('expirado')
    // Mesmo com a expiração do link "apagada", o status expirado bloqueia a decisão.
    await adminPool.query('UPDATE orcamento_versoes SET expira_em = NULL WHERE orcamento_id = $1', [
      orcamento.id,
    ])

    const aprovar = await publico.aprovar(versao.tokenPublico)
    const reprovar = await publico.reprovar(versao.tokenPublico)
    const aceiteManual = await manual(c, orcamento.id)

    expect(aprovar.status).toBe(410)
    expect(reprovar.status).toBe(410)
    expect(aceiteManual.status).toBe(410)
    expect(await statusNoBanco(orcamento.id)).toBe('expirado')
  })

  it('quando o orçamento está expirado, então editar, excluir e reenviar continuam respondendo 409', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c, { validadeDias: 10 })
    await vencer(orcamento.id)
    await criarExpirarOrcamentosJobPadrao().executar()

    const editar = await request(c.app)
      .put(`/api/orcamentos/${orcamento.id}`)
      .set('Cookie', c.cookieOperador)
      .send({ titulo: 'Tentativa', itens: [{ nome: 'X', quantidade: 1, valorUnitario: 1 }] })
    const excluir = await request(c.app)
      .delete(`/api/orcamentos/${orcamento.id}`)
      .set('Cookie', c.cookieOperador)
    const reenviar = await request(c.app)
      .post(`/api/orcamentos/${orcamento.id}/enviar`)
      .set('Cookie', c.cookieOperador)

    expect(editar.status).toBe(409)
    expect(excluir.status).toBe(409)
    expect(reenviar.status).toBe(409)
    expect(await statusNoBanco(orcamento.id)).toBe('expirado')
  })
})

describe('bordas da expiração (America/Sao_Paulo)', () => {
  it('quando são 23:59:59 do dia do vencimento, então o orçamento ainda é válido e aprovar funciona', async () => {
    const c = await criarCenario()
    const { orcamento, versao } = await criarEnviado(c, { validadeDias: 1 })
    const expira = (await expiraEmDaVersao(orcamento.id)) as Date

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(expira.getTime() - 1000))
    const resposta = await publico.aprovar(versao.tokenPublico)
    vi.useRealTimers()

    expect(resposta.status).toBe(201)
    expect(await statusNoBanco(orcamento.id)).toBe('aprovado')
  })

  it('quando são 00:00:00 do dia seguinte ao vencimento, então o orçamento está expirado (410)', async () => {
    const c = await criarCenario()
    const { orcamento, versao } = await criarEnviado(c, { validadeDias: 1 })
    const expira = (await expiraEmDaVersao(orcamento.id)) as Date

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(expira)
    const resposta = await publico.aprovar(versao.tokenPublico)
    vi.useRealTimers()

    expect(resposta.status).toBe(410)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
  })
})
