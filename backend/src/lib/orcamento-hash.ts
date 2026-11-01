import { createHash } from 'node:crypto'

export interface ItemParaHash {
  nome: string
  descricao?: string | null
  quantidade: number
  unidade?: string | null
  valorUnitario: number
  descontoTipo?: string | null
  descontoValor?: number | null
  responsavelId?: string | null
}

export interface ConteudoParaHash {
  clienteId: string
  titulo: string
  itens: ItemParaHash[]
}

/**
 * Hash SHA-256 (hex) do conteúdo que define "o mesmo orçamento": cliente, título
 * e itens (na ordem). Campos opcionais ausentes e `null` equivalem, e a unidade
 * padrão é `un`, para que a mesma intenção gere o mesmo hash. Usado com índice
 * único parcial para impedir duplicidade, inclusive sob concorrência.
 */
export function calcularHashConteudo(conteudo: ConteudoParaHash): string {
  const normalizado = [
    conteudo.clienteId,
    conteudo.titulo,
    conteudo.itens.map((item) => [
      item.nome,
      item.descricao ?? null,
      item.quantidade,
      item.unidade ?? 'un',
      item.valorUnitario,
      item.descontoTipo ?? null,
      item.descontoValor ?? null,
      item.responsavelId ?? null,
    ]),
  ]
  return createHash('sha256').update(JSON.stringify(normalizado)).digest('hex')
}
