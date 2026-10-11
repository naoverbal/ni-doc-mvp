import { useCallback, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { useLogout } from '@/hooks/useAuth'
import { AppShell } from '@/components/layout/AppShell'

// Casca da área logada: compõe o app shell em Fluent (AppShell = sidebar +
// header sticky + conteúdo) e detém o logout resiliente, repassado ao header.
//
// Decisão de design: o <main> é responsabilidade de cada página (todas expõem
// <main id="conteudo">, alvo do skip link). O shell NÃO renderiza <main> para
// não duplicar o landmark.
export function LayoutApp(): ReactElement {
  const limpar = useAuthStore((estado) => estado.limpar)
  const logout = useLogout()
  const navegar = useNavigate()

  // Logout resiliente: mesmo que o POST /auth/logout falhe (ex.: rede), limpamos
  // o estado local e saímos para /login no `finally`, para não prender o usuário
  // numa sessão aparentemente ativa (RF-L02.5).
  const sair = useCallback(async (): Promise<void> => {
    try {
      await logout.mutateAsync()
    } catch {
      // Falha de rede no POST /auth/logout é ignorada de propósito: o `finally`
      // garante a limpeza local e a saída, para não prender o usuário na sessão.
    } finally {
      limpar()
      navegar('/login', { replace: true })
    }
  }, [logout, limpar, navegar])

  return <AppShell aoSair={() => void sair()} saindo={logout.isPending} />
}
