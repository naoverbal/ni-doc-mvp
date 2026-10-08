import type { Kysely } from 'kysely'
import type { Database } from '../types/database.js'
import { criptografar, descriptografar } from '../lib/crypto.js'

export interface CriarResponsavelInput {
  tenantId: string
  nome: string
  registroProfissional?: string
  email?: string
  telefone?: string
}

export interface AtualizarResponsavelInput {
  nome?: string
  registroProfissional?: string
  email?: string
  telefone?: string
}

export interface ResponsavelPublico {
  id: string
  tenantId: string
  nome: string
  registroProfissional: string | null
  email: string | null
  telefone: string | null
  ativo: boolean
  criadoEm: Date
}

export interface ResponsavelRepository {
  criar(input: CriarResponsavelInput): Promise<ResponsavelPublico>
  buscarPorId(tenantId: string, id: string): Promise<ResponsavelPublico | null>
  buscarPorNome(tenantId: string, termo: string): Promise<ResponsavelPublico[]>
  atualizar(
    tenantId: string,
    id: string,
    dados: AtualizarResponsavelInput,
  ): Promise<ResponsavelPublico | null>
  desativar(tenantId: string, id: string): Promise<void>
}

interface ResponsavelRow {
  id: string
  tenant_id: string
  nome: string
  registro_profissional: string | null
  email_encrypted: string | null
  telefone_encrypted: string | null
  ativo: boolean
  criado_em: Date
}

function descriptografarOpcional(valor: string | null): string | null {
  return valor === null ? null : descriptografar(valor)
}

function mapRowToPublico(row: ResponsavelRow): ResponsavelPublico {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    nome: row.nome,
    registroProfissional: row.registro_profissional,
    email: descriptografarOpcional(row.email_encrypted),
    telefone: descriptografarOpcional(row.telefone_encrypted),
    ativo: row.ativo,
    criadoEm: row.criado_em,
  }
}

const COLUNAS_PUBLICAS = [
  'id',
  'tenant_id',
  'nome',
  'registro_profissional',
  'email_encrypted',
  'telefone_encrypted',
  'ativo',
  'criado_em',
] as const

export function criarResponsavelRepository(db: Kysely<Database>): ResponsavelRepository {
  return {
    async criar(input: CriarResponsavelInput): Promise<ResponsavelPublico> {
      const row = await db
        .insertInto('responsaveis_tecnicos')
        .values({
          tenant_id: input.tenantId,
          nome: input.nome,
          registro_profissional: input.registroProfissional ?? null,
          email_encrypted: input.email !== undefined ? criptografar(input.email) : null,
          telefone_encrypted: input.telefone !== undefined ? criptografar(input.telefone) : null,
        })
        .returning(COLUNAS_PUBLICAS)
        .executeTakeFirstOrThrow()

      return mapRowToPublico(row as ResponsavelRow)
    },

    async buscarPorId(tenantId: string, id: string): Promise<ResponsavelPublico | null> {
      const row = await db
        .selectFrom('responsaveis_tecnicos')
        .select(COLUNAS_PUBLICAS)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst()

      if (!row) return null
      return mapRowToPublico(row as ResponsavelRow)
    },

    async buscarPorNome(tenantId: string, termo: string): Promise<ResponsavelPublico[]> {
      const rows = await db
        .selectFrom('responsaveis_tecnicos')
        .select(COLUNAS_PUBLICAS)
        .where('tenant_id', '=', tenantId)
        .where('ativo', '=', true)
        .where('nome', 'ilike', `%${termo}%`)
        .orderBy('nome', 'asc')
        .limit(20)
        .execute()

      return rows.map((row) => mapRowToPublico(row as ResponsavelRow))
    },

    async atualizar(
      tenantId: string,
      id: string,
      dados: AtualizarResponsavelInput,
    ): Promise<ResponsavelPublico | null> {
      const set: Record<string, unknown> = { atualizado_em: new Date() }

      if (dados.nome !== undefined) set['nome'] = dados.nome
      if (dados.registroProfissional !== undefined)
        set['registro_profissional'] = dados.registroProfissional
      if (dados.email !== undefined) set['email_encrypted'] = criptografar(dados.email)
      if (dados.telefone !== undefined) set['telefone_encrypted'] = criptografar(dados.telefone)

      const row = await db
        .updateTable('responsaveis_tecnicos')
        .set(set)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .returning(COLUNAS_PUBLICAS)
        .executeTakeFirst()

      if (!row) return null
      return mapRowToPublico(row as ResponsavelRow)
    },

    async desativar(tenantId: string, id: string): Promise<void> {
      await db
        .updateTable('responsaveis_tecnicos')
        .set({ ativo: false, atualizado_em: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst()
    },
  }
}
