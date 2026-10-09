import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@/services/api'
import type { ClienteResumo, ResponsavelResumo } from '@/types/api'

// Autocomplete de clientes (GET /clientes?q=). O backend devolve [] para termo
// vazio; a query só é habilitada a partir de 1 caractere para evitar chamadas
// desnecessárias. Usada no combobox do editor de orçamento (RF-005/RF-010).
export function useBuscarClientes(termo: string) {
  const texto = termo.trim()
  return useQuery<ClienteResumo[], ApiError>({
    queryKey: ['clientes', 'busca', texto],
    queryFn: () => api.get<ClienteResumo[]>(`/clientes?q=${encodeURIComponent(texto)}`),
    enabled: texto.length >= 1,
  })
}

// Autocomplete de responsáveis técnicos (GET /responsaveis?q=). Mesmo padrão do
// de clientes (RF-006/RF-012).
export function useBuscarResponsaveis(termo: string) {
  const texto = termo.trim()
  return useQuery<ResponsavelResumo[], ApiError>({
    queryKey: ['responsaveis', 'busca', texto],
    queryFn: () => api.get<ResponsavelResumo[]>(`/responsaveis?q=${encodeURIComponent(texto)}`),
    enabled: texto.length >= 1,
  })
}
