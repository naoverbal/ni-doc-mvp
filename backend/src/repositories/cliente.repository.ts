import type { Kysely } from 'kysely'
import type { Database } from '../types/database.js'
import { criptografar, descriptografar, hashDocumento } from '../lib/crypto.js'

export interface CriarClienteInput {
  tenantId: string
  tipoPessoa: 'PF' | 'PJ'
  nome: string
  documento: string
  email?: string
  telefone?: string
  endereco?: string
  observacoes?: string
}

export interface AtualizarClienteInput {
  nome?: string
  email?: string
  telefone?: string
  endereco?: string
  observacoes?: string
}

export interface ClientePublico {
  id: string
  tenantId: string
  tipoPessoa: 'PF' | 'PJ'
  nome: string
  documento: string
  email: string | null
  telefone: string | null
  endereco: string | null
  observacoes: string | null
  ativo: boolean
  criadoEm: Date
}

export interface ClienteRepository {
  criar(input: CriarClienteInput): Promise<ClientePublico>
  buscarPorDocumentoHash(tenantId: string, documentoHash: string): Promise<ClientePublico | null>
  buscarPorId(tenantId: string, id: string): Promise<ClientePublico | null>
  buscarPorNome(tenantId: string, termo: string): Promise<ClientePublico[]>
  atualizar(
    tenantId: string,
    id: string,
    dados: AtualizarClienteInput,
  ): Promise<ClientePublico | null>
  desativar(tenantId: string, id: string): Promise<void>
}

interface ClienteRow {
  id: string
  tenant_id: string
  tipo_pessoa: 'PF' | 'PJ'
  nome: string
  documento_encrypted: string
  email_encrypted: string | null
  telefone_encrypted: string | null
  endereco_encrypted: string | null
  observacoes: string | null
  ativo: boolean
  criado_em: Date
}

function descriptografarOpcional(valor: string | null): string | null {
  return valor === null ? null : descriptografar(valor)
}

function mapRowToPublico(row: ClienteRow): ClientePublico {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tipoPessoa: row.tipo_pessoa,
    nome: row.nome,
    documento: descriptografar(row.documento_encrypted),
    email: descriptografarOpcional(row.email_encrypted),
    telefone: descriptografarOpcional(row.telefone_encrypted),
    endereco: descriptografarOpcional(row.endereco_encrypted),
    observacoes: row.observacoes,
    ativo: row.ativo,
    criadoEm: row.criado_em,
  }
}

const COLUNAS_PUBLICAS = [
  'id',
  'tenant_id',
  'tipo_pessoa',
  'nome',
  'documento_encrypted',
  'email_encrypted',
  'telefone_encrypted',
  'endereco_encrypted',
  'observacoes',
  'ativo',
  'criado_em',
] as const

export function criarClienteRepository(db: Kysely<Database>): ClienteRepository {
  return {
    async criar(input: CriarClienteInput): Promise<ClientePublico> {
      const documentoHash = hashDocumento(input.documento)
      const documentoEncrypted = criptografar(input.documento)

      const row = await db
        .insertInto('clientes')
        .values({
          tenant_id: input.tenantId,
          tipo_pessoa: input.tipoPessoa,
          nome: input.nome,
          documento_hash: documentoHash,
          documento_encrypted: documentoEncrypted,
          email_encrypted: input.email !== undefined ? criptografar(input.email) : null,
          telefone_encrypted: input.telefone !== undefined ? criptografar(input.telefone) : null,
          endereco_encrypted: input.endereco !== undefined ? criptografar(input.endereco) : null,
          observacoes: input.observacoes ?? null,
        })
        .returning(COLUNAS_PUBLICAS)
        .executeTakeFirstOrThrow()

      return mapRowToPublico(row as ClienteRow)
    },

    async buscarPorDocumentoHash(
      tenantId: string,
      documentoHash: string,
    ): Promise<ClientePublico | null> {
      const row = await db
        .selectFrom('clientes')
        .select(COLUNAS_PUBLICAS)
        .where('tenant_id', '=', tenantId)
        .where('documento_hash', '=', documentoHash)
        .executeTakeFirst()

      if (!row) return null
      return mapRowToPublico(row as ClienteRow)
    },

    async buscarPorId(tenantId: string, id: string): Promise<ClientePublico | null> {
      const row = await db
        .selectFrom('clientes')
        .select(COLUNAS_PUBLICAS)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst()

      if (!row) return null
      return mapRowToPublico(row as ClienteRow)
    },

    async buscarPorNome(tenantId: string, termo: string): Promise<ClientePublico[]> {
      const rows = await db
        .selectFrom('clientes')
        .select(COLUNAS_PUBLICAS)
        .where('tenant_id', '=', tenantId)
        .where('ativo', '=', true)
        .where('nome', 'ilike', `%${termo}%`)
        .orderBy('nome', 'asc')
        .limit(20)
        .execute()

      return rows.map((row) => mapRowToPublico(row as ClienteRow))
    },

    async atualizar(
      tenantId: string,
      id: string,
      dados: AtualizarClienteInput,
    ): Promise<ClientePublico | null> {
      const set: Record<string, unknown> = { atualizado_em: new Date() }

      if (dados.nome !== undefined) set['nome'] = dados.nome
      if (dados.email !== undefined) set['email_encrypted'] = criptografar(dados.email)
      if (dados.telefone !== undefined) set['telefone_encrypted'] = criptografar(dados.telefone)
      if (dados.endereco !== undefined) set['endereco_encrypted'] = criptografar(dados.endereco)
      if (dados.observacoes !== undefined) set['observacoes'] = dados.observacoes

      const row = await db
        .updateTable('clientes')
        .set(set)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .returning(COLUNAS_PUBLICAS)
        .executeTakeFirst()

      if (!row) return null
      return mapRowToPublico(row as ClienteRow)
    },

    async desativar(tenantId: string, id: string): Promise<void> {
      await db
        .updateTable('clientes')
        .set({ ativo: false, atualizado_em: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst()
    },
  }
}
