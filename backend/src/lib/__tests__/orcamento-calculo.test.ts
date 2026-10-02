import { describe, it, expect } from 'vitest'
import {
  calcularTotalItem,
  calcularSubtotal,
  calcularTotal,
  type ItemCalculo,
  type DescontoGlobal,
} from '../orcamento-calculo.js'

describe('orcamento-calculo', () => {
  describe('calcularTotalItem', () => {
    it('com desconto percentual: qty=40, unit=200, desc=10% → 7200', () => {
      const item: ItemCalculo = { quantidade: 40, valorUnitario: 200, descontoTipo: 'percentual', descontoValor: 10 }
      expect(calcularTotalItem(item)).toBe(7200)
    })

    it('com desconto fixo: qty=2, unit=100, desc=30 → 170', () => {
      const item: ItemCalculo = { quantidade: 2, valorUnitario: 100, descontoTipo: 'fixo', descontoValor: 30 }
      expect(calcularTotalItem(item)).toBe(170)
    })

    it('sem desconto: qty=3, unit=50 → 150', () => {
      const item: ItemCalculo = { quantidade: 3, valorUnitario: 50 }
      expect(calcularTotalItem(item)).toBe(150)
    })

    it('não retorna total negativo (desconto maior que o total → 0)', () => {
      const item: ItemCalculo = { quantidade: 1, valorUnitario: 10, descontoTipo: 'fixo', descontoValor: 100 }
      expect(calcularTotalItem(item)).toBe(0)
    })
  })

  describe('calcularSubtotal', () => {
    it('soma os totais dos itens', () => {
      const itens: ItemCalculo[] = [
        { quantidade: 40, valorUnitario: 200, descontoTipo: 'percentual', descontoValor: 10 },
        { quantidade: 2, valorUnitario: 100, descontoTipo: 'fixo', descontoValor: 30 },
      ]
      expect(calcularSubtotal(itens)).toBe(7200 + 170)
    })
  })

  describe('calcularTotal', () => {
    it('com desconto percentual: 7200, 5% → 6840', () => {
      const desconto: DescontoGlobal = { tipo: 'percentual', valor: 5 }
      expect(calcularTotal(7200, desconto)).toBe(6840)
    })

    it('com desconto fixo: 7200, 200 → 7000', () => {
      const desconto: DescontoGlobal = { tipo: 'fixo', valor: 200 }
      expect(calcularTotal(7200, desconto)).toBe(7000)
    })

    it('sem desconto retorna o subtotal', () => {
      expect(calcularTotal(500)).toBe(500)
    })

    it('não retorna total negativo', () => {
      const desconto: DescontoGlobal = { tipo: 'fixo', valor: 99999 }
      expect(calcularTotal(100, desconto)).toBe(0)
    })
  })
})
