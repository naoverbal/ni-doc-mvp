import { z } from 'zod'

// Validação apenas de forma (shape). As regras de negócio (RF-005: só edita/
// exclui em rascunho, numeração, cálculo de totais) ficam no service/repositório,
// que lançam AppError.

const descontoTipoSchema = z.enum(['percentual', 'fixo'])

// Tetos de entrada (auditoria B-9). Alinhados às colunas do banco: valores em
// NUMERIC(12,2) (máx. 9.999.999.999,99), quantidade em NUMERIC(12,4), nome e título
// em VARCHAR(255), unidade em VARCHAR(20). Sem teto, um valor grande estoura a
// coluna e vira erro 500 em vez de 400, e um corpo enorme gasta memória e disco.
// O teto de cada item (bruto) e a quantidade de itens garantem que subtotal e
// total (soma dos itens) nunca ultrapassem NUMERIC(12,2): 200 x 40 mi = 8 bi.
const MAX_ITENS = 200
const MAX_BRUTO_ITEM = 40_000_000
const MAX_VALOR_MONETARIO = 9_999_999_999.99
const MAX_QUANTIDADE = 1_000_000
const MAX_DIAS = 3650
const MAX_CONDICOES = 24
const MAX_TEXTO_LONGO = 10_000
const MAX_TEXTO_CURTO = 255

// Desconto percentual não pode passar de 100%; o fixo fica limitado ao valor
// monetário máximo. O tipo "fixo" maior que o bruto continua permitido: o cálculo
// no servidor trava o total em zero (nunca negativo).
function validarDesconto(
  tipo: 'percentual' | 'fixo' | undefined,
  valor: number | undefined,
  caminho: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (tipo === 'percentual' && valor !== undefined && valor > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: caminho,
      message: 'O desconto percentual não pode ser maior que 100',
    })
  }
}

const itemSchema = z
  .object({
    nome: z.string().min(1).max(MAX_TEXTO_CURTO),
    descricao: z.string().max(MAX_TEXTO_LONGO).optional(),
    quantidade: z.number().positive().max(MAX_QUANTIDADE),
    unidade: z.string().max(20).optional(),
    valorUnitario: z.number().nonnegative().max(MAX_VALOR_MONETARIO),
    descontoTipo: descontoTipoSchema.optional(),
    descontoValor: z.number().nonnegative().max(MAX_VALOR_MONETARIO).optional(),
    responsavelId: z.string().uuid().optional(),
  })
  .superRefine((item, ctx) => {
    if (item.quantidade * item.valorUnitario > MAX_BRUTO_ITEM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valorUnitario'],
        message: 'O valor do item (quantidade x valor unitário) excede o limite permitido',
      })
    }
    validarDesconto(item.descontoTipo, item.descontoValor, ['descontoValor'], ctx)
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

// Regras de nível do orçamento: desconto global percentual limitado a 100.
function validarOrcamento(
  dados: {
    descontoGlobalTipo?: 'percentual' | 'fixo' | undefined
    descontoGlobalValor?: number | undefined
    condicoesPagamento?: { percentual: number }[] | undefined
  },
  ctx: z.RefinementCtx,
): void {
  validarDesconto(dados.descontoGlobalTipo, dados.descontoGlobalValor, ['descontoGlobalValor'], ctx)
  validarSomaPercentuais(dados.condicoesPagamento, ctx)
}

export const criarOrcamentoSchema = z
  .object({
    clienteId: z.string().uuid(),
    empresaClienteId: z.string().uuid().optional(),
    titulo: z.string().min(1).max(MAX_TEXTO_CURTO),
    descricao: z.string().max(MAX_TEXTO_LONGO).optional(),
    validadeDias: z.number().int().positive().max(MAX_DIAS).optional(),
    prazoEntregaDias: z.number().int().positive().max(MAX_DIAS).optional(),
    descontoGlobalTipo: descontoTipoSchema.optional(),
    descontoGlobalValor: z.number().nonnegative().max(MAX_VALOR_MONETARIO).optional(),
    observacoes: z.string().max(MAX_TEXTO_LONGO).optional(),
    condicoesPagamento: z.array(condicaoPagamentoSchema).max(MAX_CONDICOES).optional(),
    itens: z.array(itemSchema).min(1).max(MAX_ITENS), // RF-005.4: ao menos um item
  })
  .superRefine(validarOrcamento)

export type CriarOrcamentoPayload = z.infer<typeof criarOrcamentoSchema>

// Atualização substitui todos os itens (RF-005.5), portanto `itens` é obrigatório;
// os demais campos são opcionais.
export const atualizarOrcamentoSchema = z
  .object({
    clienteId: z.string().uuid().optional(),
    empresaClienteId: z.string().uuid().optional(),
    titulo: z.string().min(1).max(MAX_TEXTO_CURTO).optional(),
    descricao: z.string().max(MAX_TEXTO_LONGO).optional(),
    validadeDias: z.number().int().positive().max(MAX_DIAS).optional(),
    prazoEntregaDias: z.number().int().positive().max(MAX_DIAS).optional(),
    descontoGlobalTipo: descontoTipoSchema.optional(),
    descontoGlobalValor: z.number().nonnegative().max(MAX_VALOR_MONETARIO).optional(),
    observacoes: z.string().max(MAX_TEXTO_LONGO).optional(),
    condicoesPagamento: z.array(condicaoPagamentoSchema).max(MAX_CONDICOES).optional(),
    itens: z.array(itemSchema).min(1).max(MAX_ITENS),
  })
  .superRefine(validarOrcamento)

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

// Cancelamento (RF-009): exige a senha do usuário logado (confirmação, sem criar
// sessão) e uma justificativa obrigatória. `.strict()` recusa campos extras. A
// senha nunca é aparada nem logada.
export const cancelarOrcamentoSchema = z
  .object({
    senha: z.string().min(1),
    justificativa: z.string().trim().min(1).max(2000),
  })
  .strict()

export type CancelarOrcamentoPayload = z.infer<typeof cancelarOrcamentoSchema>

// Reabertura (RF-008/RF-009): mesmo contrato do cancelamento — senha do usuário
// logado + justificativa obrigatória, sem campos extras.
export const reabrirOrcamentoSchema = cancelarOrcamentoSchema

export type ReabrirOrcamentoPayload = z.infer<typeof reabrirOrcamentoSchema>
