import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import {
  adminPool,
  contarAceites,
  contarVersoes,
  corpoOrcamento,
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
  type OrcamentoCriado,
  type VersaoCriada,
} from './helpers.js'

// Request specs da reabertura de orçamento (RF-008, RF-009, RF-019):
//   reprovado | cancelado | expirado -> rascunho; a versão N+1 nasce no /enviar.
// E da exclusão do rascunho reaberto, que NUNCA apaga o histórico: o orçamento
// volta ao último status com o conteúdo da última versão enviada.
// Rotas reais, banco real, RLS ativo. Só SMTP e Chromium são simulados.

afterAll(async () => {
  await limparDados()
  await encerrarConexoes()
})

const UA = 'Agente-de-Teste/1.0'
const JUSTIFICATIVA = 'Cliente pediu nova proposta'

type StatusOrigem = 'reprovado' | 'cancelado' | 'expirado'

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

const reabrir = (
  c: Cenario,
  orcamentoId: string,
  corpo: unknown = { senha: SENHA_PADRAO, justificativa: JUSTIFICATIVA },
  cookie: string[] = c.cookieOperador,
) =>
  request(c.app)
    .post(`/api/orcamentos/${orcamentoId}/reabrir`)
    .set('Cookie', cookie)
    .set('User-Agent', UA)
    .send(corpo as object)

const enviar = (c: Cenario, orcamentoId: string) =>
  request(c.app).post(`/api/orcamentos/${orcamentoId}/enviar`).set('Cookie', c.cookieOperador)

const excluir = (c: Cenario, orcamentoId: string) =>
  request(c.app)
    .delete(`/api/orcamentos/${orcamentoId}`)
    .set('Cookie', c.cookieOperador)
    .set('User-Agent', UA)

const editar = (c: Cenario, orcamentoId: string, corpo: Record<string, unknown>) =>
  request(c.app).put(`/api/orcamentos/${orcamentoId}`).set('Cookie', c.cookieOperador).send(corpo)

const detalhe = (c: Cenario, orcamentoId: string) =>
  request(c.app).get(`/api/orcamentos/${orcamentoId}`).set('Cookie', c.cookieOperador)

/** Leva um orçamento recém-enviado até o status de origem pedido. */
async function levarAte(
  c: Cenario,
  origem: StatusOrigem,
): Promise<{ orcamento: OrcamentoCriado; versao: VersaoCriada }> {
  const enviado = await criarEnviado(c)
  const { orcamento, versao } = enviado
  if (origem === 'reprovado') {
    expect((await publico.reprovar(versao.tokenPublico)).status).toBe(201)
  } else if (origem === 'cancelado') {
    const r = await request(c.app)
      .post(`/api/orcamentos/${orcamento.id}/cancelar`)
      .set('Cookie', c.cookieOperador)
      .send({ senha: SENHA_PADRAO, justificativa: 'Teste' })
    expect(r.status).toBe(200)
  } else {
    await adminPool.query(
      `UPDATE orcamentos SET status = 'expirado', data_emissao = '2020-01-01' WHERE id = $1`,
      [orcamento.id],
    )
  }
  expect(await statusNoBanco(orcamento.id)).toBe(origem)
  return enviado
}

interface EventoAuditoriaLinha {
  usuario_id: string | null
  user_agent: string | null
  estado_anterior: Record<string, unknown> | null
  estado_novo: Record<string, unknown> | null
}

async function eventos(orcamentoId: string, acao: string): Promise<EventoAuditoriaLinha[]> {
  const { rows } = await adminPool.query<EventoAuditoriaLinha>(
    `SELECT usuario_id, user_agent, estado_anterior, estado_novo
     FROM eventos_auditoria WHERE entidade_id = $1 AND acao = $2`,
    [orcamentoId, acao],
  )
  return rows
}

/** Fotografia do histórico (versões + aceites) para provar que nada muda. */
async function historico(orcamentoId: string): Promise<unknown> {
  const versoes = await adminPool.query(
    `SELECT id, versao, snapshot, template_id, pdf_path, pdf_hash, token_publico, enviado_em, expira_em
     FROM orcamento_versoes WHERE orcamento_id = $1 ORDER BY versao`,
    [orcamentoId],
  )
  const aceites = await adminPool.query(
    `SELECT a.id, a.versao_id, a.metodo, a.hash_documento, a.criado_em, a.justificativa
     FROM orcamento_aceites a JOIN orcamento_versoes v ON v.id = a.versao_id
     WHERE v.orcamento_id = $1 ORDER BY v.versao`,
    [orcamentoId],
  )
  return { versoes: versoes.rows, aceites: aceites.rows }
}

