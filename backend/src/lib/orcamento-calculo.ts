export type DescontoTipo = 'percentual' | 'fixo'

export interface ItemCalculo {
  quantidade: number
  valorUnitario: number
  descontoTipo?: DescontoTipo
  descontoValor?: number
}

export interface DescontoGlobal {
  tipo: DescontoTipo
  valor: number
}

export function calcularTotalItem(item: ItemCalculo): number {
  const bruto = item.quantidade * item.valorUnitario
  if (!item.descontoTipo || item.descontoValor === undefined) return bruto

  let desconto: number
  if (item.descontoTipo === 'percentual') {
    desconto = bruto * (item.descontoValor / 100)
  } else {
    desconto = item.descontoValor
  }

  return Math.max(0, bruto - desconto)
}

export function calcularSubtotal(itens: ItemCalculo[]): number {
  return itens.reduce((acc, item) => acc + calcularTotalItem(item), 0)
}

export function calcularTotal(subtotal: number, desconto?: DescontoGlobal): number {
  if (!desconto) return subtotal

  let valorDesconto: number
  if (desconto.tipo === 'percentual') {
    valorDesconto = subtotal * (desconto.valor / 100)
  } else {
    valorDesconto = desconto.valor
  }

  return Math.max(0, subtotal - valorDesconto)
}
