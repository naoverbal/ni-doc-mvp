import { z } from 'zod'

// Validação apenas de forma (shape). Responsáveis técnicos não possuem documento,
// portanto não há regras de negócio adicionais além do shape (nenhuma validação
// de checksum/duplicidade no service).
export const criarResponsavelSchema = z.object({
  nome: z.string().min(1),
  registroProfissional: z.string().optional(),
  email: z.string().email().optional(),
  telefone: z.string().optional(),
})

export type CriarResponsavelPayload = z.infer<typeof criarResponsavelSchema>

// Todos os campos são opcionais na atualização.
export const atualizarResponsavelSchema = z.object({
  nome: z.string().min(1).optional(),
  registroProfissional: z.string().optional(),
  email: z.string().email().optional(),
  telefone: z.string().optional(),
})

export type AtualizarResponsavelPayload = z.infer<typeof atualizarResponsavelSchema>