async function colunasDoOrcamento(orcamentoId: string): Promise<{
  status: string
  status_reaberto_de: string | null
  data_emissao: string
  validade_dias: number
  versao_atual: number
}> {
  const { rows } = await adminPool.query(
    `SELECT status, status_reaberto_de, to_char(data_emissao, 'YYYY-MM-DD') AS data_emissao,
            validade_dias, versao_atual
     FROM orcamentos WHERE id = $1`,
    [orcamentoId],
  )
  return rows[0]
}

describe('POST /api/orcamentos/:id/reabrir — sucesso', () => {
  it.each(['reprovado', 'cancelado', 'expirado'] as const)(
    'quando admin ou operador do tenant reabre um orçamento %s com senha correta e justificativa, então responde 200, o status vira rascunho e há auditoria com a justificativa',
    async (origem) => {
      const c = await criarCenario()

      for (const [cookie, usuarioId] of [
        [c.cookieOperador, c.operador.id],
        [c.cookieAdmin, c.admin.id],
      ] as const) {
        const { orcamento } = await levarAte(c, origem)

        const resposta = await reabrir(
          c,
          orcamento.id,
          { senha: SENHA_PADRAO, justificativa: `  ${JUSTIFICATIVA}  ` },
          cookie,
        )

        expect(resposta.status).toBe(200)
        expect(resposta.body.status).toBe('rascunho')
        expect(await statusNoBanco(orcamento.id)).toBe('rascunho')
        expect((await colunasDoOrcamento(orcamento.id)).status_reaberto_de).toBe(origem)

        const auditoria = await eventos(orcamento.id, 'reabrir')
        expect(auditoria).toHaveLength(1)
        expect(auditoria[0]?.usuario_id).toBe(usuarioId)
        expect(auditoria[0]?.user_agent).toBe(UA)
        expect(auditoria[0]?.estado_anterior).toMatchObject({ status: origem })
        expect(auditoria[0]?.estado_novo).toMatchObject({
          status: 'rascunho',
          justificativa: JUSTIFICATIVA,
        })
      }
    },
  )

  it('quando um operador reabre o orçamento criado por outro operador do mesmo tenant, então responde 200', async () => {
    const c = await criarCenario()
    const { orcamento } = await levarAte(c, 'reprovado') // criado por c.operador
    const outro = await criarUsuario(c.tenant.id, 'operador')
    const cookieOutro = await entrar(outro)

    const resposta = await reabrir(
      c,
      orcamento.id,
      { senha: outro.senha, justificativa: JUSTIFICATIVA },
      cookieOutro,
    )

    expect(resposta.status).toBe(200)
    expect(await statusNoBanco(orcamento.id)).toBe('rascunho')
  })

  it('quando reabre, então a reabertura não cria versão e o histórico fica intacto', async () => {
    const c = await criarCenario()
    const { orcamento } = await levarAte(c, 'reprovado')
    const antes = await historico(orcamento.id)

    expect((await reabrir(c, orcamento.id)).status).toBe(200)

    expect(await historico(orcamento.id)).toEqual(antes)
    expect(await contarVersoes(orcamento.id)).toBe(1)
  })

  it('quando um orçamento expirado é reaberto, então a validade é renovada e o reenvio é aceito', async () => {
    const c = await criarCenario()
    const { orcamento } = await levarAte(c, 'expirado') // data_emissao em 2020
    const validadeAntes = (await colunasDoOrcamento(orcamento.id)).validade_dias

    // Sem reabrir, nem existe caminho de reenvio (expirado não é rascunho).
    expect((await enviar(c, orcamento.id)).status).toBe(409)
    expect((await reabrir(c, orcamento.id)).status).toBe(200)

    const colunas = await colunasDoOrcamento(orcamento.id)
    expect(colunas.data_emissao).not.toBe('2020-01-01')
    expect(colunas.data_emissao >= '2026-01-01').toBe(true)
    expect(colunas.validade_dias).toBe(validadeAntes)

    const reenvio = await enviar(c, orcamento.id)
    expect(reenvio.status).toBe(201)
    expect(reenvio.body.versao).toBe(2)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
  })
})

