import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(8),
})

export type LoginPayload = z.infer<typeof loginSchema>
