import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PDFS_DIR_TESTE } from './config-banco.js'
import { emailsEnviados, estadoSmtp } from './espioes.js'
import {
  adminPool,
  contarAceites,
  criarCenario,
  criarEnviado,
  criarRascunho,
  encerrarConexoes,
  limparDados,
  novoApp,
  statusNoBanco,
  tokenDesconhecido,
  type Cenario,
  type OrcamentoCriado,
  type VersaoCriada,
} from './helpers.js'

// Request specs de aceite e de mudança de status do orçamento:
//   rascunho -> enviado -> aprovado | reprovado   (aprovado e reprovado são finais)
// Rotas reais, banco real, RLS ativo. Só SMTP e Chromium são simulados.

let c: Cenario

beforeAll(async () => {
  c = await criarCenario()
})

afterAll(async () => {
  await limparDados()
  await encerrarConexoes()
})

const UA = 'Agente-de-Teste/1.0'

// App novo por chamada: o rate limit das rotas públicas é por instância.
const publico = {
  ver: async (token: string) => request(await novoApp()).get(`/api/publico/orcamento/${token}`),
  aprovar: async (token: string) =>
    request(await novoApp())
      .post(`/api/publico/orcamento/${token}/aprovar`)
      .set('User-Agent', UA),
  reprovar: async (token: string, corpo: Record<string, unknown> = {}) =>
    request(await novoApp())
      .post(`/api/publico/orcamento/${token}/reprovar`)
      .set('User-Agent', UA)
      .send(corpo),
}

const manual = (cenario: Cenario, orcamentoId: string, corpo: unknown) =>
  request(cenario.app)
    .post(`/api/orcamentos/${orcamentoId}/aceite-manual`)
    .set('Cookie', cenario.cookieOperador)
    .send(corpo as object)

interface Enviado {
  orcamento: OrcamentoCriado
  versao: VersaoCriada
}

/** Cenário novo + orçamento enviado, com a caixa de e-mails limpa. */
async function prepararEnviado(): Promise<{ cenario: Cenario } & Enviado> {
  const cenario = await criarCenario()
  const enviado = await criarEnviado(cenario)
  emailsEnviados.length = 0
  return { cenario, ...enviado }
}

// Comprovante de aceite gravado em disco: pdfs/{tenant}/{numero}-aceite-v{versao}.pdf.
// O caminho de disco nunca vem na resposta HTTP; o teste confere o arquivo direto.
function arquivoDoComprovante(tenantId: string, numero: string, versao = 1): string {
  return join(PDFS_DIR_TESTE, tenantId, `${numero}-aceite-v${versao}.pdf`)
}

async function acaoAuditada(entidadeId: string, acao: string): Promise<number> {
  const { rowCount } = await adminPool.query(
    'SELECT 1 FROM eventos_auditoria WHERE entidade_id = $1 AND acao = $2',
    [entidadeId, acao],
  )
  return rowCount ?? 0
}

