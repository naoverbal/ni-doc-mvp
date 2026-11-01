import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { emailsEnviados } from './espioes.js'
import {
  adminPool,
  contarAceites,
  criarCenario,
  criarEnviado,
  criarRascunho,
  criarTenant,
  criarUsuario,
  encerrarConexoes,
  entrar,
  limparDados,
  novoApp,
  SENHA_PADRAO,
  statusNoBanco,
  type Cenario,
} from './helpers.js'

// Request specs do cancelamento de orçamento (RF-009):
//   enviado | aprovado -> cancelado, com confirmação de senha + justificativa.
// Rotas reais, banco real, RLS ativo. Só SMTP e Chromium são simulados.

afterAll(async () => {
  await limparDados()
  await encerrarConexoes()
})

const UA = 'Agente-de-Teste/1.0'
const JUSTIFICATIVA = 'Cliente desistiu da contratação'

const publico = {
  aprovar: async (token: string) =>
    request(await novoApp())
      .post(`/api/publico/orcamento/${token}/aprovar`)
      .set('User-Agent', UA),
  reprovar: async (token: string) =>
    request(await novoApp())
      .post(`/api/publico/orcamento/${token}/reprovar`)
      .set('User-Agent', UA)
      .send({}),
}

const cancelar = (
  c: Cenario,
  orcamentoId: string,
  corpo: unknown = { senha: SENHA_PADRAO, justificativa: JUSTIFICATIVA },
  cookie: string[] = c.cookieOperador,
) =>
  request(c.app)
    .post(`/api/orcamentos/${orcamentoId}/cancelar`)
    .set('Cookie', cookie)
    .set('User-Agent', UA)
    .send(corpo as object)

interface EventoAuditoriaLinha {
  usuario_id: string | null
  ip: string | null
  user_agent: string | null
  estado_anterior: Record<string, unknown> | null
  estado_novo: Record<string, unknown> | null
}

async function eventos(orcamentoId: string, acao: string): Promise<EventoAuditoriaLinha[]> {
  const { rows } = await adminPool.query<EventoAuditoriaLinha>(
    `SELECT usuario_id, ip, user_agent, estado_anterior, estado_novo
     FROM eventos_auditoria WHERE entidade_id = $1 AND acao = $2`,
    [orcamentoId, acao],
  )
  return rows
}

describe('POST /api/orcamentos/:id/cancelar — sucesso', () => {
  it('quando admin ou operador do tenant cancela um orçamento enviado com senha correta e justificativa, então responde 200, status vira cancelado e há auditoria', async () => {
    const c = await criarCenario()

    for (const [papel, cookie, usuarioId] of [
      ['operador', c.cookieOperador, c.operador.id],
      ['admin', c.cookieAdmin, c.admin.id],
    ] as const) {
      const { orcamento } = await criarEnviado(c)

      const resposta = await cancelar(
        c,
        orcamento.id,
        { senha: SENHA_PADRAO, justificativa: `  ${JUSTIFICATIVA} (${papel})  ` },
        cookie,
      )

      expect(resposta.status).toBe(200)
      expect(resposta.body.status).toBe('cancelado')
      expect(await statusNoBanco(orcamento.id)).toBe('cancelado')

      const auditoria = await eventos(orcamento.id, 'cancelar')
      expect(auditoria).toHaveLength(1)
      expect(auditoria[0]?.usuario_id).toBe(usuarioId)
      expect(auditoria[0]?.ip).toBeTruthy()
      expect(auditoria[0]?.user_agent).toBe(UA)
      expect(auditoria[0]?.estado_anterior).toMatchObject({ status: 'enviado' })
      expect(auditoria[0]?.estado_novo).toMatchObject({
        status: 'cancelado',
        justificativa: `${JUSTIFICATIVA} (${papel})`,
      })
    }
  })

  it('quando um operador cancela o orçamento criado por outro operador do mesmo tenant, então responde 200', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c) // criado por c.operador
    const outro = await criarUsuario(c.tenant.id, 'operador')
    const cookieOutro = await entrar(outro)

    const resposta = await cancelar(
      c,
      orcamento.id,
      { senha: outro.senha, justificativa: JUSTIFICATIVA },
      cookieOutro,
    )

    expect(resposta.status).toBe(200)
    expect(await statusNoBanco(orcamento.id)).toBe('cancelado')
  })

  it('quando cancela um orçamento aprovado, então o status vira cancelado e o aceite original continua intacto', async () => {
    const c = await criarCenario()
    const { orcamento, versao } = await criarEnviado(c)
    const aprovado = await publico.aprovar(versao.tokenPublico)
    expect(aprovado.status).toBe(201)
    const consultaAceite = () =>
      adminPool.query(
        `SELECT a.id, a.metodo, a.hash_documento, a.criado_em, a.justificativa
         FROM orcamento_aceites a WHERE a.versao_id = $1`,
        [versao.id],
      )
    const antes = await consultaAceite()

    const resposta = await cancelar(c, orcamento.id)

    expect(resposta.status).toBe(200)
    expect(await statusNoBanco(orcamento.id)).toBe('cancelado')
    expect(await contarAceites(orcamento.id)).toBe(1)
    expect((await consultaAceite()).rows).toEqual(antes.rows)
    const auditoria = await eventos(orcamento.id, 'cancelar')
    expect(auditoria[0]?.estado_anterior).toMatchObject({ status: 'aprovado' })
  })

  it('quando o cancelamento é concluído e há e-mail configurado, então notifica o operador responsável sem expor a senha', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c) // criado por c.operador
    emailsEnviados.length = 0

    const resposta = await cancelar(c, orcamento.id, undefined, c.cookieAdmin)

    expect(resposta.status).toBe(200)
    expect(emailsEnviados).toHaveLength(1)
    expect(emailsEnviados[0]?.to).toBe(c.operador.email)
    expect(emailsEnviados[0]?.subject).toContain(orcamento.numero)
    expect(JSON.stringify(emailsEnviados[0])).not.toContain(SENHA_PADRAO)
  })
})

