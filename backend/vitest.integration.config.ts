import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import { PDFS_DIR_TESTE, URL_ADMIN_TESTE, URL_APP_TESTE } from './src/integracao/config-banco'

// Suíte de integração (request specs): bate nas rotas reais com banco real.
// Separada do `vitest.config.ts` (unitário/mockado). Arquivos `*.int.ts` não são
// capturados pelo include padrão do config unitário.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/integracao/**/*.int.ts'],
    pool: 'forks',
    // Os arquivos compartilham o mesmo banco: rodam em sequência. Dentro de um
    // arquivo cada teste usa tenants próprios (UUIDs novos), sem colisão.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globalSetup: ['src/integracao/global-setup.ts'],
    setupFiles: ['src/integracao/setup.ts'],
    env: {
      DATABASE_URL: URL_APP_TESTE,
      DATABASE_URL_ADMIN: URL_ADMIN_TESTE,
      CRYPTO_KEY: Buffer.alloc(32, 7).toString('base64'),
      SESSION_SECRET: 'integracao-secret-com-pelo-menos-32-caracteres',
      NODE_ENV: 'test',
      PDFS_DIR: PDFS_DIR_TESTE,
      // SMTP "configurado" para que o app monte o serviço de e-mail; o
      // transporte (nodemailer) é substituído por um espião em setup.ts.
      SMTP_HOST: 'smtp.teste.local',
      SMTP_PORT: '2525',
      SMTP_FROM: 'ni-doc@teste.local',
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
