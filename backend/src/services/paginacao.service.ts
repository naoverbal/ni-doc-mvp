// -----------------------------------------------------------------------------
// Serviço PURO e determinístico de paginação (RF-015, design seção 10.3). Agrupa
// os itens de um orçamento em páginas que caibam na altura da `area-itens`
// configurada no template, repetindo header/footer em cada página.
//
// SEM banco, SEM rede, SEM Puppeteer: a altura de cada item é ESTIMADA no
// backend ANTES de gerar o PDF, via `alturaLinha * linhas + padding` (o design
// permite essa estimativa como alternativa à medição real do Puppeteer). O
// consumo do resultado pelo renderizador de HTML (Tarefas 36/38) fica fora deste
// escopo.
//
// Garantias:
//   - um item nunca é dividido entre páginas;
//   - a ordem dos itens é preservada ao longo das páginas;
//   - um item maior que a própria área ocupa sua página sozinho (sem loop);
//   - sempre há ao menos uma página (lista vazia → 1 página sem itens).
// -----------------------------------------------------------------------------

// Área de itens do template (seção 11.2: `largura`/`altura` em mm). `alturaLinha`
// e `padding` (também em mm) parametrizam a estimativa de altura de cada item;
// quando omitidos, usamos defaults seguros.
export interface AreaItens {
  largura: number
  altura: number
  alturaLinha?: number
  padding?: number
}

// Item a paginar. `ordem` define a sequência (crescente) no documento; `linhas`
// é o número de linhas que o item ocupa ao ser renderizado (base da estimativa
// de altura). Campos extras do item podem trafegar livremente (preservados).
export interface ItemPaginavel {
  ordem: number
  linhas: number
  [chave: string]: unknown
}

// Header/footer são blocos opacos (montados em outro ponto do pipeline).
// Repetidos por valor em cada página. `null` quando não há.
export type BlocoFixo = Record<string, unknown> | null

export interface PaginarInput {
  area: AreaItens
  itens: ItemPaginavel[]
  header: BlocoFixo
  footer: BlocoFixo
}

export interface PaginaPaginada {
  itens: ItemPaginavel[]
  header: BlocoFixo
  footer: BlocoFixo
}

export interface PaginacaoResultado {
  paginas: PaginaPaginada[]
}

export interface PaginacaoService {
  paginar(input: PaginarInput): PaginacaoResultado
}

// Defaults da estimativa de altura (mm). Usados quando a área não os informa.
const ALTURA_LINHA_PADRAO = 6
const PADDING_PADRAO = 2

// Estima a altura (mm) de um item renderizado: `alturaLinha * linhas + padding`.
// `linhas` é saneado para no mínimo 1 (um item sempre ocupa ao menos uma linha).
function estimarAlturaItem(item: ItemPaginavel, alturaLinha: number, padding: number): number {
  const linhas = Math.max(1, item.linhas)
  return alturaLinha * linhas + padding
}

export function criarPaginacaoService(): PaginacaoService {
  return {
    paginar(input: PaginarInput): PaginacaoResultado {
      const { area, itens, header, footer } = input

      const alturaLinha = area.alturaLinha ?? ALTURA_LINHA_PADRAO
      const padding = area.padding ?? PADDING_PADRAO
      const alturaMaxima = area.altura

      // Clona header/footer por valor para que cada página seja independente e
      // mutações externas não vazem entre páginas (header/footer repetidos).
      const clonarBloco = (bloco: BlocoFixo): BlocoFixo =>
        bloco === null ? null : { ...bloco }

      // Ordena por `ordem` crescente sem mutar a entrada. A ordenação é estável,
      // então itens com a mesma `ordem` preservam a sequência original.
      const ordenados = [...itens].sort((a, b) => a.ordem - b.ordem)

      const paginas: PaginaPaginada[] = []
      let atual: ItemPaginavel[] = []
      let alturaAcumulada = 0

      const abrirPagina = (): void => {
        paginas.push({
          itens: atual,
          header: clonarBloco(header),
          footer: clonarBloco(footer),
        })
      }

      for (const item of ordenados) {
        const alturaItem = estimarAlturaItem(item, alturaLinha, padding)

        // Se o item não cabe no restante da página atual E a página já tem algum
        // item, fecha a página atual e começa outra. Um item maior que a área
        // inteira cai aqui com a página vazia → segue para a sua própria página
        // (a condição `atual.length > 0` evita o loop/página vazia infinita).
        if (atual.length > 0 && alturaAcumulada + alturaItem > alturaMaxima) {
          abrirPagina()
          atual = []
          alturaAcumulada = 0
        }

        atual.push(item)
        alturaAcumulada += alturaItem
      }

      // Fecha a última página. Também cobre o caso de 0 itens: sempre há ao menos
      // uma página (vazia, mas com header/footer).
      abrirPagina()

      return { paginas }
    },
  }
}
