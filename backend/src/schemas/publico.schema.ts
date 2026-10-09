import { z } from 'zod'

// Validação de forma das rotas públicas (RF-019). O token vem na URL; o corpo
// do aprovar é vazio e o do reprovar carrega uma justificativa OPCIONAL (a
// semântica — registrar sem comprovante, mudar status para `reprovado` — vive no
// service). `.strict()` rejeita campos extras, protegendo o endpoint público.

export const reprovarPublicoSchema = z
  .object({
    justificativa: z.string().min(1).max(2000).optional(),
  })
  .strict()

export type ReprovarPublicoPayload = z.infer<typeof reprovarPublicoSchema>

// Aprovar não tem corpo relevante; aceita objeto vazio e ignora/recusa extras.
export const aprovarPublicoSchema = z.object({}).strict()

export type AprovarPublicoPayload = z.infer<typeof aprovarPublicoSchema>
