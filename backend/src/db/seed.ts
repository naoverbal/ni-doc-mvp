import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashSenha } from '../lib/senha.js';

const { Pool } = pg;

if (process.env['NODE_ENV'] === 'production') {
  console.error('Seed não deve ser executado em produção!');
  process.exit(1);
}

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('DATABASE_URL não definido');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

// IDs dos usuários de dev (correspondentes ao 003_seed_dev.sql)
const DEV_USERS = [
  { id: 'a0000000-0000-0000-0001-000000000001', senha: 'dev_admin_alpha_123' },
  { id: 'a0000000-0000-0000-0001-000000000002', senha: 'dev_operador_alpha_123' },
  { id: 'b0000000-0000-0000-0001-000000000001', senha: 'dev_admin_beta_123' },
  { id: 'b0000000-0000-0000-0001-000000000002', senha: 'dev_operador_beta_123' },
] as const;

async function runSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    // 1. Executar o SQL de seed (idempotente)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const seedSql = await readFile(
      join(__dirname, 'migrations', '003_seed_dev.sql'),
      'utf-8'
    );
    console.log('[seed] Executando 003_seed_dev.sql...');
    await client.query(seedSql);

    // 2. Gerar hashes reais com Argon2 e atualizar senhas
    console.log('[seed] Atualizando hashes de senha...');
    for (const user of DEV_USERS) {
      const hash = await hashSenha(user.senha);
      await client.query(
        'UPDATE usuarios SET senha_hash = $1 WHERE id = $2 AND senha_hash = $3',
        [hash, user.id, 'HASH_PENDENTE']
      );
      console.log(`[seed] Senha atualizada: ${user.id}`);
    }

    console.log('[seed] Seed de desenvolvimento concluído.');
  } finally {
    client.release();
    await pool.end();
  }
}

runSeed().catch((err: unknown) => {
  console.error('[seed] Erro:', err);
  process.exit(1);
});
