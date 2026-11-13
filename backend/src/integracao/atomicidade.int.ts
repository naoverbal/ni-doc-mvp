import { PostgresDialect, Kysely } from 'kysely'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { criarLimparPdfsJob, criarLimparPdfsRepositorio } from '../jobs/limpar-pdfs.js'
import type { Database } from '../types/database.js'
import { emailsEnviados } from './espioes.js'
import {
  adminPool,
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
  contarAceites,
  contarVersoes,
  type Cenario,
} from './helpers.js'

// -----------------------------------------------------------------------------
// ATOMICIDADE ("tudo ou nada") das operações que gravam em mais de um registro.
//
// Como forçamos o erro no meio: um trigger de teste em `eventos_auditoria` lança
// exceção para os tenants "armados". A auditoria é o ÚLTIMO passo de cada operação
// (depois dos inserts/updates de negócio, na mesma transação), então, quando ela
// falha, tudo o que veio antes já foi executado no banco — e precisa ser revertido.
//
// Cada teste: (1) arma a falha para o tenant, (2) executa a operação pela rota
// real, (3) espera 500 e (4) prova, consultando o banco com o papel privilegiado,
// que NADA foi gravado/alterado (inclusive a própria auditoria).
// -----------------------------------------------------------------------------

beforeAll(async () => {
  await adminPool.query(
    'CREATE TABLE IF NOT EXISTS teste_falha_auditoria (tenant_id uuid PRIMARY KEY)',
  )
  await adminPool.query(`
    CREATE OR REPLACE FUNCTION teste_falhar_auditoria() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM teste_falha_auditoria WHERE tenant_id = NEW.tenant_id) THEN
        RAISE EXCEPTION 'falha forçada na auditoria (teste de atomicidade)';
      END IF;
      RETURN NEW;
    END $$`)
  await adminPool.query('DROP TRIGGER IF EXISTS teste_falhar_auditoria_trg ON eventos_auditoria')
  await adminPool.query(
    `CREATE TRIGGER teste_falhar_auditoria_trg BEFORE INSERT ON eventos_auditoria
     FOR EACH ROW EXECUTE FUNCTION teste_falhar_auditoria()`,
  )
})

afterAll(async () => {
  await adminPool.query('DROP TRIGGER IF EXISTS teste_falhar_auditoria_trg ON eventos_auditoria')
  await adminPool.query('DROP FUNCTION IF EXISTS teste_falhar_auditoria()')
  await adminPool.query('DROP TABLE IF EXISTS teste_falha_auditoria')
  await limparDados()
  await encerrarConexoes()
})

/** Executa `operacao` com a gravação da auditoria do tenant forçada a falhar. */
async function comAuditoriaFalhando<T>(tenantId: string, operacao: () => Promise<T>): Promise<T> {
  await adminPool.query(
    'INSERT INTO teste_falha_auditoria (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [tenantId],
  )
  try {
    return await operacao()
  } finally {
    await adminPool.query('DELETE FROM teste_falha_auditoria WHERE tenant_id = $1', [tenantId])
  }
}

