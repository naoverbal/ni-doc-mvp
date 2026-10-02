// Global setup runs in the main process BEFORE any test workers are spawned.
// Env vars set here are inherited by all worker processes via process.env.
export function setup(): void {
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test'
  process.env['CRYPTO_KEY'] = Buffer.alloc(32).toString('base64')
  process.env['SESSION_SECRET'] = 'test-secret-com-pelo-menos-32-caracteres-aqui'
  process.env['NODE_ENV'] = 'test'
}
