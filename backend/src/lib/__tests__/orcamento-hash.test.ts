import { describe, expect, it } from 'vitest'
import { calcularHashConteudo, type ConteudoParaHash } from '../orcamento-hash.js'

const base: ConteudoParaHash = {
  clienteId: 'cliente-1',
  titulo: 'Projeto X',
  itens: [{ nome: 'Serviço A', quantidade: 2, valorUnitario: 100 }],
}

describe('calcularHashConteudo', () => {
  it('gera o mesmo hash (64 hex) para o mesmo conteúdo', () => {
    const hash = calcularHashConteudo(base)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(calcularHashConteudo(structuredClone(base))).toBe(hash)
  })

  it('trata campos opcionais ausentes, null e a unidade padrão como equivalentes', () => {
    const explicito: ConteudoParaHash = {
      ...base,
      itens: [
        {
          nome: 'Serviço A',
          descricao: null,
          quantidade: 2,
          unidade: 'un',
          valorUnitario: 100,
          descontoTipo: null,
          descontoValor: null,
          responsavelId: null,
        },
      ],
    }

    expect(calcularHashConteudo(explicito)).toBe(calcularHashConteudo(base))
  })

  it.each([
    ['cliente', { ...base, clienteId: 'cliente-2' }],
    ['título', { ...base, titulo: 'Projeto Y' }],
    ['quantidade', { ...base, itens: [{ nome: 'Serviço A', quantidade: 3, valorUnitario: 100 }] }],
    [
      'ordem dos itens',
      {
        ...base,
        itens: [
          { nome: 'B', quantidade: 1, valorUnitario: 1 },
          { nome: 'A', quantidade: 1, valorUnitario: 1 },
        ],
      },
    ],
  ])('gera hash diferente quando muda %s', (_campo, outro) => {
    expect(calcularHashConteudo(outro)).not.toBe(calcularHashConteudo(base))
  })
})