describe('reenvio de um orçamento reaberto', () => {
  it('quando o orçamento reaberto é enviado, então cria a versão N+1, a v1 (PDF e aceite) continua imutável e o token antigo não permite mais decidir', async () => {
    const c = await criarCenario()
    const { orcamento, versao: v1 } = await levarAte(c, 'reprovado')
    expect(await contarAceites(orcamento.id)).toBe(1) // a reprovação da v1
    const antes = await historico(orcamento.id)
    expect((await reabrir(c, orcamento.id)).status).toBe(200)

    // Reaberto (rascunho): o link antigo não decide.
    expect((await publico.aprovar(v1.tokenPublico)).status).toBe(409)

    const reenvio = await enviar(c, orcamento.id)

    expect(reenvio.status).toBe(201)
    expect(reenvio.body.versao).toBe(2)
    expect(reenvio.body.tokenPublico).not.toBe(v1.tokenPublico)
    expect(reenvio.body.pdfHash).toEqual(expect.any(String))
    expect(await contarVersoes(orcamento.id)).toBe(2)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    const colunas = await colunasDoOrcamento(orcamento.id)
    expect(colunas.versao_atual).toBe(2)
    expect(colunas.status_reaberto_de).toBeNull()

    // v1 e o aceite da v1 continuam exatamente como estavam.
    const depois = (await historico(orcamento.id)) as {
      versoes: unknown[]
      aceites: unknown[]
    }
    expect(depois.versoes[0]).toEqual((antes as { versoes: unknown[] }).versoes[0])
    expect(depois.aceites).toEqual((antes as { aceites: unknown[] }).aceites)

    // O token antigo (v1) não decide mais, nem aprovando nem reprovando.
    expect((await publico.aprovar(v1.tokenPublico)).status).toBe(409)
    expect((await publico.reprovar(v1.tokenPublico)).status).toBe(409)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    expect(await contarAceites(orcamento.id)).toBe(1)
  })

  it('quando o orçamento reaberto é aprovado pelo novo link, então o status vira aprovado e o aceite fica ligado à nova versão', async () => {
    const c = await criarCenario()
    const { orcamento } = await levarAte(c, 'cancelado')
    expect((await reabrir(c, orcamento.id)).status).toBe(200)
    const reenvio = await enviar(c, orcamento.id)
    expect(reenvio.status).toBe(201)

    const resposta = await publico.aprovar(reenvio.body.tokenPublico)

    expect(resposta.status).toBe(201)
    expect(await statusNoBanco(orcamento.id)).toBe('aprovado')
    const { rows } = await adminPool.query(
      `SELECT a.versao_id FROM orcamento_aceites a
       JOIN orcamento_versoes v ON v.id = a.versao_id WHERE v.orcamento_id = $1`,
      [orcamento.id],
    )
    expect(rows).toEqual([{ versao_id: reenvio.body.id }])
  })
})

