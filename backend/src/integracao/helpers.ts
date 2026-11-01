import { randomInt, randomUUID } from 'node:crypto'
import type { Express } from 'express'
import pg from 'pg'
import request from 'supertest'
import { expect } from 'vitest'
import { criarApp } from '../app.js'
import { criptografar, hashDocumento } from '../lib/crypto.js'
import { hashSenha } from '../lib/senha.js'
import { URL_ADMIN_TESTE } from './config-banco.js'

const { Pool } = pg

// Papel PRIVILEGIADO, usado apenas para semear dados de base (tenants, usuários,
// clientes, template) e para ASSERIR o estado no banco. As operações de negócio
// sempre passam pelas rotas reais, com o papel de aplicação (RLS ativo).
export const adminPool = new Pool({ connectionString: URL_ADMIN_TESTE, max: 4 })

export const SENHA_PADRAO = 'Senha-integracao-123'
let senhaHashCache: string | undefined
async function senhaHash(): Promise<string> {
  senhaHashCache ??= await hashSenha(SENHA_PADRAO)
  return senhaHashCache
}

const tenantsCriados: string[] = []

export interface TenantCriado {
  id: string
  templateId: string
}

export interface UsuarioCriado {
  id: string
  tenantId: string
  nome: string
  email: string
  senha: string
  papel: 'admin' | 'operador'
}

/** Cria um tenant novo com template v1 ativo (UUIDs aleatórios: sem colisão). */
export async function criarTenant(opts: { comTemplate?: boolean } = {}): Promise<TenantCriado> {
  const { comTemplate = true } = opts
  const id = randomUUID()
  const templateId = randomUUID()
  await adminPool.query('INSERT INTO tenants (id, nome) VALUES ($1, $2)', [id, `Tenant ${id}`])
  tenantsCriados.push(id)
  if (comTemplate) {
    const layout = {
      formato: 'A4',
      orientacao: 'retrato',
      secoes: [{ tipo: 'cabecalho' }, { tipo: 'itens' }, { tipo: 'totais' }],
    }
    await adminPool.query(
      'INSERT INTO templates (id, tenant_id, versao, layout_json) VALUES ($1, $2, 1, $3::jsonb)',
      [templateId, id, JSON.stringify(layout)],
    )
    await adminPool.query(
      'INSERT INTO tenants_template_ativo (tenant_id, template_id) VALUES ($1, $2)',
      [id, templateId],
    )
  }
  return { id, templateId }
}

