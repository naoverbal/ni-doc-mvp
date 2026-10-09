import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/services/api'
import type { ListaOrcamentos, ListarOrcamentosFiltro } from '@/types/api'

const CHAVE_ORCAMENTOS = ['orcamentos'] as const

// Monta a query string a partir do filtro, omitindo campos indefinidos.
function montarQuery(filtro: ListarOrcamentosFiltro): string {
  const params = new URLSearchParams()
  if (filtro.status !== undefined) params.set('status', filtro.status)
  if (filtro.pagina !== undefined) params.set('pagina', String(filtro.pagina))
  if (filtro.tamanhoPagina !== undefined) params.set('tamanhoPagina', String(filtro.tamanhoPagina))
  const texto = params.toString()
  return texto ? `?${texto}` : ''
}

// Lista os orçamentos do tenant (GET /orcamentos), com filtro opcional por
// status e paginação. A chave inclui o filtro para cache por combinação.
export function useOrcamentos(filtro: ListarOrcamentosFiltro = {}) {
  return useQuery<ListaOrcamentos, ApiError>({
    queryKey: [...CHAVE_ORCAMENTOS, filtro],
    queryFn: () => api.get<ListaOrcamentos>(`/orcamentos${montarQuery(filtro)}`),
  })
}

// Exclui um orçamento (DELETE /orcamentos/:id). Só rascunhos podem ser
// excluídos; o backend responde 409 caso contrário. Em sucesso, invalida a
// lista para refletir a remoção.
export function useExcluirOrcamento() {
  const queryClient = useQueryClient()

  return useMutation<void, ApiError, string>({
    mutationFn: (id) => api.delete<void>(`/orcamentos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHAVE_ORCAMENTOS })
    },
  })
}
