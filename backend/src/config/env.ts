import { z } from 'zod'

// CRYPTO_KEY deve ser uma chave AES-256 (32 bytes) codificada em base64.
// Valida o formato base64 e o tamanho decodificado para falhar cedo na
// inicialização caso a chave seja inválida.
const cryptoKeySchema = z.string().refine(
  (valor) => {
    try {
      return Buffer.from(valor, 'base64').length === 32
    } catch {
      return false
    }
  },
  { message: 'CRYPTO_KEY deve ser base64 de 32 bytes (AES-256)' },
)

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  CRYPTO_KEY: cryptoKeySchema,
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
