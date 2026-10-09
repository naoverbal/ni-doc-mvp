import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/services/api'
import type {
  AceiteRegistradoPublico,
  ReprovarPublicoPayload,
  VisualizacaoPublica,
} from '@/types/api'

const CHAVE_PUBLICO = ['publico', 'orcamento'] as const

// Visualiza o orçamento público pelo token (GET /publico/orcamento/:token). É
// uma rota SEM autenticação: o token (uuid.hmac) é a credencial. O backend
// responde 404 para token inválido/desconhecido e 410 para link expirado; esses
// status ficam disponíveis via ApiError para a UI distinguir os casos.
export function usePublicoOrcamento(token: string | undefined) {
  return useQuery<VisualizacaoPublica, ApiError>({
    queryKey: [...CHAVE_PUBLICO, token],
    queryFn: () => api.get<VisualizacaoPublica>(`/publico/orcamento/${token}`),
    enabled: Boolean(token),
    // Não repetir em erros de token (404/410): o resultado é determinístico.
    retry: false,
  })
}

// Aprova o orçamento via cliente (POST /publico/orcamento/:token/aprovar). O
// backend registra o aceite (IP, user agent, hash, método) e gera o comprovante
// em PDF (RF-019.5/6), respondendo 201. 409 quando já aprovado. Em sucesso,
// invalida a visualização para refletir o novo status.
export function useAprovarPublico(token: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation<AceiteRegistradoPublico, ApiError, void>({
    mutationFn: () => api.post<AceiteRegistradoPublico>(`/publico/orcamento/${token}/aprovar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...CHAVE_PUBLICO, token] })
    },
  })
}

// Reprova o orçamento via cliente (POST /publico/orcamento/:token/reprovar), com
// justificativa opcional. Não gera comprovante PDF. Em sucesso, invalida a
// visualização.
export function useReprovarPublico(token: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation<AceiteRegistradoPublico, ApiError, ReprovarPublicoPayload>({
    mutationFn: (payload) =>
      api.post<AceiteRegistradoPublico>(`/publico/orcamento/${token}/reprovar`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...CHAVE_PUBLICO, token] })
    },
  })
}
