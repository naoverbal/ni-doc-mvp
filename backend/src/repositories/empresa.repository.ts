import type { Kysely } from 'kysely'
import type { Database } from '../types/database.js'
import { criptografar, descriptografar, hashDocumento } from '../lib/crypto.js'

export interface CriarEmpresaInput {
  tenantId: string
  tipo: 'tenant' | 'cliente_pj'
  razaoSocial: string
  nomeFantasia?: string
  cnpj?: string
  email?: string
  telefone?: string
  endereco?: string
}

export interface AtualizarEmpresaInput {
  razaoSocial?: string
  nomeFantasia?: string
  email?: string
  telefone?: string
  endereco?: string
}

export interface EmpresaPublica {
  id: string
  tenantId: string
  tipo: 'tenant' | 'cliente_pj'
  razaoSocial: string
  nomeFantasia: string | null
  cnpj: string | null
  email: string | null
  telefone: string | null
  endereco: string | null
  ativo: boolean
  criadoEm: Date
}

export interface EmpresaRepository {
  criar(input: CriarEmpresaInput): Promise<EmpresaPublica>
  buscarPorCnpjHash(tenantId: string, cnpjHash: string): Promise<EmpresaPublica | null>
  buscarPorId(tenantId: string, id: string): Promise<EmpresaPublica | null>
  buscarPorNomeETipo(
    tenantId: string,
    termo: string,
    tipo: 'tenant' | 'cliente_pj',
  ): Promise<EmpresaPublica[]>
  atualizar(
    tenantId: string,
    id: string,
    dados: AtualizarEmpresaInput,
  ): Promise<EmpresaPublica | null>
  desativar(tenantId: string, id: string): Promise<void>
}

interface EmpresaRow {
  id: string
  tenant_id: string
  tipo: 'tenant' | 'cliente_pj'
  razao_social: string
  nome_fantasia: string | null
  cnpj_encrypted: string | null
  email_encrypted: string | null
  telefone_encrypted: string | null
  endereco_encrypted: string | null
  ativo: boolean
  criado_em: Date
}

function descriptografarOpcional(valor: string | null): string | null {
  return valor === null ? null : descriptografar(valor)
}

function mapRowToPublico(row: EmpresaRow): EmpresaPublica {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tipo: row.tipo,
    razaoSocial: row.razao_social,
    nomeFantasia: row.nome_fantasia,
    cnpj: descriptografarOpcional(row.cnpj_encrypted),
    email: descriptografarOpcional(row.email_encrypted),
    telefone: descriptografarOpcional(row.telefone_encrypted),
    endereco: descriptografarOpcional(row.endereco_encrypted),
    ativo: row.ativo,
    criadoEm: row.criado_em,
  }
}

const COLUNAS_PUBLICAS = [
  'id',
  'tenant_id',
  'tipo',
  'razao_social',
  'nome_fantasia',
  'cnpj_encrypted',
  'email_encrypted',
  'telefone_encrypted',
  'endereco_encrypted',
  'ativo',
  'criado_em',
] as const

export function criarEmpresaRepository(db: Kysely<Database>): EmpresaRepository {
  return {
    async criar(input: CriarEmpresaInput): Promise<EmpresaPublica> {
      const cnpjHash = input.cnpj !== undefined ? hashDocumento(input.cnpj) : null
      const cnpjEncrypted = input.cnpj !== undefined ? criptografar(input.cnpj) : null

      const row = await db
        .insertInto('empresas')
        .values({
          tenant_id: input.tenantId,
          tipo: input.tipo,
          razao_social: input.razaoSocial,
          nome_fantasia: input.nomeFantasia ?? null,
          cnpj_hash: cnpjHash,
          cnpj_encrypted: cnpjEncrypted,
          email_encrypted: input.email !== undefined ? criptografar(input.email) : null,
          telefone_encrypted: input.telefone !== undefined ? criptografar(input.telefone) : null,
          endereco_encrypted: input.endereco !== undefined ? criptografar(input.endereco) : null,
        })
        .returning(COLUNAS_PUBLICAS)
        .executeTakeFirstOrThrow()

      return mapRowToPublico(row as EmpresaRow)
    },

    async buscarPorCnpjHash(tenantId: string, cnpjHash: string): Promise<EmpresaPublica | null> {
      const row = await db
        .selectFrom('empresas')
        .select(COLUNAS_PUBLICAS)
        .where('tenant_id', '=', tenantId)
        .where('cnpj_hash', '=', cnpjHash)
        .executeTakeFirst()

      if (!row) return null
      return mapRowToPublico(row as EmpresaRow)
    },

    async buscarPorId(tenantId: string, id: string): Promise<EmpresaPublica | null> {
      const row = await db
        .selectFrom('empresas')
        .select(COLUNAS_PUBLICAS)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst()

      if (!row) return null
      return mapRowToPublico(row as EmpresaRow)
    },

    async buscarPorNomeETipo(
      tenantId: string,
      termo: string,
      tipo: 'tenant' | 'cliente_pj',
    ): Promise<EmpresaPublica[]> {
      const rows = await db
        .selectFrom('empresas')
        .select(COLUNAS_PUBLICAS)
        .where('tenant_id', '=', tenantId)
        .where('tipo', '=', tipo)
        .where('ativo', '=', true)
        .where('razao_social', 'ilike', `%${termo}%`)
        .orderBy('razao_social', 'asc')
        .limit(20)
        .execute()

      return rows.map((row) => mapRowToPublico(row as EmpresaRow))
    },

    async atualizar(
      tenantId: string,
      id: string,
      dados: AtualizarEmpresaInput,
    ): Promise<EmpresaPublica | null> {
      const set: Record<string, unknown> = { atualizado_em: new Date() }

      if (dados.razaoSocial !== undefined) set['razao_social'] = dados.razaoSocial
      if (dados.nomeFantasia !== undefined) set['nome_fantasia'] = dados.nomeFantasia
      if (dados.email !== undefined) set['email_encrypted'] = criptografar(dados.email)
      if (dados.telefone !== undefined) set['telefone_encrypted'] = criptografar(dados.telefone)
      if (dados.endereco !== undefined) set['endereco_encrypted'] = criptografar(dados.endereco)

      const row = await db
        .updateTable('empresas')
        .set(set)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .returning(COLUNAS_PUBLICAS)
        .executeTakeFirst()

      if (!row) return null
      return mapRowToPublico(row as EmpresaRow)
    },

    async desativar(tenantId: string, id: string): Promise<void> {
      await db
        .updateTable('empresas')
        .set({ ativo: false, atualizado_em: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst()
    },
  }
}
