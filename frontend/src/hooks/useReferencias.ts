import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@/services/api'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { ClienteResumo, ResponsavelResumo } from '@/types/api'

// Mínimo de caracteres e atraso (ms) antes de consultar o backend. Reduz de uma
// requisição por tecla para uma por pausa na digitação.
const MIN_CARACTERES_BUSCA = 2
const ATRASO_BUSCA_MS = 300

// Autocomplete de clientes (GET /clientes?q=). O backend devolve [] para termo
// vazio; a query só é habilitada a partir de 2 caracteres e após uma pausa na
// digitação, para evitar chamadas desnecessárias. Usada no combobox do editor
// de orçamento (RF-005/RF-010).
export function useBuscarClientes(termo: string) {
  const texto = useDebouncedValue(termo.trim(), ATRASO_BUSCA_MS)
  return useQuery<ClienteResumo[], ApiError>({
    queryKey: ['clientes', 'busca', texto],
    queryFn: () => api.get<ClienteResumo[]>(`/clientes?q=${encodeURIComponent(texto)}`),
    enabled: texto.length >= MIN_CARACTERES_BUSCA,
  })
}

// Autocomplete de responsáveis técnicos (GET /responsaveis?q=). Mesmo padrão do
// de clientes (RF-006/RF-012).
export function useBuscarResponsaveis(termo: string) {
  const texto = useDebouncedValue(termo.trim(), ATRASO_BUSCA_MS)
  return useQuery<ResponsavelResumo[], ApiError>({
    queryKey: ['responsaveis', 'busca', texto],
    queryFn: () => api.get<ResponsavelResumo[]>(`/responsaveis?q=${encodeURIComponent(texto)}`),
    enabled: texto.length >= MIN_CARACTERES_BUSCA,
  })
}