describe('visualização pública (GET /api/publico/orcamento/:token)', () => {
  it('quando o token é válido, então responde 200 com snapshot, flag de integridade e URL do PDF', async () => {
    const { versao, orcamento } = await prepararEnviado()

    const resposta = await publico.ver(versao.tokenPublico)

    expect(resposta.status).toBe(200)
    expect(resposta.body.numero).toBe(orcamento.numero)
    expect(resposta.body.versao).toBe(1)
    expect(resposta.body.integro).toBe(true)
    expect(resposta.body.pdfUrl).toEqual(expect.any(String))
    expect(resposta.body.snapshot).toBeDefined()
  })

  it('quando só visualiza, então o status do orçamento continua enviado', async () => {
    const { versao, orcamento } = await prepararEnviado()

    await publico.ver(versao.tokenPublico)

    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
  })

  it('quando o token é desconhecido, então responde 404', async () => {
    const resposta = await publico.ver(tokenDesconhecido())

    expect(resposta.status).toBe(404)
  })

  it('quando o token está expirado, então responde 410', async () => {
    const { versao } = await prepararEnviado()
    await adminPool.query(
      `UPDATE orcamento_versoes SET expira_em = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [versao.id],
    )

    const resposta = await publico.ver(versao.tokenPublico)

    expect(resposta.status).toBe(410)
  })
})

describe('aprovação pelo cliente (POST /api/publico/orcamento/:token/aprovar)', () => {
  it('quando o token é válido e o orçamento está enviado, então responde 201, grava o aceite com as evidências e gera o comprovante', async () => {
    const { cenario, versao, orcamento } = await prepararEnviado()

    const resposta = await publico.aprovar(versao.tokenPublico)

    expect(resposta.status).toBe(201)
    expect(resposta.body.metodo).toBe('cliente')
    expect(await statusNoBanco(orcamento.id)).toBe('aprovado')
    await access(arquivoDoComprovante(cenario.tenant.id, orcamento.numero))
    expect(resposta.body.comprovantePdfPath).toBeUndefined()
    expect(resposta.body.comprovantePdfHash).toMatch(/^[0-9a-f]{64}$/)

    const { rows } = await adminPool.query(
      'SELECT metodo, ip, user_agent, hash_documento, usuario_id FROM orcamento_aceites WHERE versao_id = $1',
      [versao.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ metodo: 'cliente', user_agent: UA, usuario_id: null })
    expect(rows[0]?.ip).toBeTruthy()
    expect(rows[0]?.hash_documento).toBe(versao.pdfHash)
    expect(await acaoAuditada(orcamento.id, 'aprovar')).toBe(1)
  })

  it('quando o cliente aprova, então o operador responsável é notificado por e-mail', async () => {
    const { versao, cenario } = await prepararEnviado()

    await publico.aprovar(versao.tokenPublico)

    expect(emailsEnviados).toHaveLength(1)
    expect(emailsEnviados[0]?.to).toBe(cenario.operador.email)
  })

  it('quando o SMTP está indisponível, então a aprovação ainda responde 201 e o status vira aprovado', async () => {
    const { versao, orcamento } = await prepararEnviado()
    estadoSmtp.falhar = true

    const resposta = await publico.aprovar(versao.tokenPublico)

    expect(resposta.status).toBe(201)
    expect(await statusNoBanco(orcamento.id)).toBe('aprovado')
  })

  it('quando o token é desconhecido, então responde 404 e nada é registrado', async () => {
    const resposta = await publico.aprovar(tokenDesconhecido())

    expect(resposta.status).toBe(404)
  })

  it('quando o HMAC do token foi adulterado, então responde 404 e o status não muda', async () => {
    const { versao, orcamento } = await prepararEnviado()
    const uuid = versao.tokenPublico.split('.')[0]
    const adulterado = `${uuid}.${'0'.repeat(64)}`

    const resposta = await publico.aprovar(adulterado)

    expect(resposta.status).toBe(404)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    expect(await contarAceites(orcamento.id)).toBe(0)
  })

  it('quando o token está expirado, então responde 410 e o status não muda', async () => {
    const { versao, orcamento } = await prepararEnviado()
    await adminPool.query(
      `UPDATE orcamento_versoes SET expira_em = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [versao.id],
    )

    const resposta = await publico.aprovar(versao.tokenPublico)

    expect(resposta.status).toBe(410)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    expect(await contarAceites(orcamento.id)).toBe(0)
  })

  it('quando a versão não tem hash de PDF, então responde 409 e nada é registrado', async () => {
    const { versao, orcamento } = await prepararEnviado()
    await adminPool.query('UPDATE orcamento_versoes SET pdf_hash = NULL WHERE id = $1', [versao.id])

    const resposta = await publico.aprovar(versao.tokenPublico)

    expect(resposta.status).toBe(409)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    expect(await contarAceites(orcamento.id)).toBe(0)
  })

  it('quando o cliente aprova duas vezes em sequência, então a segunda responde 409 e existe um só aceite', async () => {
    const { versao, orcamento } = await prepararEnviado()

    const primeira = await publico.aprovar(versao.tokenPublico)
    const segunda = await publico.aprovar(versao.tokenPublico)

    expect(primeira.status).toBe(201)
    expect(segunda.status).toBe(409)
    expect(await contarAceites(orcamento.id)).toBe(1)
  })

  it('quando duas aprovações do mesmo token chegam ao mesmo tempo, então só uma registra aceite e a outra responde 409', async () => {
    const { versao, orcamento } = await prepararEnviado()

    const [a, b] = await Promise.all([
      publico.aprovar(versao.tokenPublico),
      publico.aprovar(versao.tokenPublico),
    ])

    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect(await contarAceites(orcamento.id)).toBe(1)
    expect(await statusNoBanco(orcamento.id)).toBe('aprovado')
  })
})

