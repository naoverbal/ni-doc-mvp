import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/services/api'
import type { SalvarTemplatePayload, TemplatePublico } from '@/types/api'

const CHAVE_TEMPLATE = ['template', 'atual'] as const

// Busca o template ativo do tenant (GET /templates/atual). Usado para
// pré-carregar o editor com a versão vigente (RF-014).
export function useTemplateAtual() {
  return useQuery<TemplatePublico, ApiError>({
    queryKey: CHAVE_TEMPLATE,
    queryFn: () => api.get<TemplatePublico>('/templates/atual'),
  })
}

// Salva o template (PUT /templates/atual). O backend cria uma nova versão
// imutável e atualiza o ponteiro ativo (apenas admin; operador recebe 403). Em
// sucesso, atualiza o cache com a versão recém-criada.
export function useSalvarTemplate() {
  const queryClient = useQueryClient()

  return useMutation<TemplatePublico, ApiError, SalvarTemplatePayload>({
    mutationFn: (payload) => api.put<TemplatePublico>('/templates/atual', payload),
    onSuccess: (template) => {
      queryClient.setQueryData(CHAVE_TEMPLATE, template)
    },
  })
}
