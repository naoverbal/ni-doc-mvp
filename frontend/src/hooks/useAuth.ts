import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/services/api'
import { useAuthStore } from '@/stores/auth.store'
import type { RespostaUsuario, Usuario } from '@/types/api'

export interface CredenciaisLogin {
  email: string
  senha: string
}

const CHAVE_SESSAO = ['auth', 'sessao'] as const

// Consulta a sessão atual via GET /auth/me. A fonte de verdade é o cookie
// HttpOnly no backend; o resultado hidrata o store do Zustand para a UI.
// Em 401 (não autenticado) não refaz a tentativa e devolve `null`.
export function useSessao() {
  const definirUsuario = useAuthStore((estado) => estado.definirUsuario)

  return useQuery<Usuario | null>({
    queryKey: CHAVE_SESSAO,
    queryFn: async () => {
      try {
        const { usuario } = await api.get<RespostaUsuario>('/auth/me')
        definirUsuario(usuario)
        return usuario
      } catch (erro) {
        if (erro instanceof ApiError && erro.status === 401) {
          definirUsuario(null)
          return null
        }
        throw erro
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  })
}

// Realiza o login (POST /auth/login). Em sucesso, o backend define o cookie de
// sessão e devolve o usuário, que é guardado no store para a UI.
export function useLogin() {
  const definirUsuario = useAuthStore((estado) => estado.definirUsuario)
  const queryClient = useQueryClient()

  return useMutation<Usuario, ApiError, CredenciaisLogin>({
    mutationFn: async (credenciais) => {
      const { usuario } = await api.post<RespostaUsuario>('/auth/login', credenciais)
      return usuario
    },
    onSuccess: (usuario) => {
      definirUsuario(usuario)
      queryClient.setQueryData(CHAVE_SESSAO, usuario)
    },
  })
}

// Encerra a sessão (POST /auth/logout), limpa o store e o cache da sessão.
export function useLogout() {
  const limpar = useAuthStore((estado) => estado.limpar)
  const queryClient = useQueryClient()

  return useMutation<void, ApiError, void>({
    mutationFn: async () => {
      await api.post('/auth/logout')
    },
    onSuccess: () => {
      limpar()
      queryClient.setQueryData(CHAVE_SESSAO, null)
    },
  })
}
