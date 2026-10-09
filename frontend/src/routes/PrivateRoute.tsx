import type { ReactElement } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'

// Protege rotas da área logada. A verificação de sessão real (consulta a /auth/me)
// é integrada na tarefa 45; aqui usamos o estado do store como base.
export function PrivateRoute({ children }: { children: ReactElement }): ReactElement {
  const autenticado = useAuthStore((estado) => estado.autenticado)

  if (!autenticado) {
    return <Navigate to="/login" replace />
  }

  return children
}
