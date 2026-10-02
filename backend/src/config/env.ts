import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  CRYPTO_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  PDFS_DIR: z.string().default('/var/ni-doc/pdfs'),
})

export type Env = z.infer<typeof envSchema>

// Lazy singleton — parses process.env on first property access so that
// test setupFiles (which set the vars) always run before validation.
let _parsed: Env | undefined

export function _resetEnvCache(): void {
  _parsed = undefined
}

function getEnv(): Env {
  if (!_parsed) {
    _parsed = envSchema.parse(process.env)
  }
  return _parsed
}

export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof Env]
  },
})
