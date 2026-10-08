import { describe, it, expect, beforeEach } from 'vitest'
import { criarPaginacaoService } from '../paginacao.service.js'
import type {
  PaginacaoService,
  PaginarInput,
  ItemPaginavel,
  AreaItens,
} from '../paginacao.service.js'

// -----------------------------------------------------------------------------
// Serviço PURO de paginação (RF-015). Sem banco, sem rede, sem Puppeteer: a
// altura de cada item é ESTIMADA (altura_linha * linhas + padding) e os itens
// são agrupados em páginas que caibam na altura da `area-itens` do template.
//
// Os fixtures são montados no próprio teste. Para tornar as alturas previsíveis,
// usamos uma `area` cuja altura comporta exatamente N itens de 1 linha.
// -----------------------------------------------------------------------------

// Com alturaLinha=10, padding=0 e 1 linha por item, cada item mede 10mm.
// Uma área de 30mm comporta exatamente 3 itens desses.
function areaMock(overrides: Partial<AreaItens> = {}): AreaItens {
  return {
    largura: 170,
    altura: 30,
    alturaLinha: 10,
    padding: 0,
    ...overrides,
  }
}

function itemMock(ordem: number, overrides: Partial<ItemPaginavel> = {}): ItemPaginavel {
  return {
    ordem,
    linhas: 1,
    ...overrides,
  }
}

function inputMock(overrides: Partial<PaginarInput> = {}): PaginarInput {
  return {
    area: areaMock(),
    itens: [itemMock(1), itemMock(2), itemMock(3), itemMock(4), itemMock(5)],
    header: { conteudo: 'cabecalho' },
    footer: { conteudo: 'rodape' },
    ...overrides,
  }
}

