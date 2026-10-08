import pg from 'pg'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashSenha } from '../lib/senha.js'
import { criptografar, hashDocumento } from '../lib/crypto.js'
import {
  calcularTotalItem,
  calcularSubtotal,
  calcularTotal,
  type ItemCalculo,
} from '../lib/orcamento-calculo.js'

const { Pool } = pg

if (process.env['NODE_ENV'] === 'production') {
  console.error('Seed não deve ser executado em produção!')
  process.exit(1)
}

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) {
  console.error('DATABASE_URL não definido')
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL })

// IDs determinísticos — permitem idempotência via chave primária / ON CONFLICT.
const TENANT_ALPHA = 'a0000000-0000-0000-0000-000000000001'
const TENANT_BETA = 'b0000000-0000-0000-0000-000000000002'

// =====================================================
// USUÁRIOS (1 admin + 1 operador por tenant)
// email_hash = hashDocumento(email) — mesma convenção do login
//   (usuario.repository.buscarPorEmail usa hashDocumento(email.toLowerCase())).
// email_encrypted = criptografar(email) — AES-256-GCM (lib/crypto.ts),
//   de modo que buscarPorId/buscarPorEmail conseguem descriptografar.
// senha_hash = hashSenha(senha) — Argon2id (lib/senha.ts), permitindo login.
// =====================================================
interface SeedUsuario {
  id: string
  tenantId: string
  nome: string
  email: string
  senha: string
  papel: 'admin' | 'operador'
}

const USUARIOS: SeedUsuario[] = [
  {
    id: 'a0000000-0000-0000-0001-000000000001',
    tenantId: TENANT_ALPHA,
    nome: 'Admin Alpha',
    email: 'admin@alpha.dev',
    senha: 'dev_admin_alpha_123',
    papel: 'admin',
  },
  {
    id: 'a0000000-0000-0000-0001-000000000002',
    tenantId: TENANT_ALPHA,
    nome: 'Operador Alpha',
    email: 'operador@alpha.dev',
    senha: 'dev_operador_alpha_123',
    papel: 'operador',
  },
  {
    id: 'b0000000-0000-0000-0001-000000000001',
    tenantId: TENANT_BETA,
    nome: 'Admin Beta',
    email: 'admin@beta.dev',
    senha: 'dev_admin_beta_123',
    papel: 'admin',
  },
  {
    id: 'b0000000-0000-0000-0001-000000000002',
    tenantId: TENANT_BETA,
    nome: 'Operador Beta',
    email: 'operador@beta.dev',
    senha: 'dev_operador_beta_123',
    papel: 'operador',
  },
]

// =====================================================
// CLIENTES (3 por tenant)
// documento_hash = hashDocumento(doc), documento_encrypted = criptografar(doc).
// =====================================================
interface SeedCliente {
  id: string
  tenantId: string
  tipoPessoa: 'PF' | 'PJ'
  nome: string
  documento: string
}

const CLIENTES: SeedCliente[] = [
  {
    id: 'a0000000-0000-0000-0002-000000000001',
    tenantId: TENANT_ALPHA,
    tipoPessoa: 'PF',
    nome: 'João Silva Alpha',
    documento: '52998224725', // CPF válido
  },
  {
    id: 'a0000000-0000-0000-0002-000000000002',
    tenantId: TENANT_ALPHA,
    tipoPessoa: 'PJ',
    nome: 'Empresa Alpha Ltda',
    documento: '11444777000161', // CNPJ válido
  },
  {
    id: 'a0000000-0000-0000-0002-000000000003',
    tenantId: TENANT_ALPHA,
    tipoPessoa: 'PF',
    nome: 'Maria Souza Alpha',
    documento: '15350946056', // CPF válido
  },
  {
    id: 'b0000000-0000-0000-0002-000000000001',
    tenantId: TENANT_BETA,
    tipoPessoa: 'PF',
    nome: 'Carlos Lima Beta',
    documento: '71428793860', // CPF válido
  },
  {
    id: 'b0000000-0000-0000-0002-000000000002',
    tenantId: TENANT_BETA,
    tipoPessoa: 'PJ',
    nome: 'Empresa Beta S/A',
    documento: '45723174000110', // CNPJ válido
  },
  {
    id: 'b0000000-0000-0000-0002-000000000003',
    tenantId: TENANT_BETA,
    tipoPessoa: 'PF',
    nome: 'Ana Costa Beta',
    documento: '40532176871', // CPF válido
  },
]

// =====================================================
// ORÇAMENTO RASCUNHO (1 por tenant)
// Vinculado ao primeiro cliente e ao admin de cada tenant.
// Totais calculados com lib/orcamento-calculo.ts para consistência.
// =====================================================
interface SeedItem {
  nome: string
  quantidade: number
  valorUnitario: number
  responsavelId: string
}

interface SeedOrcamento {
  id: string
  tenantId: string
  numero: string
  clienteId: string
  usuarioId: string
  titulo: string
  itens: SeedItem[]
}