describe('POST /api/orcamentos/:id/cancelar — senha', () => {
  it('quando a senha está errada, então responde 403, o status não muda e a tentativa fica auditada sem a senha', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c)
    const senhaErrada = 'Senha-Errada-999'

    const resposta = await cancelar(c, orcamento.id, {
      senha: senhaErrada,
      justificativa: JUSTIFICATIVA,
    })

    expect(resposta.status).toBe(403)
    expect(JSON.stringify(resposta.body)).not.toContain(senhaErrada)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    expect(await eventos(orcamento.id, 'cancelar')).toHaveLength(0)
    const tentativas = await eventos(orcamento.id, 'cancelar_senha_invalida')
    expect(tentativas).toHaveLength(1)
    expect(tentativas[0]?.usuario_id).toBe(c.operador.id)
    expect(tentativas[0]?.user_agent).toBe(UA)
    expect(JSON.stringify(tentativas[0])).not.toContain(senhaErrada)
  })

  it('quando o usuário erra a senha repetidamente, então a rota passa a responder 429 (limite por usuário)', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c)
    const errada = { senha: 'Senha-Errada-999', justificativa: JUSTIFICATIVA }

    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      statuses.push((await cancelar(c, orcamento.id, errada)).status)
    }
    // Mesmo com a senha certa, a cota esgotada bloqueia.
    const certa = await cancelar(c, orcamento.id)

    expect(statuses).toEqual([403, 403, 403, 403, 403, 429])
    expect(certa.status).toBe(429)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    // O limite é por usuário: o admin do mesmo tenant não é afetado.
    const doAdmin = await cancelar(
      c,
      orcamento.id,
      { senha: c.admin.senha, justificativa: JUSTIFICATIVA },
      c.cookieAdmin,
    )
    expect(doAdmin.status).toBe(200)
  })
})

describe('POST /api/orcamentos/:id/cancelar — validação', () => {
  it('quando falta a justificativa ou ela é só espaços, então responde 400 e nada muda', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c)

    const corpos = [
      { senha: SENHA_PADRAO },
      { senha: SENHA_PADRAO, justificativa: '' },
      { senha: SENHA_PADRAO, justificativa: '    ' },
      { justificativa: JUSTIFICATIVA },
      { senha: SENHA_PADRAO, justificativa: JUSTIFICATIVA, extra: 'x' },
    ]
    for (const corpo of corpos) {
      const resposta = await cancelar(c, orcamento.id, corpo)
      expect(resposta.status).toBe(400)
    }

    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    expect(await eventos(orcamento.id, 'cancelar')).toHaveLength(0)
  })

  it('quando o id é malformado, então responde 400', async () => {
    const c = await criarCenario()
    const resposta = await cancelar(c, 'nao-e-uuid')
    expect(resposta.status).toBe(400)
  })
})