export async function criarUsuario(
  tenantId: string,
  papel: 'admin' | 'operador' = 'operador',
  opts: { ativo?: boolean } = {},
): Promise<UsuarioCriado> {
  const id = randomUUID()
  const email = `${papel}-${id}@teste.dev`
  await adminPool.query(
    `INSERT INTO usuarios (id, tenant_id, nome, email_hash, email_encrypted, senha_hash, papel, ativo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      tenantId,
      `${papel} ${id.slice(0, 8)}`,
      hashDocumento(email),
      criptografar(email),
      await senhaHash(),
      papel,
      opts.ativo ?? true,
    ],
  )
  return { id, tenantId, nome: `${papel} ${id.slice(0, 8)}`, email, senha: SENHA_PADRAO, papel }
}

export async function criarCliente(
  tenantId: string,
  email: string | null = 'cliente@exemplo.com',
): Promise<{ id: string; nome: string }> {
  const id = randomUUID()
  const documento = String(randomInt(10 ** 10, 10 ** 11 - 1))
  const nome = `Cliente ${id.slice(0, 8)}`
  await adminPool.query(
    `INSERT INTO clientes (id, tenant_id, tipo_pessoa, nome, documento_hash, documento_encrypted, email_encrypted)
     VALUES ($1, $2, 'PF', $3, $4, $5, $6)`,
    [
      id,
      tenantId,
      nome,
      hashDocumento(documento),
      criptografar(documento),
      email === null ? null : criptografar(email),
    ],
  )
  return { id, nome }
}

/** Remove (em cascata) todos os tenants criados por este arquivo de teste. */
export async function limparDados(): Promise<void> {
  if (tenantsCriados.length > 0) {
    await removerTenants(adminPool, tenantsCriados)
    tenantsCriados.length = 0
  }
}

/**
 * Remove tenants de teste. Orçamentos saem primeiro (levam versões, aceites e
 * itens em cascata): `orcamento_versoes.template_id` não tem cascade, então os
 * templates só podem sair depois das versões.
 */
export async function removerTenants(pool: pg.Pool, ids: string[]): Promise<void> {
  await pool.query('DELETE FROM orcamentos WHERE tenant_id = ANY($1::uuid[])', [ids])
  await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids])
}

export async function encerrarConexoes(): Promise<void> {
  await adminPool.end().catch(() => undefined)
}

/**
 * App novo a cada chamada: cada instância tem seus próprios rate limiters
 * (store em memória), então testes não consomem a cota uns dos outros. As sessões
 * ficam no banco, então o cookie vale entre instâncias.
 */
export function novoApp(): Express {
  return criarApp()
}

/** Login real pela rota; devolve o cookie de sessão pronto para `.set('Cookie', ...)`. */
export async function entrar(usuario: UsuarioCriado): Promise<string[]> {
  const resposta = await request(novoApp())
    .post('/api/auth/login')
    .send({ email: usuario.email, senha: usuario.senha })
  expect(resposta.status).toBe(200)
  const cookie = resposta.headers['set-cookie'] as unknown as string[] | undefined
  expect(cookie).toBeDefined()
  return cookie ?? []
}

export interface ItemBody {
  nome: string
  quantidade: number
  valorUnitario: number
  descontoTipo?: 'percentual' | 'fixo'
  descontoValor?: number
}

export function corpoOrcamento(
  clienteId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const itens: ItemBody[] = [{ nome: 'Serviço A', quantidade: 2, valorUnitario: 100 }]
  // Título único por padrão: a regra de negócio proíbe o mesmo usuário de criar
  // duas vezes o mesmo orçamento, então os fixtures não podem colidir sem querer.
  return { clienteId, titulo: `Projeto ${randomUUID().slice(0, 8)}`, itens, ...extra }
}

export interface Cenario {
  tenant: TenantCriado
  admin: UsuarioCriado
  operador: UsuarioCriado
  cliente: { id: string; nome: string }
  cookieOperador: string[]
  cookieAdmin: string[]
  app: Express
}

/** Tenant completo: admin, operador, cliente, template ativo e sessões abertas. */
export async function criarCenario(): Promise<Cenario> {
  const tenant = await criarTenant()
  const admin = await criarUsuario(tenant.id, 'admin')
  const operador = await criarUsuario(tenant.id, 'operador')
  const cliente = await criarCliente(tenant.id)
  const cookieOperador = await entrar(operador)
  const cookieAdmin = await entrar(admin)
  return { tenant, admin, operador, cliente, cookieOperador, cookieAdmin, app: novoApp() }
}

export interface OrcamentoCriado {
  id: string
  numero: string
  titulo: string
  status: string
  subtotal: number
  total: number
}

/** Cria um rascunho pela rota real. */
export async function criarRascunho(
  c: Cenario,
  extra: Record<string, unknown> = {},
): Promise<OrcamentoCriado> {
  const resposta = await request(c.app)
    .post('/api/orcamentos')
    .set('Cookie', c.cookieOperador)
    .send(corpoOrcamento(c.cliente.id, extra))
  expect(resposta.status).toBe(201)
  return resposta.body as OrcamentoCriado
}

export interface VersaoCriada {
  id: string
  orcamentoId: string
  versao: number
  tokenPublico: string
  pdfHash: string | null
}

/** Cria e envia um orçamento pelas rotas reais; devolve orçamento e versão (token público). */
export async function criarEnviado(
  c: Cenario,
  extra: Record<string, unknown> = {},
): Promise<{ orcamento: OrcamentoCriado; versao: VersaoCriada }> {
  const orcamento = await criarRascunho(c, extra)
  const resposta = await request(c.app)
    .post(`/api/orcamentos/${orcamento.id}/enviar`)
    .set('Cookie', c.cookieOperador)
  expect(resposta.status).toBe(201)
  return { orcamento, versao: resposta.body as VersaoCriada }
}

// ---- Asserções no banco (papel privilegiado) --------------------------------

export async function statusNoBanco(orcamentoId: string): Promise<string | undefined> {
  const { rows } = await adminPool.query<{ status: string }>(
    'SELECT status FROM orcamentos WHERE id = $1',
    [orcamentoId],
  )
  return rows[0]?.status
}

export async function contarVersoes(orcamentoId: string): Promise<number> {
  const { rows } = await adminPool.query<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM orcamento_versoes WHERE orcamento_id = $1',
    [orcamentoId],
  )
  return Number(rows[0]?.n ?? 0)
}

export async function contarAceites(orcamentoId: string): Promise<number> {
  const { rows } = await adminPool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM orcamento_aceites a
     JOIN orcamento_versoes v ON v.id = a.versao_id WHERE v.orcamento_id = $1`,
    [orcamentoId],
  )
  return Number(rows[0]?.n ?? 0)
}

/** Token que nunca existiu, com formato válido (uuid.hmac-hex de 64 chars). */
export function tokenDesconhecido(): string {
  return `${randomUUID()}.${'a'.repeat(64)}`
}