describe('excluir rascunho reaberto', () => {
  it.each(['reprovado', 'cancelado', 'expirado'] as const)(
    'quando exclui um rascunho reaberto de um orçamento %s, então o orçamento volta ao último status, todas as versões, PDFs e aceites continuam no banco e há auditoria da exclusão',
    async (origem) => {
      const c = await criarCenario()
      const { orcamento } = await levarAte(c, origem)
      const antes = await historico(orcamento.id)
      expect((await reabrir(c, orcamento.id)).status).toBe(200)

      const resposta = await excluir(c, orcamento.id)

      expect(resposta.status).toBe(200)
      expect(resposta.body.status).toBe(origem)
      expect(resposta.body.id).toBe(orcamento.id)
      expect(await statusNoBanco(orcamento.id)).toBe(origem)
      expect(await historico(orcamento.id)).toEqual(antes)
      const colunas = await colunasDoOrcamento(orcamento.id)
      expect(colunas.status_reaberto_de).toBeNull()
      // Data de emissão restaurada para a do snapshot da versão enviada.
      const { snapshot } = (antes as { versoes: { snapshot: { data_emissao: string } }[] })
        .versoes[0]!
      expect(colunas.data_emissao).toBe(snapshot.data_emissao)

      const auditoria = await eventos(orcamento.id, 'descartar_reabertura')
      expect(auditoria).toHaveLength(1)
      expect(auditoria[0]?.usuario_id).toBe(c.operador.id)
      expect(auditoria[0]?.user_agent).toBe(UA)
      expect(auditoria[0]?.estado_novo).toMatchObject({ status: origem })
    },
  )

  it('quando exclui um rascunho reaberto depois de editá-lo, então o conteúdo volta ao da última versão enviada', async () => {
    const c = await criarCenario()
    const { orcamento } = await levarAte(c, 'reprovado')
    const original = (await detalhe(c, orcamento.id)).body
    expect((await reabrir(c, orcamento.id)).status).toBe(200)

    const edicao = await editar(
      c,
      orcamento.id,
      corpoOrcamento(c.cliente.id, {
        titulo: 'Título editado no rascunho',
        descricao: 'Descrição nova',
        validadeDias: 5,
        itens: [
          { nome: 'Item novo 1', quantidade: 3, valorUnitario: 10 },
          { nome: 'Item novo 2', quantidade: 1, valorUnitario: 7 },
        ],
        condicoesPagamento: [{ descricao: 'À vista', percentual: 100, formaPagamento: 'PIX' }],
      }),
    )
    expect(edicao.status).toBe(200)
    expect(edicao.body.total).not.toBe(original.total)

    const resposta = await excluir(c, orcamento.id)

    expect(resposta.status).toBe(200)
    const restaurado = (await detalhe(c, orcamento.id)).body
    expect(restaurado.status).toBe('reprovado')
    expect(restaurado.titulo).toBe(original.titulo)
    expect(restaurado.descricao).toBe(original.descricao)
    expect(restaurado.validadeDias).toBe(original.validadeDias)
    expect(restaurado.subtotal).toBe(original.subtotal)
    expect(restaurado.total).toBe(original.total)
    expect(restaurado.condicoesPagamento).toEqual([])
    expect(
      restaurado.itens.map((i: { nome: string; quantidade: number; valorUnitario: number }) => [
        i.nome,
        i.quantidade,
        i.valorUnitario,
      ]),
    ).toEqual(
      original.itens.map((i: { nome: string; quantidade: number; valorUnitario: number }) => [
        i.nome,
        i.quantidade,
        i.valorUnitario,
      ]),
    )
  })

  it('quando exclui um rascunho que nunca foi enviado, então ele é removido de verdade (204)', async () => {
    const c = await criarCenario()
    const rascunho = await criarRascunho(c)

    const resposta = await excluir(c, rascunho.id)

    expect(resposta.status).toBe(204)
    expect(await statusNoBanco(rascunho.id)).toBeUndefined()
    expect(await eventos(rascunho.id, 'deletar')).toHaveLength(1)
  })

  it('quando duas exclusões do mesmo rascunho reaberto chegam ao mesmo tempo, então o status final é o último status e o histórico continua intacto', async () => {
    const c = await criarCenario()
    const { orcamento } = await levarAte(c, 'cancelado')
    const antes = await historico(orcamento.id)
    expect((await reabrir(c, orcamento.id)).status).toBe(200)

    const [a, b] = await Promise.all([excluir(c, orcamento.id), excluir(c, orcamento.id)])

    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(await statusNoBanco(orcamento.id)).toBe('cancelado')
    expect(await historico(orcamento.id)).toEqual(antes)
    expect(await eventos(orcamento.id, 'descartar_reabertura')).toHaveLength(1)
  })

  it('quando o orçamento foi reenviado, então a origem da reabertura deixa de valer e ele não é mais um rascunho excluível', async () => {
    const c = await criarCenario()
    const { orcamento } = await levarAte(c, 'reprovado')
    expect((await reabrir(c, orcamento.id)).status).toBe(200)
    expect((await enviar(c, orcamento.id)).status).toBe(201)

    const resposta = await excluir(c, orcamento.id)

    expect(resposta.status).toBe(409)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    expect(await contarVersoes(orcamento.id)).toBe(2)
  })

  it('quando o banco é instruído a apagar um orçamento com versões, então a FK RESTRICT impede e o histórico fica', async () => {
    const c = await criarCenario()
    const { orcamento } = await levarAte(c, 'reprovado')

    await expect(
      adminPool.query('DELETE FROM orcamentos WHERE id = $1', [orcamento.id]),
    ).rejects.toMatchObject({ code: '23503' })
    await expect(
      adminPool.query('DELETE FROM orcamento_versoes WHERE orcamento_id = $1', [orcamento.id]),
    ).rejects.toMatchObject({ code: '23503' })

    expect(await contarVersoes(orcamento.id)).toBe(1)
    expect(await contarAceites(orcamento.id)).toBe(1)
  })
})

