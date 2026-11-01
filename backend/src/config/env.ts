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
  // Conexão do BACKEND em runtime: use o papel de aplicação SEM `BYPASSRLS`
  // (ni_doc_app), para que as policies de RLS filtrem por tenant (RF-002).
  DATABASE_URL: z.string().url(),
  // Conexão PRIVILEGIADA (owner/superusuário), reservada a `migrate`/`seed`.
  // Opcional: quando ausente, as ferramentas de schema caem para DATABASE_URL.
  DATABASE_URL_ADMIN: z.string().url().optional(),
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
  // Número de proxies reversos CONFIÁVEIS na frente do backend (auditoria B-6).
  // Define quantos saltos de `X-Forwarded-For` o Express aceita para calcular
  // `req.ip` (usado pelos rate limits e pelas evidências de aceite). 0 = não
  // confiar em nenhum cabeçalho (padrão seguro; `req.ip` é o IP da conexão).
  // Atrás só do Nginx do repositório use 1; com Cloudflare + Nginx use 2. Valor
  // maior que o real deixa o cliente forjar o IP; menor faz todos parecerem o proxy.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
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
