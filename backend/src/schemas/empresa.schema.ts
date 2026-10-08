import { z } from 'zod'

// Validação apenas de forma (shape). As regras de negócio do documento
// (checksum de CNPJ) são validadas no service, que lança AppError(400).
export const criarEmpresaSchema = z.object({
  tipo: z.enum(['tenant', 'cliente_pj']),
  razaoSocial: z.string().min(1),
  nomeFantasia: z.string().optional(),
  cnpj: z.string().optional(),
  email: z.string().email().optional(),
  telefone: z.string().optional(),
  endereco: z.string().optional(),
})

export type CriarEmpresaPayload = z.infer<typeof criarEmpresaSchema>

// tipo e cnpj não são atualizáveis, portanto são omitidos aqui.
export const atualizarEmpresaSchema = z.object({
  razaoSocial: z.string().min(1).optional(),
  nomeFantasia: z.string().optional(),
  email: z.string().email().optional(),
  telefone: z.string().optional(),
  endereco: z.string().optional(),
})

export type AtualizarEmpresaPayload = z.infer<typeof atualizarEmpresaSchema>
