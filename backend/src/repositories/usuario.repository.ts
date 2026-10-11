import type { Kysely } from 'kysely'
import { sql } from 'kysely'
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
        .returning(['id', 'tenant_id', 'nome', 'email_encrypted', 'papel', 'ativo', 'criado_em'])
        .executeTakeFirstOrThrow()

      return mapRowToPublico(row)
    },

    // Lookup de bootstrap (login): ocorre ANTES de haver tenant no contexto, por
    // isso usa a função SECURITY DEFINER `rls_usuario_por_email_hash` (migration
    // 004), que faz a busca estrita por hash contornando o RLS apenas aqui. Com
    // o papel não-privilegiado, uma SELECT direta em `usuarios` sem
    // `app.current_tenant` retornaria vazio.
    async buscarPorEmail(email: string): Promise<UsuarioComSenha | null> {
      const emailHash = hashDocumento(email.toLowerCase())

      const resultado = await sql<{
        id: string
        tenant_id: string
        nome: string
        email_encrypted: string
        senha_hash: string
        papel: 'admin' | 'operador'
        ativo: boolean
        criado_em: Date
      }>`SELECT * FROM rls_usuario_por_email_hash(${emailHash})`.execute(db)

      const row = resultado.rows[0]
      if (!row) return null

      return {
        ...mapRowToPublico(row),
        senhaHash: row.senha_hash,
      }
    },

    // Lookup de bootstrap (validação de sessão): também ocorre antes do tenant
    // ser definido, logo usa a função SECURITY DEFINER `rls_usuario_por_id`.
    async buscarPorId(id: string): Promise<UsuarioPublico | null> {
      const resultado = await sql<{
        id: string
        tenant_id: string
        nome: string
        email_encrypted: string
        papel: 'admin' | 'operador'
        ativo: boolean
        criado_em: Date
      }>`SELECT * FROM rls_usuario_por_id(${id})`.execute(db)

      const row = resultado.rows[0]
      if (!row) return null

      return mapRowToPublico(row)
    },
  }
}
