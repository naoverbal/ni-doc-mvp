import { z } from 'zod'

// Validação apenas de forma (shape). As regras de negócio (RF-005: só edita/
// exclui em rascunho, numeração, cálculo de totais) ficam no service/repositório,
// que lançam AppError.

const descontoTipoSchema = z.enum(['percentual', 'fixo'])

const itemSchema = z.object({
  nome: z.string().min(1),
  descricao: z.string().optional(),
  quantidade: z.number().positive(),
  unidade: z.string().optional(),
  valorUnitario: z.number().nonnegative(),
  descontoTipo: descontoTipoSchema.optional(),
  descontoValor: z.number().nonnegative().optional(),
  responsavelId: z.string().uuid().optional(),
})

export const criarOrcamentoSchema = z.object({
  clienteId: z.string().uuid(),
  empresaClienteId: z.string().uuid().optional(),
  titulo: z.string().min(1),
  descricao: z.string().optional(),
  validadeDias: z.number().int().positive().optional(),
  descontoGlobalTipo: descontoTipoSchema.optional(),
  descontoGlobalValor: z.number().nonnegative().optional(),
  observacoes: z.string().optional(),
  condicoesPagamento: z.string().optional(),
  itens: z.array(itemSchema).min(1), // RF-005.4: ao menos um item
})

export type CriarOrcamentoPayload = z.infer<typeof criarOrcamentoSchema>

// Atualização substitui todos os itens (RF-005.5), portanto `itens` é obrigatório;
// os demais campos são opcionais.
export const atualizarOrcamentoSchema = z.object({
  clienteId: z.string().uuid().optional(),
  empresaClienteId: z.string().uuid().optional(),
  titulo: z.string().min(1).optional(),
  descricao: z.string().optional(),
  validadeDias: z.number().int().positive().optional(),
  descontoGlobalTipo: descontoTipoSchema.optional(),
  descontoGlobalValor: z.number().nonnegative().optional(),
  observacoes: z.string().optional(),
  condicoesPagamento: z.string().optional(),
  itens: z.array(itemSchema).min(1),
})

export type AtualizarOrcamentoPayload = z.infer<typeof atualizarOrcamentoSchema>
