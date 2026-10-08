// setupFiles: executado antes de cada arquivo de teste.
// Garante variáveis de ambiente necessárias para os módulos que leem `env`
// (ex.: config/env.ts) mesmo quando o teste importa esses módulos no topo.
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test'
process.env['CRYPTO_KEY'] = Buffer.alloc(32).toString('base64')
process.env['SESSION_SECRET'] = 'test-secret-com-pelo-menos-32-caracteres-aqui'
process.env['NODE_ENV'] = 'test'
