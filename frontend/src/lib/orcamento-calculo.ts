// Cálculo de totais do orçamento no cliente (RF-007). Espelha a lógica pura do
// backend (`backend/src/lib/orcamento-calculo.ts`) para exibir totais em tempo
// real no editor: desconto percentual/fixo por item e global, nunca negativo,
// arredondado a 2 casas. O backend permanece a fonte de verdade ao salvar.

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

// Arredonda um valor monetário para 2 casas, corrigindo erro de ponto flutuante.
function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100
}

// Trata NaN/Infinity (campos vazios no editor) como 0 para o cálculo em tempo real.
function numeroSeguro(valor: number): number {
  return Number.isFinite(valor) ? valor : 0
}

// total = quantidade * valorUnitario - desconto; nunca negativo.
export function calcularTotalItem(item: ItemCalculo): number {
  const quantidade = numeroSeguro(item.quantidade)
  const valorUnitario = numeroSeguro(item.valorUnitario)
  const bruto = quantidade * valorUnitario

  if (!item.descontoTipo || item.descontoValor === undefined) {
    return arredondar(Math.max(0, bruto))
  }

  const descontoValor = numeroSeguro(item.descontoValor)
  const desconto =
    item.descontoTipo === 'percentual' ? bruto * (descontoValor / 100) : descontoValor

  return arredondar(Math.max(0, bruto - desconto))
}

// Subtotal = soma dos totais dos itens (descontos por item já aplicados).
export function calcularSubtotal(itens: ItemCalculo[]): number {
  const soma = itens.reduce((acc, item) => acc + calcularTotalItem(item), 0)
  return arredondar(soma)
}

// Total final = subtotal menos desconto global; nunca negativo.
export function calcularTotal(subtotal: number, desconto?: DescontoGlobal): number {
  if (!desconto) return arredondar(Math.max(0, subtotal))

  const valor = numeroSeguro(desconto.valor)
  const valorDesconto = desconto.tipo === 'percentual' ? subtotal * (valor / 100) : valor

  return arredondar(Math.max(0, subtotal - valorDesconto))
}
