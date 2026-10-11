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

// Condição de pagamento estruturada (RF-005/RF-007). Substitui o antigo campo
// `condicoesPagamento: string` (texto livre), agora DESCONTINUADO como entrada:
// a lista estruturada captura descrição, percentual, marco (opcional) e forma de
// pagamento. A coluna de texto `condicoes_pagamento` permanece no banco só para
// o pipeline de snapshot/PDF, que não é reescrito nesta tarefa.
const condicaoPagamentoSchema = z.object({
  descricao: z.string().min(1),
  percentual: z.number().min(0).max(100),
  marco: z.string().optional(),
  formaPagamento: z.string().min(1),
})

// Tolerância para somar percentuais em ponto flutuante (ex.: 33.33 * 3).
const TOLERANCIA_SOMA = 0.01

// Valida que, havendo condições, a soma dos percentuais é 100 (lista vazia é
// permitida). Mensagem em pt-BR, anexada ao campo `condicoesPagamento`.
function validarSomaPercentuais(
  condicoes: { percentual: number }[] | undefined,
  ctx: z.RefinementCtx,
): void {
  if (condicoes === undefined || condicoes.length === 0) return
  const soma = condicoes.reduce((acc, c) => acc + c.percentual, 0)
  if (Math.abs(soma - 100) > TOLERANCIA_SOMA) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['condicoesPagamento'],
      message: 'A soma dos percentuais das condições de pagamento deve ser 100',
    })
  }
}

export const criarOrcamentoSchema = z
  .object({
    clienteId: z.string().uuid(),
    empresaClienteId: z.string().uuid().optional(),
    titulo: z.string().min(1),
    descricao: z.string().optional(),
    validadeDias: z.number().int().positive().optional(),
    prazoEntregaDias: z.number().int().positive().optional(),
    descontoGlobalTipo: descontoTipoSchema.optional(),
    descontoGlobalValor: z.number().nonnegative().optional(),
    observacoes: z.string().optional(),
    condicoesPagamento: z.array(condicaoPagamentoSchema).optional(),
    itens: z.array(itemSchema).min(1), // RF-005.4: ao menos um item
  })
  .superRefine((dados, ctx) => validarSomaPercentuais(dados.condicoesPagamento, ctx))

export type CriarOrcamentoPayload = z.infer<typeof criarOrcamentoSchema>

// Atualização substitui todos os itens (RF-005.5), portanto `itens` é obrigatório;
// os demais campos são opcionais.
export const atualizarOrcamentoSchema = z
  .object({
    clienteId: z.string().uuid().optional(),
    empresaClienteId: z.string().uuid().optional(),
    titulo: z.string().min(1).optional(),
    descricao: z.string().optional(),
    validadeDias: z.number().int().positive().optional(),
    prazoEntregaDias: z.number().int().positive().optional(),
    descontoGlobalTipo: descontoTipoSchema.optional(),
    descontoGlobalValor: z.number().nonnegative().optional(),
    observacoes: z.string().optional(),
    condicoesPagamento: z.array(condicaoPagamentoSchema).optional(),
    itens: z.array(itemSchema).min(1),
  })
  .superRefine((dados, ctx) => validarSomaPercentuais(dados.condicoesPagamento, ctx))

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
