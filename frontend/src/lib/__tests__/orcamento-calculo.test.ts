import { describe, it, expect } from 'vitest'
import { calcularTotalItem, calcularSubtotal, calcularTotal } from '@/lib/orcamento-calculo'

describe('calcularTotalItem', () => {
  it('multiplica quantidade por valor unitário sem desconto', () => {
    expect(calcularTotalItem({ quantidade: 3, valorUnitario: 10 })).toBe(30)
  })

  it('aplica desconto percentual sobre o bruto', () => {
    expect(
      calcularTotalItem({
        quantidade: 2,
        valorUnitario: 100,
        descontoTipo: 'percentual',
        descontoValor: 10,
      }),
    ).toBe(180)
  })

  it('aplica desconto fixo subtraindo do bruto', () => {
    expect(
      calcularTotalItem({
        quantidade: 1,
        valorUnitario: 100,
        descontoTipo: 'fixo',
        descontoValor: 30,
      }),
    ).toBe(70)
  })

  it('nunca retorna total negativo', () => {
    expect(
      calcularTotalItem({
        quantidade: 1,
        valorUnitario: 10,
        descontoTipo: 'fixo',
        descontoValor: 50,
      }),
    ).toBe(0)
  })

  it('trata campos vazios (NaN) como zero', () => {
    expect(calcularTotalItem({ quantidade: NaN, valorUnitario: 10 })).toBe(0)
  })
})

describe('calcularSubtotal', () => {
  it('soma os totais dos itens com desconto por item aplicado', () => {
    const subtotal = calcularSubtotal([
      { quantidade: 2, valorUnitario: 100 },
      { quantidade: 1, valorUnitario: 100, descontoTipo: 'percentual', descontoValor: 50 },
    ])
    expect(subtotal).toBe(250)
  })

  it('retorna zero para lista vazia', () => {
    expect(calcularSubtotal([])).toBe(0)
  })
})

describe('calcularTotal', () => {
  it('retorna o subtotal quando não há desconto global', () => {
    expect(calcularTotal(250)).toBe(250)
  })

  it('aplica desconto global percentual', () => {
    expect(calcularTotal(200, { tipo: 'percentual', valor: 10 })).toBe(180)
  })

  it('aplica desconto global fixo e nunca fica negativo', () => {
    expect(calcularTotal(100, { tipo: 'fixo', valor: 150 })).toBe(0)
  })
})
