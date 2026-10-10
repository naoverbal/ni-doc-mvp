import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@/services/api'
import type { ListaOrcamentos, OrcamentoResumo } from '@/types/api'

const TAMANHO_PAGINA = 100

// Baixa TODAS as páginas de GET /orcamentos (loop até cobrir
// ListaOrcamentos.total) e devolve a lista plana. O backend não tem endpoint de
// agregação nem filtro por período, então as métricas do dashboard são
// derivadas no cliente a partir deste array.
//
// LIMITE CONHECIDO (aceitável no MVP): o custo é proporcional ao número de
// orçamentos do tenant, pois baixamos todas as páginas. A Fase B substituirá
// apenas este queryFn por chamadas a endpoints de agregação, sem alterar a UI
// nem as funções puras de `dashboard-metricas.ts`.
async function buscarTodosOrcamentos(): Promise<OrcamentoResumo[]> {
  const itens: OrcamentoResumo[] = []
  let pagina = 1

  // Primeira página define o total; repete até cobri-lo. Guarda contra total
  // inconsistente usando o tamanho da página retornada como sentinela.
  for (;;) {
    const lista = await api.get<ListaOrcamentos>(
      `/orcamentos?pagina=${pagina}&tamanhoPagina=${TAMANHO_PAGINA}`,
    )
    itens.push(...lista.itens)
    if (itens.length >= lista.total || lista.itens.length === 0) break
    pagina += 1
  }

  return itens
}

// Query dedicada do dashboard. Chave distinta das chaves de `useOrcamentos`
// (['orcamentos', filtro]) para não colidir no cache. Expõe data/isLoading/
// isError, a mesma superfície usada pelas demais telas.
export function useDashboardOrcamentos() {
  return useQuery<OrcamentoResumo[], ApiError>({
    queryKey: ['dashboard', 'orcamentos', 'todos'],
    queryFn: buscarTodosOrcamentos,
  })
}
