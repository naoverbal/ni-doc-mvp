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

/**
 * Arredonda um valor monetário para 2 casas decimais.
 *
 * Usa a técnica de epsilon (`Number.EPSILON`) para corrigir erros de
 * representação de ponto flutuante (ex.: 0.1 + 0.2) antes do arredondamento,
 * garantindo resultados consistentes com o armazenamento `NUMERIC(12,2)`.
 */
function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100
}

/**
 * Calcula o total de um item do orçamento.
 *
 * total = quantidade * valorUnitario - desconto
 *   - desconto percentual: aplicado sobre o valor bruto
 *   - desconto fixo: subtraído diretamente
 *
 * O resultado é arredondado para 2 casas decimais e nunca é negativo.
 * Implementa RF-006 (cálculo automático do total do item).
 */
export function calcularTotalItem(item: ItemCalculo): number {
  const bruto = item.quantidade * item.valorUnitario

  if (!item.descontoTipo || item.descontoValor === undefined) {
    return arredondar(Math.max(0, bruto))
  }

  let desconto: number
  if (item.descontoTipo === 'percentual') {
    desconto = bruto * (item.descontoValor / 100)
  } else {
    desconto = item.descontoValor
  }

  return arredondar(Math.max(0, bruto - desconto))
}

/**
 * Calcula o subtotal como a soma dos totais dos itens (descontos por item já
 * aplicados). Retorna 0 para lista vazia. Implementa RF-007 (subtotal).
 */
export function calcularSubtotal(itens: ItemCalculo[]): number {
  const soma = itens.reduce((acc, item) => acc + calcularTotalItem(item), 0)
  return arredondar(soma)
}

/**
 * Calcula o total final: subtotal menos o desconto global (percentual ou fixo).
 *
 * O resultado é arredondado para 2 casas decimais e nunca é negativo.
 * Implementa RF-007 (desconto global e total final).
 */
export function calcularTotal(subtotal: number, desconto?: DescontoGlobal): number {
  if (!desconto) return arredondar(Math.max(0, subtotal))

  let valorDesconto: number
  if (desconto.tipo === 'percentual') {
    valorDesconto = subtotal * (desconto.valor / 100)
  } else {
    valorDesconto = desconto.valor
  }

  return arredondar(Math.max(0, subtotal - valorDesconto))
}
