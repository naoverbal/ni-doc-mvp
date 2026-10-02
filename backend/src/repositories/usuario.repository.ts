import type { Kysely } from 'kysely'
import type { Database } from '../types/database.js'
import { criptografar, descriptografar, hashDocumento } from '../lib/crypto.js'
import { hashSenha } from '../lib/senha.js'

export interface CriarUsuarioInput {
  tenantId: string
  nome: string
  email: string
  senha: string
  papel: 'admin' | 'operador'
}

export interface UsuarioPublico {
  id: string
  tenantId: string
  nome: string
  email: string
  papel: 'admin' | 'operador'
  ativo: boolean
  criadoEm: Date
}

export interface UsuarioComSenha extends UsuarioPublico {
  senhaHash: string
}

export interface UsuarioRepository {
  criar(input: CriarUsuarioInput): Promise<UsuarioPublico>
  buscarPorEmail(email: string): Promise<UsuarioComSenha | null>
  buscarPorId(id: string): Promise<UsuarioPublico | null>
}

function mapRowToPublico(row: {
  id: string
  tenant_id: string
  nome: string
  email_encrypted: string
  papel: 'admin' | 'operador'
  ativo: boolean
  criado_em: Date
}): UsuarioPublico {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    nome: row.nome,
    email: descriptografar(row.email_encrypted),
    papel: row.papel,
    ativo: row.ativo,
    criadoEm: row.criado_em,
  }
}

export function criarUsuarioRepository(db: Kysely<Database>): UsuarioRepository {
  return {
    async criar(input: CriarUsuarioInput): Promise<UsuarioPublico> {
      const emailNormalizado = input.email.toLowerCase()
      const emailHash = hashDocumento(emailNormalizado)
      const emailEncrypted = criptografar(emailNormalizado)
      const senhaHash = await hashSenha(input.senha)

      const row = await db
        .insertInto('usuarios')
        .values({
          tenant_id: input.tenantId,
          nome: input.nome,
          email_hash: emailHash,
          email_encrypted: emailEncrypted,
          senha_hash: senhaHash,
          papel: input.papel,
        })
        .returning([
          'id',
          'tenant_id',
          'nome',
          'email_encrypted',
          'papel',
          'ativo',
          'criado_em',
        ])
        .executeTakeFirstOrThrow()

      return mapRowToPublico(row)
    },

    async buscarPorEmail(email: string): Promise<UsuarioComSenha | null> {
      const emailHash = hashDocumento(email.toLowerCase())

      const row = await db
        .selectFrom('usuarios')
        .select([
          'id',
          'tenant_id',
          'nome',
          'email_encrypted',
          'senha_hash',
          'papel',
          'ativo',
          'criado_em',
        ])
        .where('email_hash', '=', emailHash)
        .executeTakeFirst()

      if (!row) return null

      return {
        ...mapRowToPublico(row),
        senhaHash: row.senha_hash,
      }
    },

    async buscarPorId(id: string): Promise<UsuarioPublico | null> {
      const row = await db
        .selectFrom('usuarios')
        .select([
          'id',
          'tenant_id',
          'nome',
          'email_encrypted',
          'papel',
          'ativo',
          'criado_em',
        ])
        .where('id', '=', id)
        .executeTakeFirst()

      if (!row) return null

      return mapRowToPublico(row)
    },
  }
}
