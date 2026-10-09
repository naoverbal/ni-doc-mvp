import type { ReactElement } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { useLogout } from '@/hooks/useAuth'
import { NavPrincipal } from '@/components/NavPrincipal'

// Casca da área logada: skip link + cabeçalho (marca, navegação, identidade e
// logout) ao redor do conteúdo de cada rota, renderizado via <Outlet />.
//
// Decisão de design: o <main> é responsabilidade de cada página (todas expõem
// <main id="conteudo">, alvo do skip link). O layout NÃO renderiza <main> para
// não duplicar o landmark.
export function LayoutApp(): ReactElement {
  const usuario = useAuthStore((estado) => estado.usuario)
  const limpar = useAuthStore((estado) => estado.limpar)
  const logout = useLogout()
  const navegar = useNavigate()

  // Logout resiliente: mesmo que o POST /auth/logout falhe (ex.: rede), limpamos
  // o estado local e saímos para /login no `finally`, para não prender o usuário
  // numa sessão aparentemente ativa (RF-L02.5).
  async function sair(): Promise<void> {
    try {
      await logout.mutateAsync()
    } catch {
      // Falha de rede no POST /auth/logout é ignorada de propósito: o `finally`
      // garante a limpeza local e a saída, para não prender o usuário na sessão.
    } finally {
      limpar()
      navegar('/login', { replace: true })
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="app-header">
        <span className="app-marca">ni-doc</span>
        <NavPrincipal />
        <div className="app-usuario">
          {usuario && <span>{usuario.nome}</span>}
          <button type="button" className="botao-sair" onClick={sair} disabled={logout.isPending}>
            {logout.isPending ? 'Saindo…' : 'Sair'}
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