async function contar(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await adminPool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM (${sql}) t`,
    params,
  )
  return Number(rows[0]?.n ?? 0)
}

const auditorias = (tenantId: string, acao: string) =>
  contar('SELECT 1 FROM eventos_auditoria WHERE tenant_id = $1 AND acao = $2', [tenantId, acao])
const orcamentosDoTenant = (tenantId: string) =>
  contar('SELECT 1 FROM orcamentos WHERE tenant_id = $1', [tenantId])
const itensDoOrcamento = (orcamentoId: string) =>
  contar('SELECT 1 FROM orcamento_itens WHERE orcamento_id = $1', [orcamentoId])
const condicoesDoOrcamento = (orcamentoId: string) =>
  contar('SELECT 1 FROM orcamento_condicoes_pagamento WHERE orcamento_id = $1', [orcamentoId])

async function linhaOrcamento(id: string) {
  const { rows } = await adminPool.query<{
    titulo: string
    status: string
    status_reaberto_de: string | null
    versao_atual: number | null
    total: string
    data_emissao: Date
  }>(
    'SELECT titulo, status, status_reaberto_de, versao_atual, total, data_emissao FROM orcamentos WHERE id = $1',
    [id],
  )
  return rows[0]
}

const CONDICOES = [
  { descricao: 'Entrada', percentual: 50, formaPagamento: 'PIX' },
  { descricao: 'Entrega', percentual: 50, formaPagamento: 'PIX' },
]
const UA = 'Agente-de-Teste/1.0'
const SENHA_E_JUSTIFICATIVA = {
  senha: SENHA_PADRAO,
  justificativa: 'Motivo do teste de atomicidade',
}

const post = (c: Cenario, caminho: string, corpo?: object, cookie = c.cookieOperador) =>
  request(c.app).post(caminho).set('Cookie', cookie).set('User-Agent', UA).send(corpo)

describe('orçamento — criar (orçamento + itens + condições + auditoria)', () => {
  it('quando a auditoria falha depois de gravar orçamento, itens e condições, então nada é gravado e o número não é consumido', async () => {
    const c = await criarCenario()

    const resposta = await comAuditoriaFalhando(c.tenant.id, () =>
      post(c, '/api/orcamentos', corpoOrcamento(c.cliente.id, { condicoesPagamento: CONDICOES })),
    )

    expect(resposta.status).toBe(500)
    expect(await orcamentosDoTenant(c.tenant.id)).toBe(0)
    expect(
      await contar(
        `SELECT 1 FROM orcamento_itens i JOIN orcamentos o ON o.id = i.orcamento_id WHERE o.tenant_id = $1`,
        [c.tenant.id],
      ),
    ).toBe(0)
    expect(
      await contar(
        `SELECT 1 FROM orcamento_condicoes_pagamento p JOIN orcamentos o ON o.id = p.orcamento_id WHERE o.tenant_id = $1`,
        [c.tenant.id],
      ),
    ).toBe(0)
    expect(await auditorias(c.tenant.id, 'criar')).toBe(0)

    // Sem a falha, a mesma operação funciona e reaproveita o número 0001 (o
    // rollback devolveu o número: não há "buraco" na numeração).
    const ok = await post(
      c,
      '/api/orcamentos',
      corpoOrcamento(c.cliente.id, { condicoesPagamento: CONDICOES }),
    )
    expect(ok.status).toBe(201)
    expect(String(ok.body.numero)).toMatch(/-0001$/)
    expect(await auditorias(c.tenant.id, 'criar')).toBe(1)
  })
})

describe('orçamento — atualizar (orçamento + itens + condições + auditoria)', () => {
  it('quando a auditoria falha depois de apagar e reinserir itens e condições, então o rascunho continua exatamente como estava', async () => {
    const c = await criarCenario()
    const original = await criarRascunho(c)
    const antes = await linhaOrcamento(original.id)

    const resposta = await comAuditoriaFalhando(c.tenant.id, () =>
      request(c.app)
        .put(`/api/orcamentos/${original.id}`)
        .set('Cookie', c.cookieOperador)
        .send(
          corpoOrcamento(c.cliente.id, {
            titulo: 'Título alterado',
            itens: [
              { nome: 'Novo item 1', quantidade: 1, valorUnitario: 10 },
              { nome: 'Novo item 2', quantidade: 3, valorUnitario: 20 },
            ],
            condicoesPagamento: CONDICOES,
          }),
        ),
    )

    expect(resposta.status).toBe(500)
    expect(await linhaOrcamento(original.id)).toEqual(antes)
    expect(await itensDoOrcamento(original.id)).toBe(1)
    const { rows } = await adminPool.query<{ nome: string }>(
      'SELECT nome FROM orcamento_itens WHERE orcamento_id = $1',
      [original.id],
    )
    expect(rows.map((r) => r.nome)).toEqual(['Serviço A'])
    expect(await condicoesDoOrcamento(original.id)).toBe(0)
    expect(await auditorias(c.tenant.id, 'atualizar')).toBe(0)
  })
})

describe('orçamento — enviar (versão + status + PDF + auditoria)', () => {
  it('quando a auditoria falha depois de criar a versão e marcar como enviado, então não há versão e o orçamento segue rascunho', async () => {
    const c = await criarCenario()
    const rascunho = await criarRascunho(c)
    const antes = await linhaOrcamento(rascunho.id)

    const resposta = await comAuditoriaFalhando(c.tenant.id, () =>
      post(c, `/api/orcamentos/${rascunho.id}/enviar`),
    )

    expect(resposta.status).toBe(500)
    expect(await contarVersoes(rascunho.id)).toBe(0)
    expect(await linhaOrcamento(rascunho.id)).toEqual(antes)
    expect(await statusNoBanco(rascunho.id)).toBe('rascunho')
    expect(await auditorias(c.tenant.id, 'enviar')).toBe(0)
    // E-mail ao cliente só sai depois da persistência: nada foi enviado.
    expect(emailsEnviados.some((e) => e.subject.includes(rascunho.numero))).toBe(false)

    // Sem a falha, o reenvio funciona e gera a versão 1.
    const ok = await post(c, `/api/orcamentos/${rascunho.id}/enviar`)
    expect(ok.status).toBe(201)
    expect(ok.body.versao).toBe(1)
  })
})

describe('aceite (aceite + status do orçamento + auditoria)', () => {
  it('quando a auditoria falha na aprovação pelo cliente, então não há aceite, o status segue enviado e nenhum e-mail/comprovante é disparado', async () => {
    const c = await criarCenario()
    const { orcamento, versao } = await criarEnviado(c)
    const emailsAntes = emailsEnviados.length

    const resposta = await comAuditoriaFalhando(c.tenant.id, async () =>
      request(await novoApp())
        .post(`/api/publico/orcamento/${versao.tokenPublico}/aprovar`)
        .set('User-Agent', UA),
    )

    expect(resposta.status).toBe(500)
    expect(await contarAceites(orcamento.id)).toBe(0)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    expect(await auditorias(c.tenant.id, 'aprovar')).toBe(0)
    expect(emailsEnviados.length).toBe(emailsAntes)

    // Sem a falha, o mesmo link ainda aceita a aprovação (nada ficou "meio aprovado").
    const ok = await request(await novoApp())
      .post(`/api/publico/orcamento/${versao.tokenPublico}/aprovar`)
      .set('User-Agent', UA)
    expect(ok.status).toBe(201)
    expect(await statusNoBanco(orcamento.id)).toBe('aprovado')
  })

  it('quando a auditoria falha na reprovação pelo cliente, então não há aceite e o status segue enviado', async () => {
    const c = await criarCenario()
    const { orcamento, versao } = await criarEnviado(c)

    const resposta = await comAuditoriaFalhando(c.tenant.id, async () =>
      request(await novoApp())
        .post(`/api/publico/orcamento/${versao.tokenPublico}/reprovar`)
        .set('User-Agent', UA)
        .send({}),
    )

    expect(resposta.status).toBe(500)
    expect(await contarAceites(orcamento.id)).toBe(0)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    expect(await auditorias(c.tenant.id, 'reprovar')).toBe(0)
  })

  it('quando a auditoria falha no aceite manual do operador, então não há aceite e o status segue enviado', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c)

    const resposta = await comAuditoriaFalhando(c.tenant.id, () =>
      post(c, `/api/orcamentos/${orcamento.id}/aceite-manual`, {
        justificativa: 'Aprovou por telefone',
      }),
    )

    expect(resposta.status).toBe(500)
    expect(await contarAceites(orcamento.id)).toBe(0)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    expect(await auditorias(c.tenant.id, 'aceite_manual')).toBe(0)
  })
})

describe('orçamento — cancelar, reabrir e descartar reabertura', () => {
  it('quando a auditoria falha ao cancelar, então o orçamento segue enviado e ninguém é notificado', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c)
    const emailsAntes = emailsEnviados.length

    const resposta = await comAuditoriaFalhando(c.tenant.id, () =>
      post(c, `/api/orcamentos/${orcamento.id}/cancelar`, SENHA_E_JUSTIFICATIVA, c.cookieAdmin),
    )

    expect(resposta.status).toBe(500)
    expect(await statusNoBanco(orcamento.id)).toBe('enviado')
    expect(await auditorias(c.tenant.id, 'cancelar')).toBe(0)
    expect(emailsEnviados.length).toBe(emailsAntes)
  })

  it('quando a auditoria falha ao reabrir, então o orçamento segue cancelado, sem status de origem e com a mesma data de emissão', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c)
    const cancelado = await post(
      c,
      `/api/orcamentos/${orcamento.id}/cancelar`,
      SENHA_E_JUSTIFICATIVA,
    )
    expect(cancelado.status).toBe(200)
    const antes = await linhaOrcamento(orcamento.id)

    const resposta = await comAuditoriaFalhando(c.tenant.id, () =>
      post(c, `/api/orcamentos/${orcamento.id}/reabrir`, SENHA_E_JUSTIFICATIVA),
    )

    expect(resposta.status).toBe(500)
    const depois = await linhaOrcamento(orcamento.id)
    expect(depois).toEqual(antes)
    expect(depois?.status).toBe('cancelado')
    expect(depois?.status_reaberto_de).toBeNull()
    expect(await auditorias(c.tenant.id, 'reabrir')).toBe(0)
  })

  it('quando a auditoria falha ao descartar um rascunho reaberto (restauração da última versão), então o rascunho editado permanece intacto', async () => {
    const c = await criarCenario()
    const { orcamento } = await criarEnviado(c)
    expect(
      (await post(c, `/api/orcamentos/${orcamento.id}/cancelar`, SENHA_E_JUSTIFICATIVA)).status,
    ).toBe(200)
    expect(
      (await post(c, `/api/orcamentos/${orcamento.id}/reabrir`, SENHA_E_JUSTIFICATIVA)).status,
    ).toBe(200)
    const edicao = await request(c.app)
      .put(`/api/orcamentos/${orcamento.id}`)
      .set('Cookie', c.cookieOperador)
      .send(
        corpoOrcamento(c.cliente.id, {
          titulo: 'Rascunho editado após reabrir',
          itens: [
            { nome: 'Item editado 1', quantidade: 1, valorUnitario: 10 },
            { nome: 'Item editado 2', quantidade: 2, valorUnitario: 20 },
          ],
        }),
      )
    expect(edicao.status).toBe(200)
    const antes = await linhaOrcamento(orcamento.id)

    const resposta = await comAuditoriaFalhando(c.tenant.id, () =>
      request(c.app).delete(`/api/orcamentos/${orcamento.id}`).set('Cookie', c.cookieOperador),
    )

    expect(resposta.status).toBe(500)
    // A restauração apagaria e reinseriria itens/condições e trocaria o status:
    // nada disso pode ter persistido.
    expect(await linhaOrcamento(orcamento.id)).toEqual(antes)
    expect((await linhaOrcamento(orcamento.id))?.status).toBe('rascunho')
    expect((await linhaOrcamento(orcamento.id))?.status_reaberto_de).toBe('cancelado')
    const { rows } = await adminPool.query<{ nome: string }>(
      'SELECT nome FROM orcamento_itens WHERE orcamento_id = $1 ORDER BY nome',
      [orcamento.id],
    )
    expect(rows.map((r) => r.nome)).toEqual(['Item editado 1', 'Item editado 2'])
    expect(await auditorias(c.tenant.id, 'descartar_reabertura')).toBe(0)

    // Sem a falha, o descarte restaura a última versão enviada (status cancelado).
    const ok = await request(c.app)
      .delete(`/api/orcamentos/${orcamento.id}`)
      .set('Cookie', c.cookieOperador)
    expect(ok.status).toBe(200)
    expect(await statusNoBanco(orcamento.id)).toBe('cancelado')
  })
})

describe('cadastros e template (registro + auditoria)', () => {
  it('quando a auditoria falha ao cadastrar cliente, então o cliente não é criado', async () => {
    const c = await criarCenario()
    const quantosAntes = await contar('SELECT 1 FROM clientes WHERE tenant_id = $1', [c.tenant.id])

    const resposta = await comAuditoriaFalhando(c.tenant.id, () =>
      post(
        c,
        '/api/clientes',
        { tipoPessoa: 'PF', nome: 'Maria Atômica', documento: '529.982.247-25' },
        c.cookieAdmin,
      ),
    )

    expect(resposta.status).toBe(500)
    expect(await contar('SELECT 1 FROM clientes WHERE tenant_id = $1', [c.tenant.id])).toBe(
      quantosAntes,
    )
    expect(await auditorias(c.tenant.id, 'criar')).toBe(0)

    const ok = await post(
      c,
      '/api/clientes',
      { tipoPessoa: 'PF', nome: 'Maria Atômica', documento: '529.982.247-25' },
      c.cookieAdmin,
    )
    expect(ok.status).toBe(201)
  })

  it('quando a auditoria falha ao atualizar cliente, então o cadastro mantém os dados anteriores', async () => {
    const c = await criarCenario()

    const resposta = await comAuditoriaFalhando(c.tenant.id, () =>
      request(c.app)
        .put(`/api/clientes/${c.cliente.id}`)
        .set('Cookie', c.cookieAdmin)
        .send({ nome: 'Nome que não pode persistir' }),
    )

    expect(resposta.status).toBe(500)
    const { rows } = await adminPool.query<{ nome: string }>(
      'SELECT nome FROM clientes WHERE id = $1',
      [c.cliente.id],
    )
    expect(rows[0]?.nome).toBe(c.cliente.nome)
    expect(await auditorias(c.tenant.id, 'atualizar')).toBe(0)
  })

  it('quando a auditoria falha ao cadastrar responsável técnico, então ele não é criado', async () => {
    const c = await criarCenario()

    const resposta = await comAuditoriaFalhando(c.tenant.id, () =>
      post(c, '/api/responsaveis', { nome: 'Responsável Atômico' }, c.cookieAdmin),
    )

    expect(resposta.status).toBe(500)
    expect(
      await contar('SELECT 1 FROM responsaveis_tecnicos WHERE tenant_id = $1', [c.tenant.id]),
    ).toBe(0)
  })

  it('quando a auditoria falha ao salvar o template, então não nasce nova versão e o ponteiro do template ativo não muda', async () => {
    const c = await criarCenario()

    const resposta = await comAuditoriaFalhando(c.tenant.id, () =>
      request(c.app)
        .put('/api/templates/atual')
        .set('Cookie', c.cookieAdmin)
        .send({ layoutJson: { formato: 'A4', orientacao: 'retrato', secoes: [] } }),
    )

    expect(resposta.status).toBe(500)
    expect(await contar('SELECT 1 FROM templates WHERE tenant_id = $1', [c.tenant.id])).toBe(1)
    const { rows } = await adminPool.query<{ template_id: string }>(
      'SELECT template_id FROM tenants_template_ativo WHERE tenant_id = $1',
      [c.tenant.id],
    )
    expect(rows[0]?.template_id).toBe(c.tenant.templateId)
  })
})

describe('sessão (login/logout + auditoria)', () => {
  it('quando a auditoria falha no login, então o login é recusado e nenhuma sessão fica criada', async () => {
    const tenant = await criarTenant()
    const usuario = await criarUsuario(tenant.id, 'operador')

    const resposta = await comAuditoriaFalhando(tenant.id, async () =>
      request(await novoApp())
        .post('/api/auth/login')
        .send({ email: usuario.email, senha: usuario.senha }),
    )

    expect(resposta.status).toBe(500)
    expect(resposta.headers['set-cookie']).toBeUndefined()
    expect(await contar('SELECT 1 FROM sessoes WHERE usuario_id = $1', [usuario.id])).toBe(0)
    expect(await auditorias(tenant.id, 'login')).toBe(0)
  })

  it('quando a auditoria falha no logout, então o logout é recusado e a sessão continua válida', async () => {
    const tenant = await criarTenant()
    const usuario = await criarUsuario(tenant.id, 'operador')
    const cookie = await entrar(usuario)
    expect(await contar('SELECT 1 FROM sessoes WHERE usuario_id = $1', [usuario.id])).toBe(1)

    const resposta = await comAuditoriaFalhando(tenant.id, async () =>
      request(await novoApp())
        .post('/api/auth/logout')
        .set('Cookie', cookie),
    )

    expect(resposta.status).toBe(500)
    expect(await contar('SELECT 1 FROM sessoes WHERE usuario_id = $1', [usuario.id])).toBe(1)
    expect(await auditorias(tenant.id, 'logout')).toBe(0)

    // Sem a falha, o logout apaga a sessão e audita.
    const ok = await request(await novoApp())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
    expect(ok.status).toBe(200)
    expect(await contar('SELECT 1 FROM sessoes WHERE usuario_id = $1', [usuario.id])).toBe(0)
    expect(await auditorias(tenant.id, 'logout')).toBe(1)
  })
})

describe('job de limpeza de PDFs (referência + auditoria no banco, depois o arquivo no disco)', () => {
  it('quando a auditoria falha, então a referência do PDF permanece no banco e o arquivo NÃO é apagado do disco; sem a falha, limpa os dois', async () => {
    const c = await criarCenario()
    const { versao } = await criarEnviado(c)
    const { rows: antes } = await adminPool.query<{
      pdf_path: string | null
      pdf_hash: string | null
    }>('SELECT pdf_path, pdf_hash FROM orcamento_versoes WHERE id = $1', [versao.id])
    expect(antes[0]?.pdf_path).toBeTruthy()
    expect(antes[0]?.pdf_hash).toBeTruthy()

    // O job é de manutenção cross-tenant e roda com papel privilegiado (sem RLS).
    const dbAdmin = new Kysely<Database>({ dialect: new PostgresDialect({ pool: adminPool }) })
    const repoReal = criarLimparPdfsRepositorio(dbAdmin)
    const rm = vi.fn().mockResolvedValue(undefined)
    const job = criarLimparPdfsJob({
      // Restringe ao tenant deste teste (o banco de teste é compartilhado).
      repo: {
        ...repoReal,
        listarPdfsExpirados: async (limite) =>
          (await repoReal.listarPdfsExpirados(limite)).filter((p) => p.tenantId === c.tenant.id),
      },
      fs: { rm },
      // "Agora" daqui a 2 anos: a versão recém-enviada passa a ter mais de 1 ano.
      agora: () => new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })

    const falho = await comAuditoriaFalhando(c.tenant.id, () => job.executar())

    expect(falho).toEqual({ removidos: 0, falhas: 1 })
    expect(rm).not.toHaveBeenCalled()
    const { rows: depoisDaFalha } = await adminPool.query<{
      pdf_path: string | null
      pdf_hash: string | null
    }>('SELECT pdf_path, pdf_hash FROM orcamento_versoes WHERE id = $1', [versao.id])
    expect(depoisDaFalha[0]).toEqual(antes[0])
    expect(await auditorias(c.tenant.id, 'limpar_pdf')).toBe(0)

    const ok = await job.executar()

    expect(ok).toEqual({ removidos: 1, falhas: 0 })
    expect(rm).toHaveBeenCalledWith(antes[0]?.pdf_path)
    const { rows: depois } = await adminPool.query<{
      pdf_path: string | null
      pdf_hash: string | null
    }>('SELECT pdf_path, pdf_hash FROM orcamento_versoes WHERE id = $1', [versao.id])
    expect(depois[0]).toEqual({ pdf_path: null, pdf_hash: null })
    expect(await auditorias(c.tenant.id, 'limpar_pdf')).toBe(1)
  })
})