const ORCAMENTOS: SeedOrcamento[] = [
  {
    id: 'a0000000-0000-0000-0005-000000000001',
    tenantId: TENANT_ALPHA,
    numero: 'ORC-2025-0001',
    clienteId: 'a0000000-0000-0000-0002-000000000001',
    usuarioId: 'a0000000-0000-0000-0001-000000000001',
    titulo: 'Projeto estrutural residencial',
    itens: [
      {
        nome: 'Projeto estrutural',
        quantidade: 1,
        valorUnitario: 5000,
        responsavelId: 'a0000000-0000-0000-0004-000000000001',
      },
      {
        nome: 'ART / responsabilidade técnica',
        quantidade: 1,
        valorUnitario: 350,
        responsavelId: 'a0000000-0000-0000-0004-000000000001',
      },
    ],
  },
  {
    id: 'b0000000-0000-0000-0005-000000000001',
    tenantId: TENANT_BETA,
    numero: 'ORC-2025-0001',
    clienteId: 'b0000000-0000-0000-0002-000000000001',
    usuarioId: 'b0000000-0000-0000-0001-000000000001',
    titulo: 'Projeto arquitetônico comercial',
    itens: [
      {
        nome: 'Projeto arquitetônico',
        quantidade: 1,
        valorUnitario: 8000,
        responsavelId: 'b0000000-0000-0000-0004-000000000002',
      },
      {
        nome: 'Aprovação na prefeitura',
        quantidade: 1,
        valorUnitario: 1200,
        responsavelId: 'b0000000-0000-0000-0004-000000000002',
      },
    ],
  },
]

async function seedUsuarios(client: pg.PoolClient): Promise<void> {
  console.log('[seed] Inserindo usuários (criptografia + hash via libs)...')
  for (const u of USUARIOS) {
    const emailNorm = u.email.toLowerCase()
    const emailHash = hashDocumento(emailNorm)
    const emailEncrypted = criptografar(emailNorm)
    const senhaHash = await hashSenha(u.senha)

    await client.query(
      `INSERT INTO usuarios (id, tenant_id, nome, email_hash, email_encrypted, senha_hash, papel)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.tenantId, u.nome, emailHash, emailEncrypted, senhaHash, u.papel],
    )
  }
}

async function seedClientes(client: pg.PoolClient): Promise<void> {
  console.log('[seed] Inserindo clientes (criptografia + hash via libs)...')
  for (const c of CLIENTES) {
    const documentoHash = hashDocumento(c.documento)
    const documentoEncrypted = criptografar(c.documento)

    await client.query(
      `INSERT INTO clientes (id, tenant_id, tipo_pessoa, nome, documento_hash, documento_encrypted)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [c.id, c.tenantId, c.tipoPessoa, c.nome, documentoHash, documentoEncrypted],
    )
  }
}

async function seedOrcamentos(client: pg.PoolClient): Promise<void> {
  console.log('[seed] Inserindo orçamentos rascunho (1 por tenant)...')
  for (const o of ORCAMENTOS) {
    const itensCalculo: ItemCalculo[] = o.itens.map((it) => ({
      quantidade: it.quantidade,
      valorUnitario: it.valorUnitario,
    }))
    const subtotal = calcularSubtotal(itensCalculo)
    const total = calcularTotal(subtotal)

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO orcamentos
         (id, tenant_id, numero, cliente_id, usuario_id, titulo, status, subtotal, total)
       VALUES ($1, $2, $3, $4, $5, $6, 'rascunho', $7, $8)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [o.id, o.tenantId, o.numero, o.clienteId, o.usuarioId, o.titulo, subtotal, total],
    )

    // Insere itens apenas se o orçamento foi criado agora (evita duplicação).
    if (inserted.rowCount && inserted.rowCount > 0) {
      let ordem = 1
      for (const it of o.itens) {
        const totalItem = calcularTotalItem({
          quantidade: it.quantidade,
          valorUnitario: it.valorUnitario,
        })
        await client.query(
          `INSERT INTO orcamento_itens
             (orcamento_id, ordem, nome, quantidade, valor_unitario, total, responsavel_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [o.id, ordem, it.nome, it.quantidade, it.valorUnitario, totalItem, it.responsavelId],
        )
        ordem += 1
      }
    }
  }
}

async function runSeed(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // RLS tem FORCE habilitado; o seed insere dados de múltiplos tenants.
    // Desabilitar row_security na transação (requer superusuário/BYPASSRLS,
    // o caso padrão em desenvolvimento) permite inserir sem WITH CHECK barrar.
    await client.query('SET LOCAL row_security = off')

    // 1. Dados determinísticos e não-sensíveis (tenants, responsáveis,
    //    templates, template ativo) via SQL idempotente.
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const seedSql = await readFile(join(__dirname, 'migrations', '003_seed_dev.sql'), 'utf-8')
    console.log('[seed] Executando 003_seed_dev.sql...')
    await client.query(seedSql)

    // 2. Dados sensíveis e dependentes (ordem respeita FKs).
    await seedUsuarios(client)
    await seedClientes(client)
    await seedOrcamentos(client)

    await client.query('COMMIT')
    console.log('[seed] Seed de desenvolvimento concluído.')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

runSeed().catch((err: unknown) => {
  console.error('[seed] Erro:', err)
  process.exit(1)
})
