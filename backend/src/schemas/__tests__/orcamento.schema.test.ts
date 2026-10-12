import { describe, it, expect } from 'vitest'
import {
  criarOrcamentoSchema,
  atualizarOrcamentoSchema,
} from '../orcamento.schema.js'

const baseCriar = {
  clienteId: '11111111-1111-1111-1111-111111111111',
  titulo: 'Proposta A',
  itens: [{ nome: 'Serviço X', quantidade: 2, valorUnitario: 50 }],
}

describe('orcamento.schema — condições de pagamento e prazo de entrega', () => {
  describe('criarOrcamentoSchema', () => {
    it('aceita payload sem condições (lista opcional)', () => {
      const result = criarOrcamentoSchema.safeParse(baseCriar)
      expect(result.success).toBe(true)
    })

    it('aceita lista vazia de condições', () => {
      const result = criarOrcamentoSchema.safeParse({ ...baseCriar, condicoesPagamento: [] })
      expect(result.success).toBe(true)
    })

    it('aceita condições cuja soma dos percentuais é 100', () => {
      const result = criarOrcamentoSchema.safeParse({
        ...baseCriar,
        prazoEntregaDias: 10,
        condicoesPagamento: [
          { descricao: 'Entrada', percentual: 40, formaPagamento: 'PIX' },
          { descricao: 'Saldo', percentual: 60, marco: 'Na entrega', formaPagamento: 'Boleto' },
        ],
      })
      expect(result.success).toBe(true)
    })

    it('aceita soma de percentuais com arredondamento (33.33 * 3 ~= 100)', () => {
      const result = criarOrcamentoSchema.safeParse({
        ...baseCriar,
        condicoesPagamento: [
          { descricao: 'P1', percentual: 33.33, formaPagamento: 'PIX' },
          { descricao: 'P2', percentual: 33.33, formaPagamento: 'PIX' },
          { descricao: 'P3', percentual: 33.34, formaPagamento: 'PIX' },
        ],
      })
      expect(result.success).toBe(true)
    })

    it('rejeita quando a soma dos percentuais é diferente de 100', () => {
      const result = criarOrcamentoSchema.safeParse({
        ...baseCriar,
        condicoesPagamento: [
          { descricao: 'Entrada', percentual: 40, formaPagamento: 'PIX' },
          { descricao: 'Saldo', percentual: 50, formaPagamento: 'Boleto' },
        ],
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path[0] === 'condicoesPagamento')
        expect(issue?.message).toContain('100')
      }
    })

    it('rejeita percentual fora de 0–100', () => {
      const result = criarOrcamentoSchema.safeParse({
        ...baseCriar,
        condicoesPagamento: [{ descricao: 'X', percentual: 120, formaPagamento: 'PIX' }],
      })
      expect(result.success).toBe(false)
    })

    it('rejeita condição sem descrição ou forma de pagamento', () => {
      const semDescricao = criarOrcamentoSchema.safeParse({
        ...baseCriar,
        condicoesPagamento: [{ descricao: '', percentual: 100, formaPagamento: 'PIX' }],
      })
      const semForma = criarOrcamentoSchema.safeParse({
        ...baseCriar,
        condicoesPagamento: [{ descricao: 'X', percentual: 100, formaPagamento: '' }],
      })
      expect(semDescricao.success).toBe(false)
      expect(semForma.success).toBe(false)
    })

    it('rejeita prazoEntregaDias não-positivo ou não-inteiro', () => {
      expect(criarOrcamentoSchema.safeParse({ ...baseCriar, prazoEntregaDias: 0 }).success).toBe(
        false,
      )
      expect(criarOrcamentoSchema.safeParse({ ...baseCriar, prazoEntregaDias: 1.5 }).success).toBe(
        false,
      )
    })
  })

  describe('atualizarOrcamentoSchema', () => {
    const baseAtualizar = {
      itens: [{ nome: 'Serviço X', quantidade: 1, valorUnitario: 10 }],
    }

    it('aceita atualização sem condições', () => {
      expect(atualizarOrcamentoSchema.safeParse(baseAtualizar).success).toBe(true)
    })

    it('valida a soma=100 também na atualização', () => {
      const result = atualizarOrcamentoSchema.safeParse({
        ...baseAtualizar,
        condicoesPagamento: [{ descricao: 'X', percentual: 90, formaPagamento: 'PIX' }],
      })
      expect(result.success).toBe(false)
    })
  })
})