describe('reprovação pelo cliente (POST /api/publico/orcamento/:token/reprovar)', () => {
  it('quando o token é válido, então responde 201, registra a reprovação com a justificativa e não gera comprovante', async () => {
    const { versao, orcamento } = await prepararEnviado()

    const resposta = await publico.reprovar(versao.tokenPublico, { justificativa: 'Preço alto' })

    expect(resposta.status).toBe(201)
    expect(resposta.body.comprovantePdfPath).toBeUndefined()
    expect(resposta.body.comprovanteUrl).toBeNull()
    expect(resposta.body.comprovantePdfHash).toBeNull()
    expect(await statusNoBanco(orcamento.id)).toBe('reprovado')
    const { rows } = await adminPool.query(
      'SELECT justificativa, metodo FROM orcamento_aceites WHERE versao_id = $1',
      [versao.id],
    )
    expect(rows[0]).toEqual({ justificativa: 'Preço alto', metodo: 'cliente' })
    expect(await acaoAuditada(orcamento.id, 'reprovar')).toBe(1)
  })

  it('quando reprova sem justificativa, então responde 201 (justificativa é opcional)', async () => {
    const { versao, orcamento } = await prepararEnviado()

    const resposta = await publico.reprovar(versao.tokenPublico)

    expect(resposta.status).toBe(201)
    expect(await statusNoBanco(orcamento.id)).toBe('reprovado')
  })

  it('quando o cliente reprova, então o operador responsável é notificado por e-mail', async () => {
    const { versao, cenario } = await prepararEnviado()

    await publico.reprovar(versao.tokenPublico, { justificativa: 'Fora do orçamento' })

    expect(emailsEnviados).toHaveLength(1)
    expect(emailsEnviados[0]?.to).toBe(cenario.operador.email)
  })

  it('quando o token é desconhecido, então responde 404', async () => {
    const resposta = await publico.reprovar(tokenDesconhecido())

    expect(resposta.status).toBe(404)
  })

  it('quando o token está expirado, então responde 410 e o status não muda', async () => {
    const { versao, orcamento } = await prepararEnviado()
    await adminPool.query(
      `UPDATE orcamento_versoes SET expira_em = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [versao.id],
    )

    const resposta = await publico.reprovar(versao.tokenPublico)

    expect(resposta.status).toBe(410)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
  })

  it('quando o cliente reprova duas vezes em sequência, então a segunda responde 409 e existe um só registro', async () => {
    const { versao, orcamento } = await prepararEnviado()

    const primeira = await publico.reprovar(versao.tokenPublico)
    const segunda = await publico.reprovar(versao.tokenPublico)

    expect(primeira.status).toBe(201)
    expect(segunda.status).toBe(409)
    expect(await contarAceites(orcamento.id)).toBe(1)
  })

  it('quando duas reprovações do mesmo token chegam ao mesmo tempo, então só uma registra e a outra responde 409', async () => {
    const { versao, orcamento } = await prepararEnviado()

    const [a, b] = await Promise.all([
      publico.reprovar(versao.tokenPublico),
      publico.reprovar(versao.tokenPublico),
    ])

    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect(await contarAceites(orcamento.id)).toBe(1)
  })
})

describe('aceite manual pelo operador (POST /api/orcamentos/:id/aceite-manual)', () => {
  it('quando o operador registra com justificativa e há versão enviada, então responde 201, o status vira aprovado e o operador fica como responsável', async () => {
    const { cenario, orcamento, versao } = await prepararEnviado()

    const resposta = await manual(cenario, orcamento.id, { justificativa: 'Aprovou por telefone' })

    expect(resposta.status).toBe(201)
    expect(resposta.body.metodo).toBe('operador')
    expect(await statusNoBanco(orcamento.id)).toBe('aprovado')
    await access(arquivoDoComprovante(cenario.tenant.id, orcamento.numero))
    expect(resposta.body.comprovantePdfPath).toBeUndefined()
    const { rows } = await adminPool.query(
      'SELECT usuario_id, justificativa, metodo FROM orcamento_aceites WHERE versao_id = $1',
      [versao.id],
    )
    expect(rows[0]).toEqual({
      usuario_id: cenario.operador.id,
      justificativa: 'Aprovou por telefone',
      metodo: 'operador',
    })
    expect(await acaoAuditada(orcamento.id, 'aceite_manual')).toBe(1)
  })

  it('quando falta a justificativa ou ela é só espaços, então responde 400 e nada é registrado', async () => {
    const { cenario, orcamento } = await prepararEnviado()

    const ausente = await manual(cenario, orcamento.id, {})
    const vazia = await manual(cenario, orcamento.id, { justificativa: '   ' })

    expect(ausente.status).toBe(400)
    expect(vazia.status).toBe(400)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    expect(await contarAceites(orcamento.id)).toBe(0)
  })

  it('quando o corpo traz campos extras, então responde 400', async () => {
    const { cenario, orcamento } = await prepararEnviado()

    const resposta = await manual(cenario, orcamento.id, {
      justificativa: 'ok',
      status: 'reprovado',
    })

    expect(resposta.status).toBe(400)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
  })

  it('quando o orçamento ainda é rascunho (sem versão enviada), então responde 409 e continua rascunho', async () => {
    const cenario = await criarCenario()
    const rascunho = await criarRascunho(cenario)

    const resposta = await manual(cenario, rascunho.id, { justificativa: 'Tentativa' })

    expect(resposta.status).toBe(409)
    expect(await statusNoBanco(rascunho.id)).toBe('rascunho')
    expect(await contarAceites(rascunho.id)).toBe(0)
  })

  it('quando o orçamento já está aprovado, então o segundo aceite responde 409 e existe um só aceite', async () => {
    const { cenario, orcamento } = await prepararEnviado()

    const primeiro = await manual(cenario, orcamento.id, { justificativa: 'Primeiro' })
    const segundo = await manual(cenario, orcamento.id, { justificativa: 'Segundo' })

    expect(primeiro.status).toBe(201)
    expect(segundo.status).toBe(409)
    expect(await contarAceites(orcamento.id)).toBe(1)
  })

  it('quando dois aceites manuais chegam ao mesmo tempo, então só um registra e o outro responde 409', async () => {
    const { cenario, orcamento } = await prepararEnviado()

    const [a, b] = await Promise.all([
      manual(cenario, orcamento.id, { justificativa: 'A' }),
      manual(cenario, orcamento.id, { justificativa: 'B' }),
    ])

    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect(await contarAceites(orcamento.id)).toBe(1)
  })

  it('quando o orçamento não existe, então responde 404', async () => {
    const resposta = await manual(c, randomUUID(), { justificativa: 'Fantasma' })

    expect(resposta.status).toBe(404)
  })

  it('quando não está autenticado, então responde 401 e nada é registrado', async () => {
    const { cenario, orcamento } = await prepararEnviado()

    const resposta = await request(cenario.app)
      .post(`/api/orcamentos/${orcamento.id}/aceite-manual`)
      .send({ justificativa: 'Sem login' })

    expect(resposta.status).toBe(401)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
  })
})

describe('transições de status do orçamento', () => {
  it('quando o cliente aprova e o operador tenta aceite manual em seguida, então responde 409', async () => {
    const { cenario, orcamento, versao } = await prepararEnviado()
    await publico.aprovar(versao.tokenPublico)

    const resposta = await manual(cenario, orcamento.id, { justificativa: 'Tarde demais' })

    expect(resposta.status).toBe(409)
    expect(await contarAceites(orcamento.id)).toBe(1)
  })

  it('quando o cliente aprova e depois tenta reprovar, então responde 409 e o status continua aprovado', async () => {
    const { versao, orcamento } = await prepararEnviado()
    await publico.aprovar(versao.tokenPublico)

    const resposta = await publico.reprovar(versao.tokenPublico)

    expect(resposta.status).toBe(409)
    expect(await statusNoBanco(orcamento.id)).toBe('aprovado')
    expect(await contarAceites(orcamento.id)).toBe(1)
  })

  it('quando o cliente reprova e depois tenta aprovar, então responde 409 e o status continua reprovado', async () => {
    const { versao, orcamento } = await prepararEnviado()
    await publico.reprovar(versao.tokenPublico)

    const resposta = await publico.aprovar(versao.tokenPublico)

    expect(resposta.status).toBe(409)
    expect(await statusNoBanco(orcamento.id)).toBe('reprovado')
    expect(await contarAceites(orcamento.id)).toBe(1)
  })

  it('quando o cliente reprova e o operador tenta aceite manual, então responde 409 e o status continua reprovado', async () => {
    const { cenario, orcamento, versao } = await prepararEnviado()
    await publico.reprovar(versao.tokenPublico)

    const resposta = await manual(cenario, orcamento.id, { justificativa: 'Mudou de ideia' })

    expect(resposta.status).toBe(409)
    expect(await statusNoBanco(orcamento.id)).toBe('reprovado')
    expect(await contarAceites(orcamento.id)).toBe(1)
  })

  it('quando aprovação e reprovação do mesmo token chegam ao mesmo tempo, então só uma decisão vale e a outra responde 409', async () => {
    const { versao, orcamento } = await prepararEnviado()

    const [aprovacao, reprovacao] = await Promise.all([
      publico.aprovar(versao.tokenPublico),
      publico.reprovar(versao.tokenPublico),
    ])

    expect([aprovacao.status, reprovacao.status].sort()).toEqual([201, 409])
    expect(await contarAceites(orcamento.id)).toBe(1)
    const status = await statusNoBanco(orcamento.id)
    expect(status).toBe(aprovacao.status === 201 ? 'aprovado' : 'reprovado')
  })

  it('quando aceite do cliente e aceite manual chegam ao mesmo tempo, então só um registra e o outro responde 409', async () => {
    const { cenario, orcamento, versao } = await prepararEnviado()

    const [cliente, operador] = await Promise.all([
      publico.aprovar(versao.tokenPublico),
      manual(cenario, orcamento.id, { justificativa: 'Corrida' }),
    ])

    expect([cliente.status, operador.status].sort()).toEqual([201, 409])
    expect(await contarAceites(orcamento.id)).toBe(1)
  })

  it.each([
    ['aprovado', (v: VersaoCriada) => publico.aprovar(v.tokenPublico)],
    ['reprovado', (v: VersaoCriada) => publico.reprovar(v.tokenPublico)],
  ] as const)(
    'quando o orçamento está %s, então editar, excluir e reenviar respondem 409 e nada muda',
    async (statusFinal, decidir) => {
      const { cenario, orcamento, versao } = await prepararEnviado()
      await decidir(versao)
      expect(await statusNoBanco(orcamento.id)).toBe(statusFinal)

      const editar = await request(cenario.app)
        .put(`/api/orcamentos/${orcamento.id}`)
        .set('Cookie', cenario.cookieOperador)
        .send({ titulo: 'Mudança', itens: [{ nome: 'X', quantidade: 1, valorUnitario: 1 }] })
      const excluir = await request(cenario.app)
        .delete(`/api/orcamentos/${orcamento.id}`)
        .set('Cookie', cenario.cookieOperador)
      const reenviar = await request(cenario.app)
        .post(`/api/orcamentos/${orcamento.id}/enviar`)
        .set('Cookie', cenario.cookieOperador)

      expect(editar.status).toBe(409)
      expect(excluir.status).toBe(409)
      expect(reenviar.status).toBe(409)
      expect(await statusNoBanco(orcamento.id)).toBe(statusFinal)
      const versoes = await adminPool.query(
        'SELECT 1 FROM orcamento_versoes WHERE orcamento_id = $1',
        [orcamento.id],
      )
      expect(versoes.rowCount).toBe(1)
    },
  )

  it('quando lista com ?status=aprovado, então só vêm os aprovados do tenant', async () => {
    const { cenario, orcamento, versao } = await prepararEnviado()
    const { orcamento: outroEnviado } = await criarEnviado(cenario)
    await publico.aprovar(versao.tokenPublico)

    const resposta = await request(cenario.app)
      .get('/api/orcamentos')
      .query({ status: 'aprovado' })
      .set('Cookie', cenario.cookieOperador)

    const itens = resposta.body.itens as { id: string; status: string }[]
    expect(resposta.status).toBe(200)
    expect(itens.map((o) => o.id)).toContain(orcamento.id)
    expect(itens.map((o) => o.id)).not.toContain(outroEnviado.id)
    expect(itens.every((o) => o.status === 'aprovado')).toBe(true)
  })
})
