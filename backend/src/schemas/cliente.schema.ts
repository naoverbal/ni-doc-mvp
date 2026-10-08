import { z } from 'zod'

// Validação apenas de forma (shape). As regras de negócio do documento
// (checksum de CPF/CNPJ) são validadas no service, que lança AppError(400).
export const criarClienteSchema = z.object({
  tipoPessoa: z.enum(['PF', 'PJ']),
  nome: z.string().min(1),
  documento: z.string().min(1),
  email: z.string().email().optional(),
  telefone: z.string().optional(),
  endereco: z.string().optional(),
  observacoes: z.string().optional(),
})

export type CriarClientePayload = z.infer<typeof criarClienteSchema>

// tipoPessoa e documento não são atualizáveis, portanto são omitidos aqui.
export const atualizarClienteSchema = z.object({
  nome: z.string().min(1).optional(),
  email: z.string().email().optional(),
  telefone: z.string().optional(),
  endereco: z.string().optional(),
  observacoes: z.string().optional(),
})

export type AtualizarClientePayload = z.infer<typeof atualizarClienteSchema>
