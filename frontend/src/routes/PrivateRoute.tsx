import type { ReactElement } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { useSessao } from '@/hooks/useAuth'

// Protege rotas da área logada. Se o store ainda não tem usuário, consulta
// GET /auth/me (cookie HttpOnly) para hidratar a sessão. Enquanto a consulta
// está em andamento, mostra um status acessível; ao final, redireciona para
// /login quando não autenticado, preservando a rota de origem para o retorno.
export function PrivateRoute({ children }: { children: ReactElement }): ReactElement {
  const location = useLocation()
  const autenticado = useAuthStore((estado) => estado.autenticado)
  const sessao = useSessao()

  if (sessao.isLoading) {
    return (
      <p role="status" aria-live="polite">
        Verificando sessão…
      </p>
    )
  }

  if (!autenticado) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return children
}