describe('POST /api/orcamentos/:id/reabrir — senha e validação', () => {
  it('quando a senha está errada, então responde 403, nada muda e a tentativa fica auditada sem a senha', async () => {
    const c = await criarCenario()
    const { orcamento } = await levarAte(c, 'reprovado')
    const senhaErrada = 'Senha-Errada-999'

    const resposta = await reabrir(c, orcamento.id, {
      senha: senhaErrada,
      justificativa: JUSTIFICATIVA,
    })

    expect(resposta.status).toBe(403)
    expect(JSON.stringify(resposta.body)).not.toContain(senhaErrada)
    expect(await statusNoBanco(orcamento.id)).toBe('reprovado')
    expect(await eventos(orcamento.id, 'reabrir')).toHaveLength(0)
    const tentativas = await eventos(orcamento.id, 'reabrir_senha_invalida')
    expect(tentativas).toHaveLength(1)
    expect(tentativas[0]?.usuario_id).toBe(c.operador.id)
    expect(JSON.stringify(tentativas[0])).not.toContain(senhaErrada)
  })

  it('quando falta a justificativa ou ela é só espaços, então responde 400 e nada muda', async () => {
    const c = await criarCenario()
    const { orcamento } = await levarAte(c, 'reprovado')

    const corpos = [
      { senha: SENHA_PADRAO },
      { senha: SENHA_PADRAO, justificativa: '' },
      { senha: SENHA_PADRAO, justificativa: '    ' },
      { justificativa: JUSTIFICATIVA },
      { senha: SENHA_PADRAO, justificativa: JUSTIFICATIVA, extra: 'x' },
    ]
    for (const corpo of corpos) {
      expect((await reabrir(c, orcamento.id, corpo)).status).toBe(400)
    }

    expect(await statusNoBanco(orcamento.id)).toBe('reprovado')
    expect(await eventos(orcamento.id, 'reabrir')).toHaveLength(0)
  })

  it('quando o usuário erra a senha repetidamente, então a rota passa a responder 429 (limite por usuário)', async () => {
    const c = await criarCenario()
    const { orcamento } = await levarAte(c, 'reprovado')
    const errada = { senha: 'Senha-Errada-999', justificativa: JUSTIFICATIVA }

    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      statuses.push((await reabrir(c, orcamento.id, errada)).status)
    }

    expect(statuses).toEqual([403, 403, 403, 403, 403, 429])
    expect((await reabrir(c, orcamento.id)).status).toBe(429)
    expect(await statusNoBanco(orcamento.id)).toBe('reprovado')
  })

  it('quando o id é malformado, então responde 400', async () => {
    const c = await criarCenario()
    expect((await reabrir(c, 'nao-e-uuid')).status).toBe(400)
  })
})

describe('POST /api/orcamentos/:id/reabrir — estados e acesso', () => {
  it('quando o orçamento está rascunho, enviado ou aprovado, então responde 409', async () => {
    const c = await criarCenario()
    const rascunho = await criarRascunho(c)
    const { orcamento: enviado } = await criarEnviado(c)
    const { orcamento: aprovado, versao } = await criarEnviado(c)
    expect((await publico.aprovar(versao.tokenPublico)).status).toBe(201)

    const casos: [string, string][] = [
      [rascunho.id, 'rascunho'],
      [enviado.id, 'enviado'],
      [aprovado.id, 'aprovado'],
    ]
    for (const [id, statusEsperado] of casos) {
      const resposta = await reabrir(c, id)
      expect(resposta.status, statusEsperado).toBe(409)
      expect(await statusNoBanco(id)).toBe(statusEsperado)
    }
  })

  it('quando duas reaberturas chegam ao mesmo tempo, então só uma vale e a outra responde 409', async () => {
    const c = await criarCenario()
    const { orcamento } = await levarAte(c, 'reprovado')

    const [a, b] = await Promise.all([reabrir(c, orcamento.id), reabrir(c, orcamento.id)])

    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(await statusNoBanco(orcamento.id)).toBe('rascunho')
    expect(await eventos(orcamento.id, 'reabrir')).toHaveLength(1)
  })

  it('quando o usuário é de outro tenant, então responde 404 e o orçamento não muda', async () => {
    const c = await criarCenario()
    const { orcamento } = await levarAte(c, 'reprovado')
    const outroTenant = await criarTenant()
    const intruso = await criarUsuario(outroTenant.id, 'admin')
    const cookieIntruso = await entrar(intruso)

    const resposta = await reabrir(
      c,
      orcamento.id,
      { senha: intruso.senha, justificativa: JUSTIFICATIVA },
      cookieIntruso,
    )

    expect(resposta.status).toBe(404)
    expect(await statusNoBanco(orcamento.id)).toBe('reprovado')
    expect(await eventos(orcamento.id, 'reabrir')).toHaveLength(0)
  })

  it('quando não está autenticado, então responde 401', async () => {
    const c = await criarCenario()
    const { orcamento } = await levarAte(c, 'reprovado')

    const resposta = await request(await novoApp())
      .post(`/api/orcamentos/${orcamento.id}/reabrir`)
      .send({ senha: SENHA_PADRAO, justificativa: JUSTIFICATIVA })

    expect(resposta.status).toBe(401)
    expect(await statusNoBanco(orcamento.id)).toBe('reprovado')
  })
})
