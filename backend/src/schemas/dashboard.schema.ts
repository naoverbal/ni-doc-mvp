import { z } from 'zod'

// Validação dos query params das rotas de dashboard (somente leitura).

export const GRANULARIDADES = ['semana', 'mes', 'ano'] as const

export type Granularidade = (typeof GRANULARIDADES)[number]

// Data civil `AAAA-MM-DD`, rejeitando datas inexistentes (ex.: 2025-02-30).
const dataCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'data deve estar no formato AAAA-MM-DD')
  .refine((valor) => {
    const data = new Date(`${valor}T00:00:00Z`)
    return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(valor)
  }, 'data inválida')

export const criadosQuerySchema = z
  .object({
    granularidade: z.enum(GRANULARIDADES).default('mes'),
    de: dataCivil.optional(),
    ate: dataCivil.optional(),
  })
  .refine((q) => q.de === undefined || q.ate === undefined || q.de <= q.ate, {
    message: 'de deve ser anterior ou igual a ate',
    path: ['de'],
  })

export type CriadosQuery = z.infer<typeof criadosQuerySchema>

export const LIMITE_PADRAO = 5
export const LIMITE_MAXIMO = 50

export const limiteQuerySchema = z.object({
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_PADRAO),
})

export type LimiteQuery = z.infer<typeof limiteQuerySchema>
