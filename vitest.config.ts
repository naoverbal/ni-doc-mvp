import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['backend/src/**/*.test.ts'],
    setupFiles: ['backend/src/__tests__/setup.ts'],
    globalSetup: ['backend/src/__tests__/global-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      exclude: [
        'node_modules/**',
        'dist/**',
        'backend/src/__tests__/**',
        'backend/src/db/migrations/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './backend/src'),
    },
  },
})