describe('paginacao.service', () => {
  let service: PaginacaoService

  beforeEach(() => {
    service = criarPaginacaoService()
  })

  it('distribui 5 itens (área p/ 3) em 2 páginas', () => {
    const resultado = service.paginar(inputMock())

    expect(resultado.paginas).toHaveLength(2)
    expect(resultado.paginas[0]?.itens.map((i) => i.ordem)).toEqual([1, 2, 3])
    expect(resultado.paginas[1]?.itens.map((i) => i.ordem)).toEqual([4, 5])
  })

  it('agrupa todos os itens em 1 página quando cabem', () => {
    const resultado = service.paginar(
      inputMock({ itens: [itemMock(1), itemMock(2), itemMock(3)] }),
    )

    expect(resultado.paginas).toHaveLength(1)
    expect(resultado.paginas[0]?.itens.map((i) => i.ordem)).toEqual([1, 2, 3])
  })

  it('repete header e footer em todas as páginas', () => {
    const header = { conteudo: 'cabecalho' }
    const footer = { conteudo: 'rodape' }
    const resultado = service.paginar(inputMock({ header, footer }))

    expect(resultado.paginas.length).toBeGreaterThan(1)
    for (const pagina of resultado.paginas) {
      expect(pagina.header).toEqual(header)
      expect(pagina.footer).toEqual(footer)
    }
  })

  it('nunca corta um item entre páginas (soma de itens == total)', () => {
    const resultado = service.paginar(inputMock())

    const totalDistribuido = resultado.paginas.reduce((acc, p) => acc + p.itens.length, 0)
    expect(totalDistribuido).toBe(5)
  })

  it('preserva a ordem dos itens ao longo das páginas', () => {
    const resultado = service.paginar(inputMock())

    const ordens = resultado.paginas.flatMap((p) => p.itens.map((i) => i.ordem))
    expect(ordens).toEqual([1, 2, 3, 4, 5])
  })

  it('ordena itens fora de ordem antes de paginar', () => {
    const resultado = service.paginar(
      inputMock({ itens: [itemMock(3), itemMock(1), itemMock(5), itemMock(2), itemMock(4)] }),
    )

    const ordens = resultado.paginas.flatMap((p) => p.itens.map((i) => i.ordem))
    expect(ordens).toEqual([1, 2, 3, 4, 5])
  })

  it('considera o padding na altura estimada do item', () => {
    // alturaLinha=10, padding=5 → cada item mede 15mm; área de 30mm comporta 2.
    const resultado = service.paginar(
      inputMock({
        area: areaMock({ altura: 30, padding: 5 }),
        itens: [itemMock(1), itemMock(2), itemMock(3)],
      }),
    )

    expect(resultado.paginas).toHaveLength(2)
    expect(resultado.paginas[0]?.itens.map((i) => i.ordem)).toEqual([1, 2])
    expect(resultado.paginas[1]?.itens.map((i) => i.ordem)).toEqual([3])
  })

  it('considera o número de linhas na altura estimada do item', () => {
    // Item com 3 linhas mede 30mm e ocupa a área (30mm) inteira sozinho.
    const resultado = service.paginar(
      inputMock({
        itens: [itemMock(1, { linhas: 3 }), itemMock(2), itemMock(3)],
      }),
    )

    expect(resultado.paginas).toHaveLength(2)
    expect(resultado.paginas[0]?.itens.map((i) => i.ordem)).toEqual([1])
    expect(resultado.paginas[1]?.itens.map((i) => i.ordem)).toEqual([2, 3])
  })

  describe('casos de borda', () => {
    it('coloca um único item em uma única página', () => {
      const resultado = service.paginar(inputMock({ itens: [itemMock(1)] }))

      expect(resultado.paginas).toHaveLength(1)
      expect(resultado.paginas[0]?.itens.map((i) => i.ordem)).toEqual([1])
    })

    it('produz uma página vazia (com header/footer) quando não há itens', () => {
      const resultado = service.paginar(inputMock({ itens: [] }))

      expect(resultado.paginas).toHaveLength(1)
      expect(resultado.paginas[0]?.itens).toEqual([])
      expect(resultado.paginas[0]?.header).toEqual({ conteudo: 'cabecalho' })
      expect(resultado.paginas[0]?.footer).toEqual({ conteudo: 'rodape' })
    })

    it('coloca um item maior que a área em sua própria página, sem travar', () => {
      // Item de 10 linhas = 100mm > área de 30mm. Deve ocupar sua página.
      const resultado = service.paginar(
        inputMock({
          itens: [itemMock(1), itemMock(2, { linhas: 10 }), itemMock(3)],
        }),
      )

      // página 1: item 1 (10mm cabe); página 2: item 2 (gigante, sozinho);
      // página 3: item 3.
      expect(resultado.paginas).toHaveLength(3)
      expect(resultado.paginas[0]?.itens.map((i) => i.ordem)).toEqual([1])
      expect(resultado.paginas[1]?.itens.map((i) => i.ordem)).toEqual([2])
      expect(resultado.paginas[2]?.itens.map((i) => i.ordem)).toEqual([3])
    })

    it('paginando apenas um item gigante, não entra em loop e usa 1 página', () => {
      const resultado = service.paginar(inputMock({ itens: [itemMock(1, { linhas: 100 })] }))

      expect(resultado.paginas).toHaveLength(1)
      expect(resultado.paginas[0]?.itens.map((i) => i.ordem)).toEqual([1])
    })

    it('saneia linhas <= 0 tratando o item como 1 linha', () => {
      // area de 30mm, alturaLinha=10, padding=0 → comporta 3 itens de 1 linha.
      // Itens com linhas 0 e negativo devem contar como 1 linha (10mm cada),
      // de modo que os 3 ainda cabem numa única página.
      const resultado = service.paginar(
        inputMock({
          itens: [
            itemMock(1, { linhas: 0 }),
            itemMock(2, { linhas: -5 }),
            itemMock(3, { linhas: 1 }),
          ],
        }),
      )

      expect(resultado.paginas).toHaveLength(1)
      expect(resultado.paginas[0]?.itens.map((i) => i.ordem)).toEqual([1, 2, 3])
    })

    it('propaga header/footer null como null em cada página', () => {
      // 5 itens numa área p/ 3 → 2 páginas; header/footer null devem permanecer
      // null em todas as páginas (não viram objeto vazio).
      const resultado = service.paginar(inputMock({ header: null, footer: null }))

      expect(resultado.paginas.length).toBeGreaterThan(1)
      for (const pagina of resultado.paginas) {
        expect(pagina.header).toBeNull()
        expect(pagina.footer).toBeNull()
      }
    })
  })

  describe('validação', () => {
    it('usa valores padrão de alturaLinha/padding quando omitidos', () => {
      // area sem alturaLinha/padding explícitos: usa defaults internos.
      const resultado = service.paginar({
        area: { largura: 170, altura: 1000 },
        itens: [itemMock(1), itemMock(2)],
        header: null,
        footer: null,
      })

      expect(resultado.paginas).toHaveLength(1)
      expect(resultado.paginas[0]?.itens.map((i) => i.ordem)).toEqual([1, 2])
    })
  })
})