describe('POST /api/orcamentos/:id/cancelar — estados', () => {
  it('quando o orçamento é rascunho, reprovado, expirado ou já cancelado, então responde 409', async () => {
    const c = await criarCenario()

    const rascunho = await criarRascunho(c)

    const { orcamento: reprovado, versao: versaoReprovada } = await criarEnviado(c)
    expect((await publico.reprovar(versaoReprovada.tokenPublico)).status).toBe(201)

    const expirado = (await criarEnviado(c)).orcamento
    await adminPool.query(`UPDATE orcamentos SET status = 'expirado' WHERE id = $1`, [expirado.id])

    const cancelado = (await criarEnviado(c)).orcamento
    expect((await cancelar(c, cancelado.id)).status).toBe(200)

    const casos: [string, string][] = [
      [rascunho.id, 'rascunho'],
      [reprovado.id, 'reprovado'],
      [expirado.id, 'expirado'],
      [cancelado.id, 'cancelado'],
    ]
    for (const [id, statusEsperado] of casos) {
      const resposta = await cancelar(c, id)
      expect(resposta.status, statusEsperado).toBe(409)
      expect(await statusNoBanco(id)).toBe(statusEsperado)
    }
  })

  it('quando dois cancelamentos chegam ao mesmo tempo, então só um vale e o outro responde 409', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c)

    const [a, b] = await Promise.all([cancelar(c, orcamento.id), cancelar(c, orcamento.id)])

    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(await statusNoBanco(orcamento.id)).toBe('cancelado')
    expect(await eventos(orcamento.id, 'cancelar')).toHaveLength(1)
  })
})

describe('POST /api/orcamentos/:id/cancelar — acesso', () => {
  it('quando o usuário é de outro tenant, então responde 404 e o orçamento não muda', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c)
    const outroTenant = await criarTenant()
    const intruso = await criarUsuario(outroTenant.id, 'admin')
    const cookieIntruso = await entrar(intruso)

    const resposta = await cancelar(
      c,
      orcamento.id,
      { senha: intruso.senha, justificativa: JUSTIFICATIVA },
      cookieIntruso,
    )

    expect(resposta.status).toBe(404)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    expect(await eventos(orcamento.id, 'cancelar')).toHaveLength(0)
  })

  it('quando não está autenticado, então responde 401', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c)

    const resposta = await request(await novoApp())
      .post(`/api/orcamentos/${orcamento.id}/cancelar`)
      .send({ senha: SENHA_PADRAO, justificativa: JUSTIFICATIVA })

    expect(resposta.status).toBe(401)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
  })
})

describe('orçamento cancelado — decisões bloqueadas', () => {
  it('quando o cliente tenta aprovar ou reprovar pelo link de um orçamento cancelado, então é recusado', async () => {
    const c = await criarCenario()
    const { orcamento, versao } = await criarEnviado(c)
    expect((await cancelar(c, orcamento.id)).status).toBe(200)

    const aprovar = await publico.aprovar(versao.tokenPublico)
    const reprovar = await publico.reprovar(versao.tokenPublico)

    expect(aprovar.status).toBe(409)
    expect(reprovar.status).toBe(409)
    expect(await statusNoBanco(orcamento.id)).toBe('cancelado')
    expect(await contarAceites(orcamento.id)).toBe(0)
  })

  it('quando o operador tenta o aceite manual de um orçamento cancelado, então é recusado', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c)
    expect((await cancelar(c, orcamento.id)).status).toBe(200)

    const resposta = await request(c.app)
      .post(`/api/orcamentos/${orcamento.id}/aceite-manual`)
      .set('Cookie', c.cookieOperador)
      .send({ justificativa: 'Aprovou por telefone' })

    expect(resposta.status).toBe(409)
    expect(await statusNoBanco(orcamento.id)).toBe('cancelado')
    expect(await contarAceites(orcamento.id)).toBe(0)
  })
})
