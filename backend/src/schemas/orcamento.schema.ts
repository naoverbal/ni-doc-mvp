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

// Aceite manual (RF-020): o operador registra que o cliente aprovou por outro
// canal. A justificativa é OBRIGATÓRIA (RF-020.1); `.trim()` evita só espaços.
// `.strict()` recusa campos extras. A semântica (registrar operador, mudar
// status para `aprovado`) vive no service de aceite.
export const aceiteManualSchema = z
  .object({
    justificativa: z.string().trim().min(1).max(2000),
  })
  .strict()

export type AceiteManualPayload = z.infer<typeof aceiteManualSchema>
