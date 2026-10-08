import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    setupFiles: ['src/__tests__/setup.ts'],
    globalSetup: ['src/__tests__/global-setup.ts'],
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      CRYPTO_KEY: Buffer.alloc(32).toString('base64'),
      SESSION_SECRET: 'test-secret-com-pelo-menos-32-caracteres-aqui',
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Cobertura mínima do projeto. Conforme o plano de implementação:
      //  - `lib/` exige 100% (regras puras, totalmente testáveis).
      //  - serviços e repositórios exigem 80%+.
      // O threshold global de 80% é a meta documentada do MVP. Enquanto fases
      // posteriores ainda não foram implementadas, use `npm run test:coverage`
      // para medir o progresso; o script `npm test` (vitest run, sem cobertura)
      // é a Definition of Done desta fase e permanece verde.
      // Threshold global de 80% (meta do MVP). Cada arquivo em `lib/` deve
      // manter 100% de cobertura por convenção do plano — verificado no
      // relatório por arquivo em `npm run test:coverage`.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      // Inclui apenas o código-fonte da aplicação para medir cobertura real.
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'coverage/**',
        // Infra de testes e artefatos não testáveis por unidade.
        'src/__tests__/**',
        '**/__tests__/**',
        'src/db/migrations/**',
        // Declarações de tipos e wiring puro (sem lógica a cobrir).
        'src/types/**',
        '**/*.d.ts',
        // Entrypoint do processo e migração são exercitados em runtime/integração.
        'src/server.ts',
        'src/db/migrate.ts',
        'src/db/seed.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
