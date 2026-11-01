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

describe('orcamento.schema — tetos de entrada (auditoria B-9)', () => {
  const item = { nome: 'Serviço X', quantidade: 2, valorUnitario: 50 }
  const criar = (extra: Record<string, unknown>) =>
    criarOrcamentoSchema.safeParse({ ...baseCriar, ...extra })
  const caminhos = (r: ReturnType<typeof criar>): string[] =>
    r.success ? [] : r.error.issues.map((i) => i.path.join('.'))

  it('aceita valores dentro dos limites, incluindo desconto percentual de 100', () => {
    const r = criar({
      descontoGlobalTipo: 'percentual',
      descontoGlobalValor: 100,
      itens: [{ ...item, descontoTipo: 'percentual', descontoValor: 100 }],
    })
    expect(r.success).toBe(true)
  })

  it('rejeita desconto percentual global acima de 100', () => {
    const r = criar({ descontoGlobalTipo: 'percentual', descontoGlobalValor: 100.01 })
    expect(r.success).toBe(false)
    expect(caminhos(r)).toContain('descontoGlobalValor')
  })

  it('rejeita desconto percentual de item acima de 100', () => {
    const r = criar({ itens: [{ ...item, descontoTipo: 'percentual', descontoValor: 150 }] })
    expect(r.success).toBe(false)
    expect(caminhos(r)).toContain('itens.0.descontoValor')
  })

  it('aceita desconto fixo maior que 100 (o servidor trava o total em zero)', () => {
    const r = criar({ itens: [{ ...item, descontoTipo: 'fixo', descontoValor: 5000 }] })
    expect(r.success).toBe(true)
  })

  it('rejeita desconto fixo acima do máximo da coluna monetária', () => {
    const r = criar({ descontoGlobalTipo: 'fixo', descontoGlobalValor: 1e10 })
    expect(r.success).toBe(false)
  })

  it('rejeita valor unitário, quantidade e valor de item acima dos tetos', () => {
    expect(criar({ itens: [{ ...item, valorUnitario: 1e10 }] }).success).toBe(false)
    expect(criar({ itens: [{ ...item, quantidade: 1_000_001 }] }).success).toBe(false)
    const bruto = criar({ itens: [{ ...item, quantidade: 1000, valorUnitario: 50_000 }] })
    expect(bruto.success).toBe(false)
    expect(caminhos(bruto)).toContain('itens.0.valorUnitario')
  })

  it('aceita item no limite do valor bruto', () => {
    const r = criar({ itens: [{ ...item, quantidade: 1, valorUnitario: 40_000_000 }] })
    expect(r.success).toBe(true)
  })

  it('rejeita mais de 200 itens', () => {
    expect(criar({ itens: Array.from({ length: 201 }, () => item) }).success).toBe(false)
    expect(criar({ itens: Array.from({ length: 200 }, () => item) }).success).toBe(true)
  })

  it('rejeita textos acima das colunas do banco', () => {
    expect(criar({ titulo: 'a'.repeat(256) }).success).toBe(false)
    expect(criar({ itens: [{ ...item, nome: 'a'.repeat(256) }] }).success).toBe(false)
    expect(criar({ itens: [{ ...item, unidade: 'a'.repeat(21) }] }).success).toBe(false)
    expect(criar({ observacoes: 'a'.repeat(10_001) }).success).toBe(false)
    expect(criar({ descricao: 'a'.repeat(10_001) }).success).toBe(false)
  })

  it('rejeita prazos acima de 3650 dias e mais de 24 condições de pagamento', () => {
    expect(criar({ validadeDias: 3651 }).success).toBe(false)
    expect(criar({ prazoEntregaDias: 3651 }).success).toBe(false)
    const condicoes = Array.from({ length: 25 }, () => ({
      descricao: 'P',
      percentual: 4,
      formaPagamento: 'PIX',
    }))
    expect(criar({ condicoesPagamento: condicoes }).success).toBe(false)
  })

  it('aplica os mesmos tetos no schema de atualização', () => {
    const r = atualizarOrcamentoSchema.safeParse({
      itens: [{ ...item, descontoTipo: 'percentual', descontoValor: 101 }],
    })
    expect(r.success).toBe(false)
    const tituloLongo = atualizarOrcamentoSchema.safeParse({
      titulo: 'a'.repeat(256),
      itens: [item],
    })
    expect(tituloLongo.success).toBe(false)
  })
})
